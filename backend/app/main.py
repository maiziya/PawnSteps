"""PawnSteps API application. Schema changes are applied exclusively by Alembic."""
from contextlib import asynccontextmanager
import logging

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import engine, get_session
from app.routers import admin, auth, focus, profile, tracker
from app.services.accounts import health

logger = logging.getLogger(__name__)


def validate_production_configuration() -> None:
    if settings.environment != "production":
        return
    if len(settings.jwt_secret) < 32 or settings.jwt_secret.lower().startswith(("development", "replace-with", "change-me")):
        raise RuntimeError("Production JWT_SECRET must be a randomly generated secret of at least 32 characters")
    if "*" in settings.cors_origins or "*" in settings.allowed_hosts:
        raise RuntimeError("Production CORS_ORIGINS and ALLOWED_HOSTS must explicitly name trusted hosts")
    if not settings.frontend_url.startswith("https://"):
        raise RuntimeError("Production FRONTEND_URL must use HTTPS")
    if settings.smtp_host and not settings.smtp_use_tls:
        raise RuntimeError("Production SMTP must use STARTTLS")


@asynccontextmanager
async def lifespan(application: FastAPI):
    validate_production_configuration()
    yield
    await engine.dispose()


app = FastAPI(title="PawnSteps API", version="1.0.0", lifespan=lifespan,
              docs_url="/api/docs" if settings.environment != "production" else None,
              redoc_url=None, openapi_url="/api/openapi.json" if settings.environment != "production" else None)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                   allow_credentials=True, allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
                   allow_headers=["Authorization", "Content-Type", "X-Guest-Id"])
app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)


@app.middleware("http")
async def response_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(IntegrityError)
async def integrity_error(request: Request, error: IntegrityError):
    logger.info("A conflicting mutation was rejected on %s", request.url.path)
    return JSONResponse(status_code=409, content={"detail": "The data changed concurrently. Refresh and try again."})


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, error: RequestValidationError):
    # Do not echo passwords, verification codes or tokens in validation error details.
    details = [{"loc": item["loc"], "msg": item["msg"], "type": item["type"]} for item in error.errors()]
    return JSONResponse(status_code=422, content={"detail": details})


@app.get("/api/health", tags=["System"])
async def health_check(session: AsyncSession = Depends(get_session)):
    return await health(session)


app.include_router(auth.router)
app.include_router(tracker.router)
app.include_router(focus.router)
app.include_router(profile.router)
app.include_router(admin.router)

if settings.storage_backend == "local":
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=str(settings.upload_dir)), name="uploads")

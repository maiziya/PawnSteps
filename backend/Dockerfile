FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements.lock ./requirements.lock
ARG PIP_INDEX_URL=https://pypi.org/simple
ARG PIP_TRUSTED_HOST=
RUN set -- --no-cache-dir --index-url "$PIP_INDEX_URL"; \
    if [ -n "$PIP_TRUSTED_HOST" ]; then set -- "$@" --trusted-host "$PIP_TRUSTED_HOST"; fi; \
    pip install "$@" -r requirements.lock && useradd --create-home --uid 10001 pawnsteps
COPY backend/ .
RUN mkdir -p uploads && chown -R pawnsteps:pawnsteps /app
USER pawnsteps
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]

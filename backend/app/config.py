from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore', case_sensitive=False)

    environment: str = 'development'
    database_url: str = 'sqlite+aiosqlite:///./pawnsteps.db'
    jwt_secret: str = 'development-only-change-this-secret-before-production'
    jwt_algorithm: str = 'HS256'
    jwt_expire_days: int = 30
    timezone: str = 'Asia/Shanghai'
    public_base_url: str = 'http://localhost:3000'
    frontend_url: str = 'http://localhost:3000'
    allowed_hosts: list[str] = ['localhost', '127.0.0.1', 'testserver']
    cors_origins: list[str] = ['http://localhost:3000']
    upload_dir: Path = Path('uploads')
    max_upload_bytes: int = 5242880
    storage_backend: str = 'local'
    s3_bucket: str = ''
    s3_region: str = 'us-east-1'
    s3_endpoint_url: str | None = None
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    s3_public_base_url: str = ''
    smtp_host: str = ''
    smtp_port: int = 587
    smtp_username: str = ''
    smtp_password: str = ''
    smtp_from: str = 'PawnSteps <noreply@pawnsteps.local>'
    smtp_use_tls: bool = True
    smtp_allow_console: bool = False
    wechat_app_id: str = ''
    wechat_app_secret: str = ''
    wechat_redirect_uri: str = 'http://localhost:3000/api/auth/wechat/callback'
    admin_username: str = 'admin'
    admin_password: str = ''
    admin_email: str = 'admin@pawnsteps.local'
    guest_task_limit: int = 10
    guest_daily_limit: int = 3

    @field_validator('database_url')
    @classmethod
    def asynchronous_driver(cls, value: str) -> str:
        if value.startswith('postgres://'):
            return value.replace('postgres://', 'postgresql+asyncpg://', 1)
        if value.startswith('postgresql://'):
            return value.replace('postgresql://', 'postgresql+asyncpg://', 1)
        if value.startswith('sqlite://'):
            return value.replace('sqlite://', 'sqlite+aiosqlite://', 1)
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

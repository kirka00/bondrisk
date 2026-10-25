from functools import lru_cache

from pydantic import PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Все секреты приходят из окружения / .env — в коде их нет (ТЗ §7)."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="BONDRISK_", extra="ignore")

    database_url: PostgresDsn = "postgresql+psycopg://app_rw:app_rw@localhost:5432/bondrisk"  # type: ignore[assignment]
    # Суперпользователь только для миграций и DDL-тестов; приложение ходит под app_rw.
    admin_database_url: PostgresDsn = (
        "postgresql+psycopg://postgres:postgres@localhost:5432/bondrisk"  # type: ignore[assignment]
    )
    moex_base_url: str = "https://iss.moex.com/iss"
    cbr_base_url: str = "https://www.cbr.ru/scripts"
    raw_dir: str = "data/raw"
    http_timeout: float = 30.0


@lru_cache
def get_settings() -> Settings:
    return Settings()

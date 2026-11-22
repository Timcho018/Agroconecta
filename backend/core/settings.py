"""Configuración privada de FastAPI (PostgreSQL + Supabase Storage)."""
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / '.env',
        env_file_encoding='utf-8',
        extra='ignore',
    )
    cors_origins: Annotated[list[str], NoDecode] = []
    database_url: str = ''
    supabase_url: str = ''
    supabase_secret_key: str = ''
    supabase_service_role_key: str = ''
    supabase_storage_bucket: str = 'agroconecta-private'

    @field_validator('cors_origins', mode='before')
    @classmethod
    def parse_origins(cls, value):
        if isinstance(value, str):
            return [x.strip() for x in value.split(',') if x.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()

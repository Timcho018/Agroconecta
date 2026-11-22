"""Conexión PostgreSQL obligatoria durante el uso normal de AgroConecta.

Las pruebas utilizan JSON solo cuando pasan un archivo temporal explícito.
Evita que una ausencia accidental del .env simule una base de datos vacía.
"""
from pathlib import Path
from urllib.parse import urlsplit

from core.settings import get_settings


def create_store(data_path=None):
    from repositories.store import JsonStore

    if data_path is not None:
        return JsonStore(Path(data_path))

    settings = get_settings()
    dsn = settings.database_url.strip()
    if not dsn:
        raise RuntimeError('No se encontró DATABASE_URL. Copia backend/.env.example como backend/.env y configura tu Session pooler de Supabase. No se iniciará una base JSON por accidente.')

    parsed = urlsplit(dsn)
    if parsed.scheme not in ('postgres', 'postgresql') or not parsed.hostname:
        raise RuntimeError('DATABASE_URL debe ser una URI PostgreSQL del Session pooler de Supabase.')
    if 'sslmode=' not in dsn.lower():
        dsn += ('&' if '?' in dsn else '?') + 'sslmode=require'

    from repositories.postgres_store import PostgresStore
    return PostgresStore(dsn)

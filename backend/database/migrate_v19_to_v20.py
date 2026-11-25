"""Fail-closed V19 -> V20 migration runner for an isolated local PostgreSQL.

This command deliberately accepts only loopback PostgreSQL hosts and reads a
dedicated AGRO_MIGRATION_DATABASE_URL variable. It never reads DATABASE_URL,
the application's .env file, Supabase settings, or Storage credentials.
"""
from __future__ import annotations

import argparse
import os
import re
from pathlib import Path
from urllib.parse import urlsplit


HERE = Path(__file__).resolve().parent
LEGACY_TABLES = (
    "usuarios", "sesiones", "cultivos", "parcelas", "plantillas",
    "actividades", "cosechas", "etapas_lote", "bitacora", "alertas_revisadas",
)
TARGET_TABLES = (
    "usuarios", "sesiones", "cultivos", "parcelas", "plantillas",
    "etapas_plantilla", "actividades", "cosechas", "etapas_cosecha",
    "bitacora", "alertas",
)
ENTITY_COPY = {
    "usuarios": "usuarios",
    "sesiones": "sesiones",
    "cultivos": "cultivos",
    "parcelas": "parcelas",
    "plantillas": "plantillas",
    "actividades": "actividades",
    "cosechas": "cosechas",
    "bitacora": "bitacora",
    "alertas_revisadas": "alertas",
}


def migration_files() -> tuple[Path, ...]:
    return (
        HERE / "05_Modelo_11_Tablas_V20.sql",
        HERE / "06_Migracion_V19_V20.sql",
        HERE / "04_Rutinas_Almacenadas.sql",
    )


def validate_database_url(dsn: str) -> str:
    parsed = urlsplit(dsn)
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in {"postgres", "postgresql"} or not host:
        raise ValueError("AGRO_MIGRATION_DATABASE_URL debe ser una URL PostgreSQL local.")
    if host not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("Por seguridad, la migración solo acepta PostgreSQL en loopback; no se permite una base remota.")
    if not parsed.path or parsed.path == "/":
        raise ValueError("La URL de migración debe incluir el nombre de una base local aislada.")
    return host


def without_transaction_wrappers(sql: str) -> str:
    sql = re.sub(r"(?im)^\s*BEGIN;\s*$", "", sql)
    return re.sub(r"(?im)^\s*COMMIT;\s*$", "", sql)


def _execute_script(cursor, path: Path) -> None:
    cursor.execute(without_transaction_wrappers(path.read_text(encoding="utf-8")), prepare=False)


def _verify(cursor) -> dict[str, int]:
    cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
    found = {row[0] for row in cursor.fetchall()}
    expected = set(TARGET_TABLES)
    missing = expected - found
    if missing:
        raise RuntimeError("Faltan tablas V20: " + ", ".join(sorted(missing)))
    cursor.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name = ANY(%s)", (list(TARGET_TABLES),))
    if cursor.fetchone()[0] != 11:
        raise RuntimeError("El esquema V20 no contiene exactamente las 11 tablas de AgroConecta.")
    from psycopg.types.json import Jsonb
    cursor.execute("CALL public.agro_exec(%s, %s, NULL)", ("health", Jsonb({})))
    row = cursor.fetchone()
    health = row[-1] if row else None
    if not isinstance(health, dict) or health.get("version") != 20:
        raise RuntimeError("Las rutinas no publican el contrato V20.")

    counts = {}
    for name in TARGET_TABLES:
        cursor.execute(f'SELECT count(*) FROM public."{name}"')
        counts[name] = int(cursor.fetchone()[0])
    for old_name, new_name in ENTITY_COPY.items():
        cursor.execute(f'SELECT count(*) FROM agroconecta_legacy."{old_name}"')
        old_count = int(cursor.fetchone()[0])
        if old_name == "alertas_revisadas":
            cursor.execute("SELECT count(*) FROM public.alertas")
        else:
            cursor.execute(f'SELECT count(*) FROM public."{new_name}"')
        new_count = int(cursor.fetchone()[0])
        if old_count != new_count:
            raise RuntimeError(f"Conteo distinto para {old_name}: origen {old_count}, destino {new_count}.")
    return counts


def migrate(dsn: str) -> dict[str, int]:
    validate_database_url(dsn)
    try:
        import psycopg
    except ImportError as exc:
        raise RuntimeError("psycopg no está disponible; no se instaló ninguna dependencia.") from exc

    files = migration_files()
    missing_files = [str(path.name) for path in files if not path.is_file()]
    if missing_files:
        raise RuntimeError("Faltan archivos de migración: " + ", ".join(missing_files))

    # La conexión solo se abre después de validar que el host es loopback.
    # `with psycopg.connect` revierte automáticamente ante cualquier excepción.
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(861902174)")
            cursor.execute("SELECT schema_name FROM information_schema.schemata WHERE schema_name='agroconecta_legacy'")
            if cursor.fetchone():
                raise RuntimeError("Ya existe agroconecta_legacy; no se sobrescribirá ningún respaldo.")
            cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
            existing = {row[0] for row in cursor.fetchall()}
            missing = set(LEGACY_TABLES) - existing
            if missing:
                raise RuntimeError("No se encontró el esquema V18/V19 esperado; faltan: " + ", ".join(sorted(missing)))
            v20_only = set(TARGET_TABLES) - set(LEGACY_TABLES)
            if v20_only & existing:
                raise RuntimeError("Ya hay tablas exclusivas de V20 en public; no se sobrescribirán.")

            cursor.execute("CREATE SCHEMA agroconecta_legacy")
            for table in LEGACY_TABLES:
                cursor.execute(f'ALTER TABLE public."{table}" SET SCHEMA agroconecta_legacy')
            _execute_script(cursor, files[0])
            _execute_script(cursor, files[1])
            _execute_script(cursor, files[2])
            counts = _verify(cursor)
        connection.commit()
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="aplicar en la base PostgreSQL local indicada")
    args = parser.parse_args()
    if not args.apply:
        print("No se realizó ninguna conexión. Revisa el respaldo y la base aislada; usa --apply solo con AGRO_MIGRATION_DATABASE_URL local.")
        return 0
    dsn = os.environ.get("AGRO_MIGRATION_DATABASE_URL", "")
    if not dsn:
        parser.error("Define AGRO_MIGRATION_DATABASE_URL con una base PostgreSQL local aislada.")
    try:
        counts = migrate(dsn)
    except Exception as exc:
        print(f"Migración cancelada y revertida: {exc}")
        return 1
    print("Migración V20 verificada en la base local. Conteos del modelo nuevo:")
    for name, count in counts.items():
        print(f"  {name}: {count}")
    print("Las tablas originales se conservaron en agroconecta_legacy. No se accedió a Supabase Storage.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

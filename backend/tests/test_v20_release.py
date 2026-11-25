from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_backend_matches_v20_routines_and_schema():
    sql = (ROOT / 'database/04_Rutinas_Almacenadas.sql').read_text()
    schema = (ROOT / 'database/05_Modelo_11_Tablas_V20.sql').read_text()
    backend = (ROOT / 'repositories/postgres_store.py').read_text()
    assert "'version',20" in sql
    assert "version.get('version') != 20" in backend
    expected = {
        'usuarios', 'sesiones', 'cultivos', 'parcelas', 'plantillas',
        'etapas_plantilla', 'actividades', 'cosechas', 'etapas_cosecha',
        'bitacora', 'alertas',
    }
    created = {line.split('public.', 1)[1].split(' ', 1)[0]
               for line in schema.splitlines()
               if line.startswith('CREATE TABLE IF NOT EXISTS public.')}
    assert created == expected and len(created) == 11
    for action in ('health', 'lock', 'list', 'list_multiple', 'get', 'save', 'remove',
                   'stage', 'event', 'user_email', 'add_user', 'add_session',
                   'session_user', 'delete_session', 'events', 'summary',
                   'reviews', 'review', 'snapshot'):
        assert f"WHEN '{action}'" in sql


def test_v20_runner_is_loopback_only_and_transactional():
    runner = (ROOT / 'database/migrate_v19_to_v20.py').read_text()
    assert 'AGRO_MIGRATION_DATABASE_URL' in runner
    assert 'os.environ.get("DATABASE_URL")' not in runner
    assert 'localhost' in runner and '127.0.0.1' in runner
    assert 'agroconecta_legacy' in runner
    assert 'connection.commit()' in runner
    migration = (ROOT / 'database/06_Migracion_V19_V20.sql').read_text()
    assert "RAISE EXCEPTION 'Hay % propiedades JSON sin mapeo" in migration
    assert "RAISE EXCEPTION 'Hay % fotos Base64" in migration

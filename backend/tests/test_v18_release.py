from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]

def test_backend_matches_routines():
    sql = (ROOT / 'database/EJECUTAR_EN_SUPABASE.sql').read_text()
    backend = (ROOT / 'repositories/postgres_store.py').read_text()
    assert "'version',18" in sql
    assert "version.get('version') != 18" in backend

def test_one_transaction_and_legacy_cleanup():
    sql = (ROOT / 'database/EJECUTAR_EN_SUPABASE.sql').read_text()
    assert sql.count('\nBEGIN;') == 1
    assert sql.count('\nCOMMIT;') == 1
    assert 'DROP COLUMN IF EXISTS foto_jpeg' in sql
    assert "datos_json - 'crop_photo_b64'" in sql
    assert 'information_schema.columns' in sql
    assert 'CREATE OR REPLACE PROCEDURE public.agro_exec' in sql

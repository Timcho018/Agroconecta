-- ARCHIVO HISTÓRICO V18: no ejecutar en instalaciones nuevas ni existentes.
-- V20 está preparado en 05_Modelo_11_Tablas_V20.sql, 04_Rutinas_Almacenadas.sql
-- y 06_Migracion_V19_V20.sql. La migración automática solo admite loopback
-- PostgreSQL y conserva tablas de origen en agroconecta_legacy.
-- No se ha aplicado a Supabase ni debe hacerse sin aprobación y ensayo aislado.
DO $obsolete$
BEGIN
  RAISE EXCEPTION 'La actualización V18 está retirada; revise el procedimiento V20 y el entorno antes de migrar.';
END
$obsolete$;

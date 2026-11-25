-- ARCHIVO HISTÓRICO V18: ya no crea el esquema activo.
-- Para un proyecto vacío, aplicar 05_Modelo_11_Tablas_V20.sql y después
-- 04_Rutinas_Almacenadas.sql. Para datos V18/V19, revisar el runner local
-- migrate_v19_to_v20.py y la migración 06 antes de autorizar cualquier corte.
DO $obsolete$
BEGIN
  RAISE EXCEPTION 'Este esquema V18 está retirado. Consulte 05_Modelo_11_Tablas_V20.sql.';
END
$obsolete$;

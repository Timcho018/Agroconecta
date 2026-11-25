-- ARCHIVO HISTÓRICO V19: la corrección de parcelas sin cultivo está incluida
-- en el modelo V20 y en su función agro_save_record. No aplicar este parche
-- sobre V20, pues su contrato está basado en las columnas anteriores.
DO $obsolete$
BEGIN
  RAISE EXCEPTION 'El parche V19 está retirado; utilice las rutinas V20.';
END
$obsolete$;

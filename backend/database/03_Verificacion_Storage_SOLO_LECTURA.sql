-- AgroConecta V20: comprobaciones solo de lectura.
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_type='BASE TABLE'
  AND table_name IN ('usuarios','sesiones','cultivos','parcelas','plantillas',
    'etapas_plantilla','actividades','cosechas','etapas_cosecha','bitacora','alertas')
ORDER BY table_name;

SELECT count(*) AS parcelas_con_ruta_storage
FROM public.parcelas WHERE nullif(ruta_fotografia,'') IS NOT NULL;
SELECT count(*) AS cultivos_con_ruta_storage
FROM public.cultivos WHERE nullif(ruta_fotografia,'') IS NOT NULL;

SELECT id AS bucket, public AS es_publico, file_size_limit AS limite_bytes,
       allowed_mime_types AS tipos_permitidos
FROM storage.buckets WHERE id='agroconecta-private';
SELECT bucket_id AS bucket, count(*) AS objetos
FROM storage.objects WHERE bucket_id='agroconecta-private' GROUP BY bucket_id;

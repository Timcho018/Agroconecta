-- AgroConecta V18 | VERIFICACION DE STORAGE, SOLO LECTURA
-- Ejecutar despues de los dos archivos SQL. No modifica ningun registro.
SELECT count(*) AS parcelas_con_ruta_storage
FROM public.parcelas WHERE nullif(foto_ruta,'') IS NOT NULL;
SELECT count(*) AS cultivos_con_ruta_storage
FROM public.cultivos WHERE nullif(datos_json->>'crop_photo_path','') IS NOT NULL;
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='parcelas' AND column_name='foto_jpeg';
-- Esta ultima consulta debe devolver cero filas.

-- Consulta complementaria: confirma que el bucket exista y NO sea público.
SELECT id AS bucket, public AS es_publico, file_size_limit AS limite_bytes,
       allowed_mime_types AS tipos_permitidos
FROM storage.buckets WHERE id = 'agroconecta-private';

-- Consulta complementaria: número de objetos efectivamente en Storage.
SELECT bucket_id AS bucket, count(*) AS objetos
FROM storage.objects WHERE bucket_id = 'agroconecta-private'
GROUP BY bucket_id;

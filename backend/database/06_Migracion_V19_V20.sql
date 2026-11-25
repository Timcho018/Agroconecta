-- Copia fail-closed desde el esquema V18/V19 movido a agroconecta_legacy.
-- Este archivo lo orquesta migrate_v19_to_v20.py dentro de UNA transacción.
-- No ejecutarlo manualmente ni contra Supabase de producción.
DO $preflight$
DECLARE bad bigint;
BEGIN
  IF to_regclass('agroconecta_legacy.usuarios') IS NULL OR
     to_regclass('agroconecta_legacy.cultivos') IS NULL OR
     to_regclass('agroconecta_legacy.parcelas') IS NULL OR
     to_regclass('agroconecta_legacy.cosechas') IS NULL THEN
    RAISE EXCEPTION 'No se encontró el esquema V18/V19 esperado en agroconecta_legacy';
  END IF;

  -- Datos binarios no se descartan. La migración SQL no toca Storage; si hay
  -- Base64 heredado, primero debe trasladarse y verificarse en un entorno aislado.
  SELECT count(*) INTO bad FROM agroconecta_legacy.cultivos
  WHERE nullif(datos_json->>'crop_photo_b64','') IS NOT NULL;
  IF bad>0 THEN RAISE EXCEPTION 'Hay % fotos Base64 de cultivos; migración detenida sin cambios',bad; END IF;

  SELECT count(*) INTO bad FROM agroconecta_legacy.plantillas t
  WHERE t.datos_json->>'purpose'='harvest' AND CASE
    WHEN jsonb_typeof(t.datos_json->'steps') IS DISTINCT FROM 'array' THEN true
    ELSE jsonb_array_length(t.datos_json->'steps') NOT BETWEEN 1 AND 10 END;
  IF bad>0 THEN RAISE EXCEPTION 'Hay % plantillas de proceso sin 1–10 etapas válidas',bad; END IF;
  SELECT count(*) INTO bad FROM agroconecta_legacy.plantillas t
  WHERE coalesce(t.datos_json->>'purpose','activity')<>'harvest'
    AND CASE
      WHEN NOT (t.datos_json ? 'steps') OR t.datos_json->'steps'='null'::jsonb THEN false
      WHEN jsonb_typeof(t.datos_json->'steps') IS DISTINCT FROM 'array' THEN true
      ELSE jsonb_array_length(t.datos_json->'steps')>0 END;
  IF bad>0 THEN RAISE EXCEPTION 'Hay % plantillas de actividad con pasos no definidos por el modelo',bad; END IF;
  SELECT count(*) INTO bad FROM agroconecta_legacy.plantillas t
  CROSS JOIN LATERAL jsonb_array_elements(t.datos_json->'steps') step(value)
  WHERE t.datos_json->>'purpose'='harvest' AND (
    jsonb_typeof(step.value) IS DISTINCT FROM 'string' OR
    char_length(btrim(step.value #>> '{}')) NOT BETWEEN 2 AND 64 OR
    lower(btrim(step.value #>> '{}')) IN ('cosechado','cerrado'));
  IF bad>0 THEN RAISE EXCEPTION 'Hay % etapas de plantilla con tipo, longitud o nombre inválidos',bad; END IF;
  SELECT count(*) INTO bad FROM (
    SELECT t.id,lower(btrim(step.value)) AS name FROM agroconecta_legacy.plantillas t
    CROSS JOIN LATERAL jsonb_array_elements_text(t.datos_json->'steps') step(value)
    WHERE t.datos_json->>'purpose'='harvest'
    GROUP BY t.id,lower(btrim(step.value)) HAVING count(*)>1
  ) duplicates;
  IF bad>0 THEN RAISE EXCEPTION 'Hay % etapas de plantilla repetidas sin distinguir mayúsculas',bad; END IF;

  -- Rechazar propiedades JSON no mapeadas para impedir pérdidas silenciosas.
  SELECT count(*) INTO bad FROM (
    SELECT 1 FROM agroconecta_legacy.cultivos c,
      LATERAL jsonb_object_keys(c.datos_json) k(key)
    WHERE k.key <> ALL(ARRAY['id','owner','kind','name','variety','cycle_days','notes','active',
      'image_source','image_url','image_credit','image_license','image_taxon_id',
      'crop_photo_path','crop_photo_b64','crop_photo_version','created_at','updated_at'])
    UNION ALL
    SELECT 1 FROM agroconecta_legacy.parcelas p,
      LATERAL jsonb_object_keys(p.datos_json) k(key)
    WHERE k.key <> ALL(ARRAY['id','owner','kind','crop_id','name','location','area','latitude','longitude',
      'soil','notes','active','photo_version','photo_path','created_at','updated_at'])
    UNION ALL
    SELECT 1 FROM agroconecta_legacy.plantillas t,
      LATERAL jsonb_object_keys(t.datos_json) k(key)
    WHERE k.key <> ALL(ARRAY['id','owner','kind','name','purpose','steps','title','category','notes','created_at','updated_at'])
    UNION ALL
    SELECT 1 FROM agroconecta_legacy.actividades a,
      LATERAL jsonb_object_keys(a.datos_json) k(key)
    WHERE k.key <> ALL(ARRAY['id','owner','kind','title','plot_id','date','category','status','notes','created_at','updated_at'])
    UNION ALL
    SELECT 1 FROM agroconecta_legacy.cosechas h,
      LATERAL jsonb_object_keys(h.datos_json) k(key)
    WHERE k.key <> ALL(ARRAY['id','owner','kind','plot_id','date','quantity','current_quantity','stage','notes',
      'process_mode','process_steps','stage_history','stages','code','crop_id','process_template_id',
      'process_template_name','crop_name_historical','variety_historical','created_at','updated_at'])
  ) unknown_keys;
  IF bad>0 THEN RAISE EXCEPTION 'Hay % propiedades JSON sin mapeo; migración detenida',bad; END IF;

  SELECT count(*) INTO bad FROM agroconecta_legacy.cultivos c WHERE
    (c.datos_json ? 'name' AND c.datos_json->>'name' IS DISTINCT FROM c.nombre) OR
    (c.datos_json ? 'variety' AND c.datos_json->>'variety' IS DISTINCT FROM c.variedad) OR
    (c.datos_json ? 'cycle_days' AND (c.datos_json->>'cycle_days')::integer IS DISTINCT FROM c.ciclo_dias) OR
    (c.datos_json ? 'notes' AND c.datos_json->>'notes' IS DISTINCT FROM c.notas) OR
    (c.datos_json ? 'active' AND (c.datos_json->>'active')::boolean IS DISTINCT FROM c.activo) OR
    (c.datos_json ? 'created_at' AND (c.datos_json->>'created_at')::timestamptz IS DISTINCT FROM c.creado_en) OR
    (c.datos_json ? 'updated_at' AND (c.datos_json->>'updated_at')::timestamptz IS DISTINCT FROM c.actualizado_en);
  IF bad>0 THEN RAISE EXCEPTION 'Hay % cultivos con columnas distintas de datos_json',bad; END IF;

  SELECT count(*) INTO bad FROM agroconecta_legacy.parcelas p WHERE
    (p.datos_json ? 'crop_id' AND nullif(p.datos_json->>'crop_id','')::uuid IS DISTINCT FROM p.cultivo_id) OR
    (p.datos_json ? 'name' AND p.datos_json->>'name' IS DISTINCT FROM p.nombre) OR
    (p.datos_json ? 'location' AND p.datos_json->>'location' IS DISTINCT FROM p.ubicacion) OR
    (p.datos_json ? 'area' AND (p.datos_json->>'area')::numeric IS DISTINCT FROM p.area_ha) OR
    (p.datos_json ? 'latitude' AND (p.datos_json->>'latitude')::numeric IS DISTINCT FROM p.latitud) OR
    (p.datos_json ? 'longitude' AND (p.datos_json->>'longitude')::numeric IS DISTINCT FROM p.longitud) OR
    (p.datos_json ? 'soil' AND p.datos_json->>'soil' IS DISTINCT FROM p.suelo) OR
    (p.datos_json ? 'notes' AND p.datos_json->>'notes' IS DISTINCT FROM p.notas) OR
    (p.datos_json ? 'active' AND (p.datos_json->>'active')::boolean IS DISTINCT FROM p.activa) OR
    (p.datos_json ? 'photo_path' AND nullif(p.datos_json->>'photo_path','') IS DISTINCT FROM p.foto_ruta) OR
    (p.datos_json ? 'photo_version' AND nullif(p.datos_json->>'photo_version','')::uuid IS DISTINCT FROM p.foto_version) OR
    (p.datos_json ? 'created_at' AND (p.datos_json->>'created_at')::timestamptz IS DISTINCT FROM p.creado_en) OR
    (p.datos_json ? 'updated_at' AND (p.datos_json->>'updated_at')::timestamptz IS DISTINCT FROM p.actualizado_en);
  IF bad>0 THEN RAISE EXCEPTION 'Hay % parcelas con columnas distintas de datos_json',bad; END IF;

  SELECT count(*) INTO bad FROM agroconecta_legacy.plantillas t WHERE
    (t.datos_json ? 'name' AND t.datos_json->>'name' IS DISTINCT FROM t.nombre) OR
    (coalesce(t.datos_json->>'purpose','activity')='activity' AND t.datos_json ? 'title' AND t.datos_json->>'title' IS DISTINCT FROM t.titulo) OR
    (coalesce(t.datos_json->>'purpose','activity')='activity' AND t.datos_json ? 'category' AND t.datos_json->>'category' IS DISTINCT FROM t.categoria) OR
    (t.datos_json ? 'notes' AND t.datos_json->>'notes' IS DISTINCT FROM t.notas) OR
    (t.datos_json ? 'created_at' AND (t.datos_json->>'created_at')::timestamptz IS DISTINCT FROM t.creado_en) OR
    (t.datos_json ? 'updated_at' AND (t.datos_json->>'updated_at')::timestamptz IS DISTINCT FROM t.actualizado_en);
  IF bad>0 THEN RAISE EXCEPTION 'Hay % plantillas con columnas distintas de datos_json',bad; END IF;

  SELECT count(*) INTO bad FROM agroconecta_legacy.actividades a WHERE
    (a.datos_json ? 'plot_id' AND (a.datos_json->>'plot_id')::uuid IS DISTINCT FROM a.parcela_id) OR
    (a.datos_json ? 'title' AND a.datos_json->>'title' IS DISTINCT FROM a.titulo) OR
    (a.datos_json ? 'date' AND (a.datos_json->>'date')::date IS DISTINCT FROM a.fecha) OR
    (a.datos_json ? 'category' AND a.datos_json->>'category' IS DISTINCT FROM a.categoria) OR
    (a.datos_json ? 'status' AND a.datos_json->>'status' IS DISTINCT FROM a.estado) OR
    (a.datos_json ? 'notes' AND a.datos_json->>'notes' IS DISTINCT FROM a.notas) OR
    (a.datos_json ? 'created_at' AND (a.datos_json->>'created_at')::timestamptz IS DISTINCT FROM a.creado_en) OR
    (a.datos_json ? 'updated_at' AND (a.datos_json->>'updated_at')::timestamptz IS DISTINCT FROM a.actualizado_en);
  IF bad>0 THEN RAISE EXCEPTION 'Hay % actividades con columnas distintas de datos_json',bad; END IF;

  SELECT count(*) INTO bad FROM agroconecta_legacy.cosechas h WHERE
    (h.datos_json ? 'plot_id' AND (h.datos_json->>'plot_id')::uuid IS DISTINCT FROM h.parcela_id) OR
    (h.datos_json ? 'code' AND h.datos_json->>'code' IS DISTINCT FROM h.codigo) OR
    (h.datos_json ? 'date' AND (h.datos_json->>'date')::date IS DISTINCT FROM h.fecha) OR
    (h.datos_json ? 'quantity' AND (h.datos_json->>'quantity')::numeric IS DISTINCT FROM h.cantidad_inicial) OR
    (h.datos_json ? 'current_quantity' AND (h.datos_json->>'current_quantity')::numeric IS DISTINCT FROM h.cantidad_actual) OR
    (h.datos_json ? 'notes' AND h.datos_json->>'notes' IS DISTINCT FROM h.notas) OR
    (h.datos_json ? 'created_at' AND (h.datos_json->>'created_at')::timestamptz IS DISTINCT FROM h.creado_en) OR
    (h.datos_json ? 'updated_at' AND (h.datos_json->>'updated_at')::timestamptz IS DISTINCT FROM h.actualizado_en);
  IF bad>0 THEN RAISE EXCEPTION 'Hay % cosechas con columnas distintas de datos_json',bad; END IF;

  SELECT count(*) INTO bad FROM agroconecta_legacy.cosechas h
  WHERE h.datos_json ? 'stage_history' AND h.datos_json ? 'stages'
    AND nullif(h.datos_json->'stage_history','null'::jsonb) IS DISTINCT FROM
        nullif(h.datos_json->'stages','null'::jsonb);
  IF bad>0 THEN RAISE EXCEPTION 'Hay % cosechas con dos historiales JSON distintos',bad; END IF;

  SELECT count(*) INTO bad FROM agroconecta_legacy.cosechas h
  WHERE h.datos_json ? 'process_mode'
    AND h.datos_json->>'process_mode' NOT IN ('custom','legacy');
  IF bad>0 THEN RAISE EXCEPTION 'Hay % cosechas con modo de proceso desconocido',bad; END IF;

  SELECT count(*) INTO bad FROM agroconecta_legacy.cosechas h
  WHERE h.datos_json ? 'stage' AND h.datos_json->>'stage' IS DISTINCT FROM CASE
    WHEN h.datos_json->>'process_mode'='custom' THEN
      (SELECT ev.event->>'stage' FROM jsonb_array_elements(coalesce(
        nullif(h.datos_json->'stage_history','null'::jsonb),
        nullif(h.datos_json->'stages','null'::jsonb),'[]'::jsonb)) WITH ORDINALITY ev(event,ord)
       ORDER BY ev.ord DESC LIMIT 1)
    ELSE (SELECT e.etapa FROM agroconecta_legacy.etapas_lote e
      WHERE e.cosecha_id=h.id AND e.usuario_id=h.usuario_id ORDER BY e.orden DESC LIMIT 1)
    END;
  IF bad>0 THEN RAISE EXCEPTION 'Hay % cosechas cuya etapa actual no coincide con su historial',bad; END IF;

  SELECT count(*) INTO bad FROM agroconecta_legacy.cosechas h
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(
    nullif(h.datos_json->'stage_history','null'::jsonb),
    nullif(h.datos_json->'stages','null'::jsonb),'[]'::jsonb)) ev
  CROSS JOIN LATERAL jsonb_object_keys(ev) k(key)
  WHERE h.datos_json->>'process_mode'='custom'
    AND k.key <> ALL(ARRAY['stage','quantity','date','notes']);
  IF bad>0 THEN RAISE EXCEPTION 'Hay % propiedades de etapas personalizadas sin mapeo',bad; END IF;

  SELECT count(*) INTO bad FROM agroconecta_legacy.cosechas h
  JOIN agroconecta_legacy.parcelas p ON p.id=h.parcela_id
  LEFT JOIN agroconecta_legacy.cultivos c ON c.id=nullif(h.datos_json->>'crop_id','')::uuid
  WHERE nullif(h.datos_json->>'crop_id','') IS NOT NULL
    AND (c.id IS NULL OR c.usuario_id<>p.usuario_id);
  IF bad>0 THEN RAISE EXCEPTION 'Hay % cultivos de origen inexistentes o de otro usuario',bad; END IF;

  SELECT count(*) INTO bad FROM (
    SELECT codigo FROM agroconecta_legacy.cosechas GROUP BY codigo HAVING count(*)>1
  ) duplicate_codes;
  IF bad>0 THEN RAISE EXCEPTION 'Hay % códigos de lote repetidos entre usuarios; migración detenida',bad; END IF;

  -- Cada lote debe tener una secuencia completa y un evento inicial verificable.
  SELECT count(*) INTO bad FROM agroconecta_legacy.cosechas h
  WHERE CASE WHEN jsonb_typeof(h.datos_json->'process_steps') IS DISTINCT FROM 'array' THEN true
    ELSE jsonb_array_length(h.datos_json->'process_steps') NOT BETWEEN 2 AND 12
      OR h.datos_json->'process_steps'->>0 <> 'Cosechado'
      OR h.datos_json->'process_steps'->>(jsonb_array_length(h.datos_json->'process_steps')-1) <> 'Cerrado'
  END;
  IF bad>0 THEN RAISE EXCEPTION 'Hay % lotes sin definición completa de proceso; no se inferirán etapas',bad; END IF;
  SELECT count(*) INTO bad FROM agroconecta_legacy.cosechas h
  CROSS JOIN LATERAL jsonb_array_elements(h.datos_json->'process_steps') step(value)
  WHERE jsonb_typeof(step.value) IS DISTINCT FROM 'string';
  IF bad>0 THEN RAISE EXCEPTION 'Hay % lotes con nombres de etapa que no son texto',bad; END IF;
  SELECT count(*) INTO bad FROM (
    SELECT h.id,lower(btrim(step.value)) AS name FROM agroconecta_legacy.cosechas h
    CROSS JOIN LATERAL jsonb_array_elements_text(h.datos_json->'process_steps') step(value)
    GROUP BY h.id,lower(btrim(step.value)) HAVING count(*)>1
  ) duplicates;
  IF bad>0 THEN RAISE EXCEPTION 'Hay % lotes con etapas repetidas sin distinguir mayúsculas',bad; END IF;

  SELECT count(*) INTO bad FROM agroconecta_legacy.cosechas h
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(
    nullif(h.datos_json->'stage_history','null'::jsonb),
    nullif(h.datos_json->'stages','null'::jsonb),'[]'::jsonb)) WITH ORDINALITY ev(event,ord)
  LEFT JOIN LATERAL jsonb_array_elements_text(h.datos_json->'process_steps') WITH ORDINALITY plan(name,ord)
    ON plan.ord=ev.ord
  WHERE h.datos_json->>'process_mode'='custom'
    AND (plan.name IS NULL OR plan.name IS DISTINCT FROM ev.event->>'stage'
      OR nullif(ev.event->>'quantity','') IS NULL OR nullif(ev.event->>'date','') IS NULL);
  IF bad>0 THEN RAISE EXCEPTION 'Hay % eventos personalizados sin etapa/cantidad/fecha coincidente',bad; END IF;

  SELECT count(*) INTO bad FROM agroconecta_legacy.cosechas h
  JOIN agroconecta_legacy.etapas_lote e ON e.cosecha_id=h.id AND e.usuario_id=h.usuario_id
  LEFT JOIN LATERAL jsonb_array_elements_text(h.datos_json->'process_steps') WITH ORDINALITY plan(name,ord)
    ON plan.ord=e.orden
  WHERE h.datos_json->>'process_mode' IS DISTINCT FROM 'custom'
    AND (plan.name IS NULL OR plan.name IS DISTINCT FROM e.etapa
      OR e.cantidad IS NULL OR e.fecha_utc IS NULL);
  IF bad>0 THEN RAISE EXCEPTION 'Hay % etapas estándar sin definición coincidente',bad; END IF;

  SELECT count(*) INTO bad FROM agroconecta_legacy.etapas_lote e
  WHERE e.orden>1 AND NOT EXISTS (
    SELECT 1 FROM agroconecta_legacy.etapas_lote prior
    WHERE prior.cosecha_id=e.cosecha_id AND prior.usuario_id=e.usuario_id
      AND prior.orden=e.orden-1);
  IF bad>0 THEN RAISE EXCEPTION 'Hay % etapas estándar fuera de secuencia',bad; END IF;

  SELECT count(*) INTO bad FROM (
    SELECT h.id,h.cantidad_inicial,e.orden,e.cantidad,
      lag(e.cantidad) OVER (PARTITION BY h.id ORDER BY e.orden) AS anterior
    FROM agroconecta_legacy.cosechas h
    JOIN agroconecta_legacy.etapas_lote e ON e.cosecha_id=h.id AND e.usuario_id=h.usuario_id
    WHERE h.datos_json->>'process_mode' IS DISTINCT FROM 'custom'
  ) q WHERE (orden=1 AND cantidad IS DISTINCT FROM cantidad_inicial)
      OR (orden>1 AND (anterior IS NULL OR cantidad>anterior));
  IF bad>0 THEN RAISE EXCEPTION 'Hay % etapas estándar con cantidad inconsistente',bad; END IF;

  SELECT count(*) INTO bad FROM (
    SELECT h.id,h.cantidad_inicial,ev.ord,(ev.event->>'quantity')::numeric AS cantidad,
      lag((ev.event->>'quantity')::numeric) OVER (PARTITION BY h.id ORDER BY ev.ord) AS anterior
    FROM agroconecta_legacy.cosechas h
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(
      nullif(h.datos_json->'stage_history','null'::jsonb),
      nullif(h.datos_json->'stages','null'::jsonb),'[]'::jsonb)) WITH ORDINALITY ev(event,ord)
    WHERE h.datos_json->>'process_mode'='custom'
  ) q WHERE (ord=1 AND cantidad IS DISTINCT FROM cantidad_inicial)
      OR (ord>1 AND (anterior IS NULL OR cantidad>anterior));
  IF bad>0 THEN RAISE EXCEPTION 'Hay % etapas personalizadas con cantidad inconsistente',bad; END IF;

  SELECT count(*) INTO bad FROM agroconecta_legacy.cosechas h
  WHERE h.cantidad_actual IS DISTINCT FROM CASE WHEN h.datos_json->>'process_mode'='custom'
    THEN (SELECT (ev.event->>'quantity')::numeric FROM jsonb_array_elements(coalesce(
      nullif(h.datos_json->'stage_history','null'::jsonb),
      nullif(h.datos_json->'stages','null'::jsonb),'[]'::jsonb)) WITH ORDINALITY ev(event,ord)
      ORDER BY ev.ord DESC LIMIT 1)
    ELSE (SELECT e.cantidad FROM agroconecta_legacy.etapas_lote e
      WHERE e.cosecha_id=h.id AND e.usuario_id=h.usuario_id ORDER BY e.orden DESC LIMIT 1)
    END;
  IF bad>0 THEN RAISE EXCEPTION 'Hay % cosechas cuya cantidad actual no coincide con su última etapa',bad; END IF;

  SELECT count(*) INTO bad FROM agroconecta_legacy.cosechas h
  WHERE CASE WHEN h.datos_json->>'process_mode'='custom'
    THEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(nullif(h.datos_json->'stage_history','null'::jsonb),nullif(h.datos_json->'stages','null'::jsonb),'[]'::jsonb)) e
                     WHERE e->>'stage'='Cosechado' AND nullif(e->>'date','') IS NOT NULL AND nullif(e->>'quantity','') IS NOT NULL)
    ELSE NOT EXISTS (SELECT 1 FROM agroconecta_legacy.etapas_lote e
                     WHERE e.cosecha_id=h.id AND e.usuario_id=h.usuario_id AND e.orden=1 AND e.etapa='Cosechado')
    END;
  IF bad>0 THEN RAISE EXCEPTION 'Hay % cosechas sin evento inicial completo; migración detenida',bad; END IF;
END
$preflight$;

INSERT INTO public.usuarios(id_usuario,nombre,correo_electronico,sal_criptografica,contrasena_hash,fecha_registro)
SELECT id,nombre,correo,sal,clave_hash,creado_en FROM agroconecta_legacy.usuarios;

INSERT INTO public.sesiones(id_sesion,id_usuario,hash_token_sesion,fecha_inicio,fecha_expiracion)
SELECT gen_random_uuid(),usuario_id,btrim(token_hash),NULL,to_timestamp(expira_epoch)
FROM agroconecta_legacy.sesiones;

INSERT INTO public.cultivos(id_cultivo,id_usuario,nombre,variedad,duracion_ciclo_dias,observaciones,
  activo,origen_imagen,url_imagen,credito_imagen,licencia_imagen,id_taxon_imagen,ruta_fotografia,
  version_fotografia,fecha_creacion,fecha_actualizacion)
SELECT c.id,c.usuario_id,c.nombre,c.variedad,c.ciclo_dias,c.notas,c.activo,
  coalesce(c.datos_json->>'image_source',''),coalesce(c.datos_json->>'image_url',''),
  coalesce(c.datos_json->>'image_credit',''),coalesce(c.datos_json->>'image_license',''),
  nullif(c.datos_json->>'image_taxon_id','')::integer,
  nullif(c.datos_json->>'crop_photo_path',''),nullif(c.datos_json->>'crop_photo_version','')::uuid,
  c.creado_en,c.actualizado_en
FROM agroconecta_legacy.cultivos c;

INSERT INTO public.parcelas(id_parcela,id_usuario,id_cultivo,nombre,ubicacion,superficie_hectareas,
  latitud,longitud,tipo_suelo,observaciones,activa,ruta_fotografia,version_fotografia,
  fecha_creacion,fecha_actualizacion)
SELECT p.id,p.usuario_id,p.cultivo_id,p.nombre,p.ubicacion,p.area_ha,p.latitud,p.longitud,p.suelo,
  p.notas,p.activa,coalesce(p.foto_ruta,nullif(p.datos_json->>'photo_path','')),
  coalesce(p.foto_version,nullif(p.datos_json->>'photo_version','')::uuid),p.creado_en,p.actualizado_en
FROM agroconecta_legacy.parcelas p;

INSERT INTO public.plantillas(id_plantilla,id_usuario,nombre,tipo_plantilla,titulo_actividad,
  categoria,descripcion,fecha_creacion,fecha_actualizacion)
SELECT t.id,t.usuario_id,t.nombre,
  CASE WHEN t.datos_json->>'purpose'='harvest' THEN 'proceso' ELSE 'actividad' END,
  CASE WHEN t.datos_json->>'purpose'='harvest' THEN NULL ELSE coalesce(t.datos_json->>'title',t.titulo) END,
  CASE WHEN t.datos_json->>'purpose'='harvest' THEN NULL ELSE coalesce(t.datos_json->>'category',t.categoria) END,
  coalesce(t.datos_json->>'notes',t.notas),t.creado_en,t.actualizado_en
FROM agroconecta_legacy.plantillas t;

INSERT INTO public.etapas_plantilla(id_etapa_plantilla,id_plantilla,numero_orden,nombre_etapa)
SELECT gen_random_uuid(),t.id,e.ordinality::smallint,e.value
FROM agroconecta_legacy.plantillas t
CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(t.datos_json->'steps','[]'::jsonb)) WITH ORDINALITY e(value,ordinality)
WHERE t.datos_json->>'purpose'='harvest';

INSERT INTO public.actividades(id_actividad,id_parcela,titulo,fecha_programada,categoria,estado,
  observaciones,fecha_creacion,fecha_actualizacion)
SELECT a.id,a.parcela_id,a.titulo,a.fecha,a.categoria,a.estado,a.notas,a.creado_en,a.actualizado_en
FROM agroconecta_legacy.actividades a;

INSERT INTO public.cosechas(id_cosecha,id_parcela,id_cultivo_origen,codigo_lote,
  nombre_cultivo_historico,variedad_historica,fecha_cosecha,cantidad_inicial_kg,tipo_proceso,
  id_plantilla_origen,nombre_plantilla_origen,observaciones,fecha_creacion,fecha_actualizacion)
SELECT h.id,h.parcela_id,nullif(h.datos_json->>'crop_id','')::uuid,h.codigo,
  nullif(h.datos_json->>'crop_name_historical',''),
  nullif(h.datos_json->>'variety_historical',''),h.fecha,h.cantidad_inicial,
  CASE WHEN h.datos_json->>'process_mode'='custom' THEN 'personalizado' ELSE 'estandar' END,
  nullif(h.datos_json->>'process_template_id','')::uuid,
  nullif(h.datos_json->>'process_template_name',''),h.notas,h.creado_en,h.actualizado_en
FROM agroconecta_legacy.cosechas h;

INSERT INTO public.etapas_cosecha(id_etapa_cosecha,id_cosecha,numero_orden,nombre_etapa,
  cantidad_restante_kg,fecha_finalizacion,observaciones)
  SELECT gen_random_uuid(),h.id,plan.ordinality::smallint,plan.value,
  CASE WHEN h.datos_json->>'process_mode'='custom' THEN (hist.event->>'quantity')::numeric ELSE legacy.cantidad END,
  CASE WHEN h.datos_json->>'process_mode'='custom' THEN (hist.event->>'date')::timestamptz ELSE legacy.fecha_utc END,
  CASE WHEN h.datos_json->>'process_mode'='custom' THEN coalesce(hist.event->>'notes','') ELSE coalesce(legacy.notas,'') END
FROM agroconecta_legacy.cosechas h
CROSS JOIN LATERAL jsonb_array_elements_text(h.datos_json->'process_steps') WITH ORDINALITY plan(value,ordinality)
LEFT JOIN LATERAL (
  SELECT e AS event FROM jsonb_array_elements(coalesce(nullif(h.datos_json->'stage_history','null'::jsonb),nullif(h.datos_json->'stages','null'::jsonb),'[]'::jsonb))
    WITH ORDINALITY x(e,ordinality) WHERE x.ordinality=plan.ordinality
) hist ON h.datos_json->>'process_mode'='custom'
LEFT JOIN agroconecta_legacy.etapas_lote legacy
  ON legacy.cosecha_id=h.id AND legacy.usuario_id=h.usuario_id AND legacy.orden=plan.ordinality
  AND h.datos_json->>'process_mode'<>'custom';

INSERT INTO public.bitacora(id_bitacora,id_usuario,id_registro_afectado,id_parcela_referencia,
  tipo_entidad,nombre_registro,accion_realizada,fecha_registro)
SELECT b.id,b.usuario_id,b.registro_id,b.parcela_id,b.tipo,b.etiqueta,b.accion,b.fecha_utc
FROM agroconecta_legacy.bitacora b;

INSERT INTO public.alertas(id_alerta,id_usuario,codigo_alerta,revisada,fecha_actualizacion)
SELECT gen_random_uuid(),a.usuario_id,a.alerta_id,a.revisada,a.actualizado_en
FROM agroconecta_legacy.alertas_revisadas a;

-- Verificaciones posteriores: cualquier incumplimiento aborta la transacción.
DO $verify$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM agroconecta_legacy.usuarios l
  LEFT JOIN public.usuarios v ON v.id_usuario=l.id WHERE v.id_usuario IS NULL;
  IF n>0 THEN RAISE EXCEPTION 'Migración incompleta: % usuarios no copiados',n; END IF;
  SELECT count(*) INTO n FROM agroconecta_legacy.cosechas l
  LEFT JOIN public.cosechas v ON v.id_cosecha=l.id WHERE v.id_cosecha IS NULL;
  IF n>0 THEN RAISE EXCEPTION 'Migración incompleta: % cosechas no copiadas',n; END IF;
  SELECT count(*) INTO n FROM agroconecta_legacy.etapas_lote l
  WHERE l.etapa IS NOT NULL AND l.usuario_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.etapas_cosecha v
      WHERE v.id_cosecha=l.cosecha_id AND v.numero_orden=l.orden AND v.nombre_etapa=l.etapa);
  IF n>0 THEN RAISE EXCEPTION 'Migración incompleta: % eventos de etapa estándar no copiados',n; END IF;
END
$verify$;

-- AgroConecta V20: contrato PostgreSQL invocado por PostgresStore.
-- Requiere el esquema de 05_Modelo_11_Tablas_V20.sql.
BEGIN;

CREATE OR REPLACE FUNCTION public.agro_validar_propietario_cosecha()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
AS $fn$
DECLARE parcela_usuario uuid; cultivo_usuario uuid;
BEGIN
  IF NEW.id_cultivo_origen IS NULL THEN RETURN NEW; END IF;
  SELECT id_usuario INTO parcela_usuario FROM public.parcelas WHERE id_parcela=NEW.id_parcela;
  SELECT id_usuario INTO cultivo_usuario FROM public.cultivos WHERE id_cultivo=NEW.id_cultivo_origen;
  IF parcela_usuario IS NULL OR cultivo_usuario IS DISTINCT FROM parcela_usuario THEN
    RAISE EXCEPTION 'El cultivo de origen y la parcela deben pertenecer al mismo usuario';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS tr_cosechas_propietario ON public.cosechas;
CREATE TRIGGER tr_cosechas_propietario
BEFORE INSERT OR UPDATE OF id_parcela, id_cultivo_origen ON public.cosechas
FOR EACH ROW EXECUTE FUNCTION public.agro_validar_propietario_cosecha();

CREATE OR REPLACE FUNCTION public.agro_records(k text, o uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
AS $fn$
DECLARE result jsonb;
BEGIN
  CASE k
  WHEN 'crops' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',c.id_cultivo,'owner',c.id_usuario,'kind','crops','name',c.nombre,
      'variety',c.variedad,'cycle_days',c.duracion_ciclo_dias,'notes',c.observaciones,
      'active',c.activo,'image_source',c.origen_imagen,'image_url',c.url_imagen,
      'image_credit',c.credito_imagen,'image_license',c.licencia_imagen,
      'image_taxon_id',c.id_taxon_imagen,'crop_photo_path',c.ruta_fotografia,
      'crop_photo_version',c.version_fotografia,'created_at',c.fecha_creacion,
      'updated_at',c.fecha_actualizacion) ORDER BY c.fecha_creacion DESC),'[]'::jsonb)
    INTO result FROM public.cultivos c WHERE o IS NULL OR c.id_usuario=o;
  WHEN 'plots' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',p.id_parcela,'owner',p.id_usuario,'kind','plots','crop_id',coalesce(p.id_cultivo::text,''),
      'name',p.nombre,'location',p.ubicacion,'area',p.superficie_hectareas,
      'latitude',p.latitud,'longitude',p.longitud,'soil',p.tipo_suelo,
      'notes',p.observaciones,'active',p.activa,'photo_path',p.ruta_fotografia,
      'photo_version',p.version_fotografia,'created_at',p.fecha_creacion,
      'updated_at',p.fecha_actualizacion) ORDER BY p.fecha_creacion DESC),'[]'::jsonb)
    INTO result FROM public.parcelas p WHERE o IS NULL OR p.id_usuario=o;
  WHEN 'templates' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',t.id_plantilla,'owner',t.id_usuario,'kind','templates','name',t.nombre,
      'purpose',CASE t.tipo_plantilla WHEN 'proceso' THEN 'harvest' ELSE 'activity' END,
      'title',coalesce(t.titulo_actividad,t.nombre),'category',coalesce(t.categoria,'Poscosecha'),
      'notes',t.descripcion,'steps',coalesce((
        SELECT jsonb_agg(e.nombre_etapa ORDER BY e.numero_orden)
        FROM public.etapas_plantilla e WHERE e.id_plantilla=t.id_plantilla),'[]'::jsonb),
      'created_at',t.fecha_creacion,'updated_at',t.fecha_actualizacion)
      ORDER BY t.fecha_creacion DESC),'[]'::jsonb)
    INTO result FROM public.plantillas t WHERE o IS NULL OR t.id_usuario=o;
  WHEN 'activities' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id_actividad,'owner',p.id_usuario,'kind','activities','title',a.titulo,
      'plot_id',a.id_parcela,'date',a.fecha_programada,'category',a.categoria,
      'status',a.estado,'notes',a.observaciones,'created_at',a.fecha_creacion,
      'updated_at',a.fecha_actualizacion) ORDER BY a.fecha_programada,a.id_actividad),'[]'::jsonb)
    INTO result FROM public.actividades a JOIN public.parcelas p ON p.id_parcela=a.id_parcela
    WHERE o IS NULL OR p.id_usuario=o;
  WHEN 'harvests' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',h.id_cosecha,'owner',p.id_usuario,'kind','harvests','plot_id',h.id_parcela,
      'crop_id',coalesce(h.id_cultivo_origen::text,''),'code',h.codigo_lote,
      'crop_name_historical',h.nombre_cultivo_historico,
      'variety_historical',h.variedad_historica,
      'date',h.fecha_cosecha,'quantity',h.cantidad_inicial_kg,
      'current_quantity',coalesce(last_done.cantidad_restante_kg,h.cantidad_inicial_kg),
      'stage',coalesce(last_done.nombre_etapa,'Cosechado'),
      'notes',h.observaciones,'process_mode',CASE h.tipo_proceso WHEN 'personalizado' THEN 'custom' ELSE 'legacy' END,
      'process_steps',coalesce(plan.steps,'["Cosechado","Procesamiento","Secado","Almacenado","Cerrado"]'::jsonb),
      'stages',coalesce(history.events,'[]'::jsonb),
      'stage_history',CASE WHEN h.tipo_proceso='personalizado' THEN coalesce(history.events,'[]'::jsonb) ELSE NULL END,
      'process_template_id',coalesce(h.id_plantilla_origen::text,''),
      'process_template_name',h.nombre_plantilla_origen,
      'created_at',h.fecha_creacion,'updated_at',h.fecha_actualizacion)
      ORDER BY h.fecha_cosecha DESC,h.id_cosecha),'[]'::jsonb)
    INTO result
    FROM public.cosechas h
    JOIN public.parcelas p ON p.id_parcela=h.id_parcela
    LEFT JOIN LATERAL (
      SELECT e.nombre_etapa,e.cantidad_restante_kg FROM public.etapas_cosecha e
      WHERE e.id_cosecha=h.id_cosecha AND e.fecha_finalizacion IS NOT NULL
      ORDER BY e.numero_orden DESC LIMIT 1
    ) last_done ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(e.nombre_etapa ORDER BY e.numero_orden) AS steps
      FROM public.etapas_cosecha e WHERE e.id_cosecha=h.id_cosecha
    ) plan ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('stage',e.nombre_etapa,
        'quantity',e.cantidad_restante_kg,'date',e.fecha_finalizacion,
        'notes',e.observaciones) ORDER BY e.numero_orden) AS events
      FROM public.etapas_cosecha e
      WHERE e.id_cosecha=h.id_cosecha AND e.fecha_finalizacion IS NOT NULL
    ) history ON true
    WHERE o IS NULL OR p.id_usuario=o;
  ELSE
    RAISE EXCEPTION 'Entidad no permitida: %',k;
  END CASE;
  RETURN result;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.agro_save_record(k text, r jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
AS $fn$
DECLARE affected integer; rid uuid; uid uuid; plot uuid; crop uuid; step text;
        step_order integer; process_type text; is_new boolean; steps_json jsonb;
BEGIN
  IF r->>'kind' IS DISTINCT FROM k OR r->>'id' IS NULL OR r->>'owner' IS NULL THEN
    RAISE EXCEPTION 'Registro incompleto o tipo incorrecto';
  END IF;
  rid := (r->>'id')::uuid; uid := (r->>'owner')::uuid;
  CASE k
  WHEN 'crops' THEN
    INSERT INTO public.cultivos(id_cultivo,id_usuario,nombre,variedad,duracion_ciclo_dias,
      observaciones,activo,origen_imagen,url_imagen,credito_imagen,licencia_imagen,
      id_taxon_imagen,ruta_fotografia,version_fotografia)
    SELECT rid,u.id_usuario,r->>'name',coalesce(r->>'variety',''),coalesce((r->>'cycle_days')::integer,0),
      coalesce(r->>'notes',''),coalesce((r->>'active')::boolean,true),coalesce(r->>'image_source',''),
      coalesce(r->>'image_url',''),coalesce(r->>'image_credit',''),coalesce(r->>'image_license',''),
      nullif(r->>'image_taxon_id','')::integer,nullif(r->>'crop_photo_path',''),
      nullif(r->>'crop_photo_version','')::uuid
    FROM public.usuarios u WHERE u.id_usuario=uid
    ON CONFLICT(id_cultivo) DO UPDATE SET nombre=excluded.nombre,variedad=excluded.variedad,
      duracion_ciclo_dias=excluded.duracion_ciclo_dias,observaciones=excluded.observaciones,
      activo=excluded.activo,origen_imagen=excluded.origen_imagen,url_imagen=excluded.url_imagen,
      credito_imagen=excluded.credito_imagen,licencia_imagen=excluded.licencia_imagen,
      id_taxon_imagen=excluded.id_taxon_imagen,ruta_fotografia=excluded.ruta_fotografia,
      version_fotografia=excluded.version_fotografia,fecha_actualizacion=now()
      WHERE cultivos.id_usuario=uid;
    GET DIAGNOSTICS affected=ROW_COUNT;
  WHEN 'plots' THEN
    plot := nullif(r->>'crop_id','')::uuid;
    INSERT INTO public.parcelas(id_parcela,id_usuario,id_cultivo,nombre,ubicacion,
      superficie_hectareas,latitud,longitud,tipo_suelo,observaciones,activa,
      ruta_fotografia,version_fotografia)
    SELECT rid,u.id_usuario,plot,r->>'name',r->>'location',(r->>'area')::numeric,
      (r->>'latitude')::numeric,(r->>'longitude')::numeric,coalesce(r->>'soil',''),
      coalesce(r->>'notes',''),coalesce((r->>'active')::boolean,true),
      nullif(r->>'photo_path',''),nullif(r->>'photo_version','')::uuid
    FROM public.usuarios u WHERE u.id_usuario=uid
    ON CONFLICT(id_parcela) DO UPDATE SET id_cultivo=excluded.id_cultivo,nombre=excluded.nombre,
      ubicacion=excluded.ubicacion,superficie_hectareas=excluded.superficie_hectareas,
      latitud=excluded.latitud,longitud=excluded.longitud,tipo_suelo=excluded.tipo_suelo,
      observaciones=excluded.observaciones,activa=excluded.activa,
      ruta_fotografia=excluded.ruta_fotografia,version_fotografia=excluded.version_fotografia,
      fecha_actualizacion=now() WHERE parcelas.id_usuario=uid;
    GET DIAGNOSTICS affected=ROW_COUNT;
  WHEN 'templates' THEN
    process_type := CASE WHEN r->>'purpose'='harvest' THEN 'proceso' ELSE 'actividad' END;
    steps_json := coalesce(nullif(r->'steps','null'::jsonb),'[]'::jsonb);
    IF process_type='proceso' AND jsonb_typeof(steps_json) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Las etapas de la plantilla deben ser una lista';
    END IF;
    IF process_type='proceso' AND jsonb_array_length(steps_json) NOT BETWEEN 1 AND 10 THEN
      RAISE EXCEPTION 'La plantilla de proceso debe tener entre 1 y 10 etapas';
    END IF;
    INSERT INTO public.plantillas(id_plantilla,id_usuario,nombre,tipo_plantilla,
      titulo_actividad,categoria,descripcion)
    SELECT rid,u.id_usuario,r->>'name',process_type,
      CASE WHEN process_type='actividad' THEN r->>'title' ELSE NULL END,
      CASE WHEN process_type='actividad' THEN coalesce(r->>'category','Otra') ELSE NULL END,
      coalesce(r->>'notes','') FROM public.usuarios u WHERE u.id_usuario=uid
    ON CONFLICT(id_plantilla) DO UPDATE SET nombre=excluded.nombre,
      tipo_plantilla=excluded.tipo_plantilla,titulo_actividad=excluded.titulo_actividad,
      categoria=excluded.categoria,descripcion=excluded.descripcion,fecha_actualizacion=now()
      WHERE plantillas.id_usuario=uid;
    GET DIAGNOSTICS affected=ROW_COUNT;
    is_new := affected=1;
    IF is_new AND process_type='proceso' THEN
      DELETE FROM public.etapas_plantilla WHERE id_plantilla=rid;
      FOR step,step_order IN
        SELECT value,ordinality::integer FROM jsonb_array_elements_text(coalesce(r->'steps','[]'::jsonb)) WITH ORDINALITY
      LOOP
        INSERT INTO public.etapas_plantilla(id_etapa_plantilla,id_plantilla,numero_orden,nombre_etapa)
        VALUES(gen_random_uuid(),rid,step_order,step);
      END LOOP;
    ELSIF is_new THEN
      DELETE FROM public.etapas_plantilla WHERE id_plantilla=rid;
    END IF;
  WHEN 'activities' THEN
    plot := (r->>'plot_id')::uuid;
    INSERT INTO public.actividades(id_actividad,id_parcela,titulo,fecha_programada,categoria,
      estado,observaciones)
    SELECT rid,p.id_parcela,r->>'title',(r->>'date')::date,coalesce(r->>'category','Otra'),
      coalesce(r->>'status','Pendiente'),coalesce(r->>'notes','')
    FROM public.parcelas p WHERE p.id_parcela=plot AND p.id_usuario=uid
    ON CONFLICT(id_actividad) DO UPDATE SET id_parcela=excluded.id_parcela,
      titulo=excluded.titulo,fecha_programada=excluded.fecha_programada,
      categoria=excluded.categoria,estado=excluded.estado,observaciones=excluded.observaciones,
      fecha_actualizacion=now()
    WHERE EXISTS (SELECT 1 FROM public.parcelas oldp
      WHERE oldp.id_parcela=actividades.id_parcela AND oldp.id_usuario=uid);
    GET DIAGNOSTICS affected=ROW_COUNT;
  WHEN 'harvests' THEN
    plot := (r->>'plot_id')::uuid;
    crop := nullif(r->>'crop_id','')::uuid;
    process_type := CASE WHEN r->>'process_mode'='custom' THEN 'personalizado' ELSE 'estandar' END;
    steps_json := coalesce(nullif(r->'process_steps','null'::jsonb),
      '["Cosechado","Procesamiento","Secado","Almacenado","Cerrado"]'::jsonb);
    IF jsonb_typeof(steps_json) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Las etapas del lote deben ser una lista';
    END IF;
    IF jsonb_array_length(steps_json) NOT BETWEEN 2 AND 12
       OR steps_json->>0<>'Cosechado'
       OR steps_json->>(jsonb_array_length(steps_json)-1)<>'Cerrado' THEN
      RAISE EXCEPTION 'El proceso debe iniciar en Cosechado y terminar en Cerrado';
    END IF;
    is_new := NOT EXISTS (SELECT 1 FROM public.cosechas h WHERE h.id_cosecha=rid);
    INSERT INTO public.cosechas(id_cosecha,id_parcela,id_cultivo_origen,codigo_lote,
      nombre_cultivo_historico,variedad_historica,fecha_cosecha,cantidad_inicial_kg,
      tipo_proceso,id_plantilla_origen,nombre_plantilla_origen,observaciones)
    SELECT rid,p.id_parcela,c.id_cultivo,r->>'code',nullif(r->>'crop_name_historical',''),
      nullif(r->>'variety_historical',''),(r->>'date')::date,
      (r->>'quantity')::numeric,process_type,nullif(r->>'process_template_id','')::uuid,
      nullif(r->>'process_template_name',''),coalesce(r->>'notes','')
    FROM public.parcelas p
    LEFT JOIN public.cultivos c ON c.id_cultivo=crop AND c.id_usuario=uid
    WHERE p.id_parcela=plot AND p.id_usuario=uid
      AND (crop IS NULL OR (c.id_cultivo IS NOT NULL AND c.id_usuario=p.id_usuario))
    ON CONFLICT(id_cosecha) DO UPDATE SET observaciones=excluded.observaciones,
      fecha_actualizacion=now()
      WHERE EXISTS (SELECT 1 FROM public.parcelas oldp
        WHERE oldp.id_parcela=cosechas.id_parcela AND oldp.id_usuario=uid);
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected=1 AND is_new THEN
      FOR step,step_order IN
        SELECT value,ordinality::integer FROM jsonb_array_elements_text(
          steps_json) WITH ORDINALITY
      LOOP
        INSERT INTO public.etapas_cosecha(id_etapa_cosecha,id_cosecha,numero_orden,nombre_etapa)
        VALUES(gen_random_uuid(),rid,step_order,step);
      END LOOP;
    END IF;
  ELSE
    RAISE EXCEPTION 'Entidad no autorizada';
  END CASE;
  IF affected <> 1 THEN RAISE EXCEPTION 'Registro inexistente o pertenece a otro usuario'; END IF;
  RETURN true;
END;
$fn$;

CREATE OR REPLACE PROCEDURE public.agro_exec(
  IN p_action text, IN p_params jsonb, INOUT p_result jsonb DEFAULT NULL)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
AS $proc$
DECLARE u uuid; k text; r jsonb; n integer; s text; idx integer;
        prior_qty numeric; initial_qty numeric; result_row jsonb;
BEGIN
  CASE p_action
  WHEN 'health' THEN p_result := jsonb_build_object('version',20);
  WHEN 'lock' THEN
    IF p_params ? 'owner' AND p_params->>'owner' IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(861902174,hashtext(p_params->>'owner'));
    ELSE PERFORM pg_advisory_xact_lock(861902174); END IF;
    p_result := '{}'::jsonb;
  WHEN 'list' THEN
    p_result := public.agro_records(p_params->>'kind',(p_params->>'owner')::uuid);
  WHEN 'list_multiple' THEN
    SELECT coalesce(jsonb_agg(item),'[]'::jsonb) INTO p_result FROM (
      SELECT jsonb_array_elements(public.agro_records('crops',(p_params->>'owner')::uuid)) item WHERE (p_params->'kinds') ? 'crops'
      UNION ALL SELECT jsonb_array_elements(public.agro_records('plots',(p_params->>'owner')::uuid)) WHERE (p_params->'kinds') ? 'plots'
      UNION ALL SELECT jsonb_array_elements(public.agro_records('templates',(p_params->>'owner')::uuid)) WHERE (p_params->'kinds') ? 'templates'
      UNION ALL SELECT jsonb_array_elements(public.agro_records('activities',(p_params->>'owner')::uuid)) WHERE (p_params->'kinds') ? 'activities'
      UNION ALL SELECT jsonb_array_elements(public.agro_records('harvests',(p_params->>'owner')::uuid)) WHERE (p_params->'kinds') ? 'harvests'
    ) records;
  WHEN 'get' THEN
    k := p_params->>'kind';
    SELECT item INTO p_result FROM jsonb_array_elements(public.agro_records(k,(p_params->>'owner')::uuid)) item
    WHERE item->>'id'=p_params->>'id' LIMIT 1;
    p_result := coalesce(p_result,'null'::jsonb);
  WHEN 'save' THEN
    PERFORM public.agro_save_record(p_params->>'kind',p_params->'record');
    p_result := jsonb_build_object('ok',true);
  WHEN 'remove' THEN
    k := p_params->>'kind'; u := (p_params->>'owner')::uuid;
    IF k='activities' THEN
      DELETE FROM public.actividades a USING public.parcelas p
      WHERE a.id_actividad=(p_params->>'id')::uuid AND p.id_parcela=a.id_parcela AND p.id_usuario=u;
    ELSIF k='templates' THEN
      DELETE FROM public.plantillas WHERE id_plantilla=(p_params->>'id')::uuid AND id_usuario=u;
    ELSE RAISE EXCEPTION 'Eliminación no permitida'; END IF;
    GET DIAGNOSTICS n=ROW_COUNT; p_result := jsonb_build_object('ok',n=1);
  WHEN 'stage' THEN
    u := (p_params->>'owner')::uuid; r := p_params->'stage';
    idx := (p_params->>'order')::integer;
    SELECT c.cantidad_inicial_kg INTO initial_qty
    FROM public.cosechas c JOIN public.parcelas p ON p.id_parcela=c.id_parcela
    WHERE c.id_cosecha=(p_params->>'harvest')::uuid AND p.id_usuario=u FOR UPDATE OF c;
    IF initial_qty IS NULL THEN RAISE EXCEPTION 'Lote no encontrado'; END IF;
    IF idx=1 THEN
      IF r->>'stage' <> 'Cosechado' OR (r->>'quantity')::numeric <> initial_qty THEN
        RAISE EXCEPTION 'El evento inicial debe conservar la cantidad cosechada';
      END IF;
    ELSE
      SELECT e.cantidad_restante_kg INTO prior_qty FROM public.etapas_cosecha e
      WHERE e.id_cosecha=(p_params->>'harvest')::uuid AND e.numero_orden=idx-1
        AND e.fecha_finalizacion IS NOT NULL;
      IF prior_qty IS NULL THEN RAISE EXCEPTION 'Solo se puede completar la siguiente etapa'; END IF;
      IF (r->>'quantity')::numeric > prior_qty THEN RAISE EXCEPTION 'La cantidad no puede aumentar'; END IF;
    END IF;
    UPDATE public.etapas_cosecha e SET cantidad_restante_kg=(r->>'quantity')::numeric,
      fecha_finalizacion=(r->>'date')::timestamptz,observaciones=coalesce(r->>'notes','')
    FROM public.cosechas c JOIN public.parcelas p ON p.id_parcela=c.id_parcela
    WHERE e.id_cosecha=c.id_cosecha AND c.id_cosecha=(p_params->>'harvest')::uuid
      AND p.id_usuario=u AND e.numero_orden=idx AND e.nombre_etapa=r->>'stage'
      AND e.fecha_finalizacion IS NULL;
    GET DIAGNOSTICS n=ROW_COUNT;
    IF n<>1 THEN RAISE EXCEPTION 'Etapa inexistente, ya completada o fuera de orden'; END IF;
    p_result := jsonb_build_object('ok',true);
  WHEN 'event' THEN
    r := p_params->'event';
    IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id_usuario=(r->>'owner')::uuid) THEN
      RAISE EXCEPTION 'Usuario de bitácora inexistente';
    END IF;
    IF nullif(r->>'plot_id','') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.parcelas WHERE id_parcela=(r->>'plot_id')::uuid AND id_usuario=(r->>'owner')::uuid
    ) THEN RAISE EXCEPTION 'Parcela de bitácora no autorizada'; END IF;
    INSERT INTO public.bitacora(id_bitacora,id_usuario,id_registro_afectado,id_parcela_referencia,
      tipo_entidad,nombre_registro,accion_realizada,fecha_registro)
    VALUES((r->>'id')::uuid,(r->>'owner')::uuid,(r->>'record_id')::uuid,
      nullif(r->>'plot_id','')::uuid,r->>'kind',r->>'label',r->>'action',(r->>'date')::timestamptz);
    p_result := jsonb_build_object('ok',true);
  WHEN 'user_email' THEN
    SELECT jsonb_build_object('id',id_usuario,'name',nombre,'email',correo_electronico,
      'salt',btrim(sal_criptografica),'hash',btrim(contrasena_hash))
    INTO p_result FROM public.usuarios WHERE lower(correo_electronico)=lower(p_params->>'email') LIMIT 1;
    p_result := coalesce(p_result,'null'::jsonb);
  WHEN 'add_user' THEN
    r := p_params->'user';
    INSERT INTO public.usuarios(id_usuario,nombre,correo_electronico,sal_criptografica,contrasena_hash)
    VALUES((r->>'id')::uuid,r->>'name',r->>'email',r->>'salt',r->>'hash') ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n=ROW_COUNT; p_result := jsonb_build_object('ok',n=1);
  WHEN 'add_session' THEN
    r := p_params->'session';
    INSERT INTO public.sesiones(id_sesion,id_usuario,hash_token_sesion,fecha_inicio,fecha_expiracion)
    VALUES(gen_random_uuid(),(r->>'user_id')::uuid,p_params->>'token',
      CASE WHEN (p_params->>'now')::double precision>0 THEN to_timestamp((p_params->>'now')::double precision) ELSE now() END,
      to_timestamp((r->>'expires')::double precision))
    ON CONFLICT(hash_token_sesion) DO UPDATE SET fecha_expiracion=excluded.fecha_expiracion;
    IF (p_params->>'now')::double precision>0 THEN
      DELETE FROM public.sesiones WHERE fecha_expiracion<to_timestamp((p_params->>'now')::double precision);
    END IF;
    p_result := jsonb_build_object('ok',true);
  WHEN 'session_user' THEN
    SELECT jsonb_build_object('id',u.id_usuario,'name',u.nombre,'email',u.correo_electronico,
      'salt',btrim(u.sal_criptografica),'hash',btrim(u.contrasena_hash)) INTO p_result
    FROM public.sesiones s JOIN public.usuarios u ON u.id_usuario=s.id_usuario
    WHERE s.hash_token_sesion=p_params->>'token' AND s.fecha_expiracion>to_timestamp((p_params->>'now')::double precision);
    p_result := coalesce(p_result,'null'::jsonb);
  WHEN 'delete_session' THEN
    DELETE FROM public.sesiones WHERE hash_token_sesion=p_params->>'token';
    p_result := jsonb_build_object('ok',true);
  WHEN 'events' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id_bitacora,
      'record_id',b.id_registro_afectado,'plot_id',b.id_parcela_referencia,
      'kind',b.tipo_entidad,'label',b.nombre_registro,'action',b.accion_realizada,
      'date',b.fecha_registro) ORDER BY b.fecha_registro DESC,b.id_bitacora DESC),'[]'::jsonb)
    INTO p_result FROM public.bitacora b WHERE b.id_usuario=(p_params->>'owner')::uuid;
  WHEN 'summary' THEN
    u := (p_params->>'owner')::uuid;
    SELECT jsonb_build_object(
      'active_plots',(SELECT count(*) FROM public.parcelas WHERE id_usuario=u AND activa),
      'area',(SELECT coalesce(sum(superficie_hectareas),0) FROM public.parcelas WHERE id_usuario=u AND activa),
      'pending',(SELECT count(*) FROM public.actividades a JOIN public.parcelas p ON p.id_parcela=a.id_parcela WHERE p.id_usuario=u AND a.estado IN ('Pendiente','En curso')),
      'harvest_kg',(SELECT coalesce(sum(h.cantidad_inicial_kg),0) FROM public.cosechas h JOIN public.parcelas p ON p.id_parcela=h.id_parcela WHERE p.id_usuario=u),
      'current_kg',(SELECT coalesce(sum(coalesce(last_done.cantidad_restante_kg,h.cantidad_inicial_kg)),0)
        FROM public.cosechas h JOIN public.parcelas p ON p.id_parcela=h.id_parcela
        LEFT JOIN LATERAL (SELECT e.cantidad_restante_kg FROM public.etapas_cosecha e WHERE e.id_cosecha=h.id_cosecha AND e.fecha_finalizacion IS NOT NULL ORDER BY e.numero_orden DESC LIMIT 1) last_done ON true
        WHERE p.id_usuario=u),
      'completed',(SELECT count(*) FROM public.actividades a JOIN public.parcelas p ON p.id_parcela=a.id_parcela WHERE p.id_usuario=u AND a.estado='Completada'))
    INTO p_result;
  WHEN 'reviews' THEN
    SELECT coalesce(jsonb_agg(codigo_alerta),'[]'::jsonb) INTO p_result
    FROM public.alertas WHERE id_usuario=(p_params->>'owner')::uuid AND revisada=true;
  WHEN 'review' THEN
    u := (p_params->>'owner')::uuid;
    IF (p_params->>'reviewed')::boolean THEN
      INSERT INTO public.alertas(id_alerta,id_usuario,codigo_alerta,revisada)
      VALUES(gen_random_uuid(),u,p_params->>'alert',true)
      ON CONFLICT(id_usuario,codigo_alerta) DO UPDATE SET revisada=true,fecha_actualizacion=now();
    ELSE
      DELETE FROM public.alertas WHERE id_usuario=u AND codigo_alerta=p_params->>'alert';
    END IF;
    p_result := jsonb_build_object('ok',true);
  WHEN 'snapshot' THEN
    SELECT jsonb_build_object('version',1,
      'users',coalesce((SELECT jsonb_object_agg(id_usuario::text,jsonb_build_object('id',id_usuario,'name',nombre,'email',correo_electronico,'salt',btrim(sal_criptografica),'hash',btrim(contrasena_hash))) FROM public.usuarios),'{}'::jsonb),
      'sessions',coalesce((SELECT jsonb_object_agg(btrim(hash_token_sesion),jsonb_build_object('user_id',id_usuario,'expires',extract(epoch FROM fecha_expiracion))) FROM public.sesiones),'{}'::jsonb),
      'records',coalesce((SELECT jsonb_object_agg(x->>'id',x) FROM (
        SELECT jsonb_array_elements(public.agro_records('crops')) x UNION ALL
        SELECT jsonb_array_elements(public.agro_records('plots')) UNION ALL
        SELECT jsonb_array_elements(public.agro_records('templates')) UNION ALL
        SELECT jsonb_array_elements(public.agro_records('activities')) UNION ALL
        SELECT jsonb_array_elements(public.agro_records('harvests'))) all_records),'{}'::jsonb),
      'events',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id_bitacora,'owner',id_usuario,'record_id',id_registro_afectado,'plot_id',id_parcela_referencia,'kind',tipo_entidad,'label',nombre_registro,'action',accion_realizada,'date',fecha_registro) ORDER BY fecha_registro,id_bitacora) FROM public.bitacora),'[]'::jsonb),
      'alert_reviews',coalesce((SELECT jsonb_object_agg(id_usuario::text,reviews) FROM (
        SELECT id_usuario,jsonb_object_agg(codigo_alerta,true) reviews FROM public.alertas WHERE revisada=true GROUP BY id_usuario) x),'{}'::jsonb))
    INTO p_result;
  ELSE
    RAISE EXCEPTION 'Operación no permitida: %',p_action;
  END CASE;
END;
$proc$;

REVOKE ALL ON PROCEDURE public.agro_exec(text,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agro_records(text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agro_save_record(text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agro_validar_propietario_cosecha() FROM PUBLIC;
GRANT EXECUTE ON PROCEDURE public.agro_exec(text,jsonb,jsonb) TO postgres;
GRANT EXECUTE ON FUNCTION public.agro_records(text,uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.agro_save_record(text,jsonb) TO postgres;
COMMIT;

-- AGROCONECTA V18: EJECUTAR EN SUPABASE SQL EDITOR, UNA SOLA VEZ.
-- No elimina usuarios, parcelas, cosechas, fotos ni tablas existentes.
-- La app utiliza exclusivamente CALL public.agro_exec(...).
-- Requiere esquema actualizado con 06_Limpieza_V18_Supabase.sql.
BEGIN;
ALTER TABLE public.bitacora ADD COLUMN IF NOT EXISTS parcela_id uuid;
CREATE INDEX IF NOT EXISTS ix_bitacora_usuario_parcela ON public.bitacora(usuario_id,parcela_id,fecha_utc DESC);

CREATE OR REPLACE FUNCTION public.agro_records(k text, o uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
AS $fn$
DECLARE result jsonb;
BEGIN
  CASE k
    WHEN 'crops' THEN SELECT coalesce(jsonb_agg((t.datos_json) || jsonb_build_object('id',t.id,'owner',t.usuario_id,'kind','crops')),'[]'::jsonb) INTO result FROM public.cultivos t WHERE (o IS NULL OR t.usuario_id=o);
    WHEN 'plots' THEN SELECT coalesce(jsonb_agg((t.datos_json) || jsonb_build_object('photo_path',t.foto_ruta,'id',t.id,'owner',t.usuario_id,'kind','plots')),'[]'::jsonb) INTO result FROM public.parcelas t WHERE (o IS NULL OR t.usuario_id=o);
    WHEN 'templates' THEN SELECT coalesce(jsonb_agg((t.datos_json) || jsonb_build_object('id',t.id,'owner',t.usuario_id,'kind','templates')),'[]'::jsonb) INTO result FROM public.plantillas t WHERE (o IS NULL OR t.usuario_id=o);
    WHEN 'activities' THEN SELECT coalesce(jsonb_agg((t.datos_json) || jsonb_build_object('id',t.id,'owner',t.usuario_id,'kind','activities')),'[]'::jsonb) INTO result FROM public.actividades t WHERE (o IS NULL OR t.usuario_id=o);
    WHEN 'harvests' THEN SELECT coalesce(jsonb_agg((t.datos_json || jsonb_build_object('stages', CASE WHEN t.datos_json->>'process_mode'='custom' THEN coalesce(t.datos_json->'stage_history','[]'::jsonb) ELSE coalesce((SELECT jsonb_agg(jsonb_build_object('stage',s.etapa,'quantity',s.cantidad,'date',s.fecha_utc,'notes',s.notas) ORDER BY s.orden) FROM public.etapas_lote s WHERE s.cosecha_id=t.id AND s.usuario_id=t.usuario_id),'[]'::jsonb) END)) || jsonb_build_object('id',t.id,'owner',t.usuario_id,'kind','harvests')),'[]'::jsonb) INTO result FROM public.cosechas t WHERE (o IS NULL OR t.usuario_id=o);
    ELSE RAISE EXCEPTION 'Entidad no autorizada: %', k;
  END CASE;
  RETURN result;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.agro_save_record(k text, r jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
AS $fn$
DECLARE affected integer; payload jsonb;
BEGIN
  IF r->>'kind' IS DISTINCT FROM k OR r->>'id' IS NULL OR r->>'owner' IS NULL THEN
    RAISE EXCEPTION 'Registro incompleto o tipo incorrecto';
  END IF;
  CASE k
    WHEN 'crops' THEN
      payload := jsonb_build_object('id',r->>'id', 'usuario_id',r->>'owner', 'nombre',r->>'name', 'variedad',coalesce(r->>'variety',''), 'ciclo_dias',coalesce(r->>'cycle_days','0'), 'notas',coalesce(r->>'notes',''), 'activo',coalesce(r->>'active','true'), 'datos_json',r);
      INSERT INTO public.cultivos (id, usuario_id, nombre, variedad, ciclo_dias, notas, activo, datos_json)
      SELECT s.id, s.usuario_id, s.nombre, s.variedad, s.ciclo_dias, s.notas, s.activo, s.datos_json FROM jsonb_populate_record(NULL::public.cultivos,payload) s
      ON CONFLICT (id) DO UPDATE SET nombre=excluded.nombre, variedad=excluded.variedad, ciclo_dias=excluded.ciclo_dias, notas=excluded.notas, activo=excluded.activo, datos_json=excluded.datos_json, actualizado_en=now()
      WHERE cultivos.usuario_id=excluded.usuario_id;
    WHEN 'plots' THEN
      payload := jsonb_build_object('id',r->>'id', 'usuario_id',r->>'owner', 'cultivo_id',nullif(r->>'crop_id',''), 'nombre',r->>'name', 'ubicacion',r->>'location', 'area_ha',r->>'area', 'latitud',r->>'latitude', 'longitud',r->>'longitude', 'suelo',coalesce(r->>'soil',''), 'notas',coalesce(r->>'notes',''), 'activa',coalesce(r->>'active','true'), 'foto_version',r->>'photo_version', 'foto_ruta',r->>'photo_path', 'datos_json',r - 'photo_path');
      INSERT INTO public.parcelas (id, usuario_id, cultivo_id, nombre, ubicacion, area_ha, latitud, longitud, suelo, notas, activa, foto_version, foto_ruta, datos_json)
      SELECT s.id, s.usuario_id, s.cultivo_id, s.nombre, s.ubicacion, s.area_ha, s.latitud, s.longitud, s.suelo, s.notas, s.activa, s.foto_version, s.foto_ruta, s.datos_json FROM jsonb_populate_record(NULL::public.parcelas,payload) s
      ON CONFLICT (id) DO UPDATE SET cultivo_id=excluded.cultivo_id, nombre=excluded.nombre, ubicacion=excluded.ubicacion, area_ha=excluded.area_ha, latitud=excluded.latitud, longitud=excluded.longitud, suelo=excluded.suelo, notas=excluded.notas, activa=excluded.activa, foto_version=excluded.foto_version, foto_ruta=excluded.foto_ruta, datos_json=excluded.datos_json, actualizado_en=now()
      WHERE parcelas.usuario_id=excluded.usuario_id;
    WHEN 'templates' THEN
      payload := jsonb_build_object('id',r->>'id', 'usuario_id',r->>'owner', 'nombre',r->>'name', 'titulo',r->>'title', 'categoria',coalesce(r->>'category','Otra'), 'notas',coalesce(r->>'notes',''), 'datos_json',r);
      INSERT INTO public.plantillas (id, usuario_id, nombre, titulo, categoria, notas, datos_json)
      SELECT s.id, s.usuario_id, s.nombre, s.titulo, s.categoria, s.notas, s.datos_json FROM jsonb_populate_record(NULL::public.plantillas,payload) s
      ON CONFLICT (id) DO UPDATE SET nombre=excluded.nombre, titulo=excluded.titulo, categoria=excluded.categoria, notas=excluded.notas, datos_json=excluded.datos_json, actualizado_en=now()
      WHERE plantillas.usuario_id=excluded.usuario_id;
    WHEN 'activities' THEN
      payload := jsonb_build_object('id',r->>'id', 'usuario_id',r->>'owner', 'parcela_id',r->>'plot_id', 'titulo',r->>'title', 'fecha',r->>'date', 'categoria',coalesce(r->>'category','Otra'), 'estado',coalesce(r->>'status','Pendiente'), 'notas',coalesce(r->>'notes',''), 'datos_json',r);
      INSERT INTO public.actividades (id, usuario_id, parcela_id, titulo, fecha, categoria, estado, notas, datos_json)
      SELECT s.id, s.usuario_id, s.parcela_id, s.titulo, s.fecha, s.categoria, s.estado, s.notas, s.datos_json FROM jsonb_populate_record(NULL::public.actividades,payload) s
      ON CONFLICT (id) DO UPDATE SET parcela_id=excluded.parcela_id, titulo=excluded.titulo, fecha=excluded.fecha, categoria=excluded.categoria, estado=excluded.estado, notas=excluded.notas, datos_json=excluded.datos_json, actualizado_en=now()
      WHERE actividades.usuario_id=excluded.usuario_id;
    WHEN 'harvests' THEN
      payload := jsonb_build_object('id',r->>'id', 'usuario_id',r->>'owner', 'parcela_id',r->>'plot_id', 'codigo',r->>'code', 'fecha',r->>'date', 'cantidad_inicial',r->>'quantity', 'cantidad_actual',r->>'current_quantity', 'etapa',CASE WHEN r->>'process_mode'='custom' THEN CASE WHEN r->>'stage'='Cerrado' THEN 'Cerrado' WHEN r->>'stage'='Cosechado' THEN 'Cosechado' ELSE 'Procesamiento' END ELSE r->>'stage' END, 'notas',coalesce(r->>'notes',''), 'datos_json',r);
      INSERT INTO public.cosechas (id, usuario_id, parcela_id, codigo, fecha, cantidad_inicial, cantidad_actual, etapa, notas, datos_json)
      SELECT s.id, s.usuario_id, s.parcela_id, s.codigo, s.fecha, s.cantidad_inicial, s.cantidad_actual, s.etapa, s.notas, s.datos_json FROM jsonb_populate_record(NULL::public.cosechas,payload) s
      ON CONFLICT (id) DO UPDATE SET cantidad_actual=excluded.cantidad_actual, etapa=excluded.etapa, datos_json=excluded.datos_json, actualizado_en=now()
      WHERE cosechas.usuario_id=excluded.usuario_id;
    ELSE RAISE EXCEPTION 'Entidad no autorizada';
  END CASE;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'El registro pertenece a otro usuario'; END IF;
  RETURN true;
END;
$fn$;

CREATE OR REPLACE PROCEDURE public.agro_exec(
 IN p_action text, IN p_params jsonb, INOUT p_result jsonb DEFAULT NULL)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public
AS $proc$
DECLARE
  u uuid; k text; r jsonb; n integer; t text; result_row jsonb;
BEGIN
  CASE p_action
  WHEN 'health' THEN p_result := jsonb_build_object('version',18);
  WHEN 'lock' THEN
    IF p_params ? 'owner' AND p_params->>'owner' IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(861902174,hashtext(p_params->>'owner'));
    ELSE
      PERFORM pg_advisory_xact_lock(861902174);
    END IF;
    p_result := '{}'::jsonb;
  WHEN 'list' THEN
    p_result := public.agro_records(p_params->>'kind',(p_params->>'owner')::uuid);
  WHEN 'list_multiple' THEN
    -- Contrato fijo: solo entidades permitidas, sin SQL dinámico.
    SELECT coalesce(jsonb_agg(item),'[]'::jsonb) INTO p_result
    FROM (
      SELECT jsonb_array_elements(public.agro_records('crops',(p_params->>'owner')::uuid)) item
      WHERE (p_params->'kinds') ? 'crops'
      UNION ALL SELECT jsonb_array_elements(public.agro_records('plots',(p_params->>'owner')::uuid))
      WHERE (p_params->'kinds') ? 'plots'
      UNION ALL SELECT jsonb_array_elements(public.agro_records('templates',(p_params->>'owner')::uuid))
      WHERE (p_params->'kinds') ? 'templates'
      UNION ALL SELECT jsonb_array_elements(public.agro_records('activities',(p_params->>'owner')::uuid))
      WHERE (p_params->'kinds') ? 'activities'
      UNION ALL SELECT jsonb_array_elements(public.agro_records('harvests',(p_params->>'owner')::uuid))
      WHERE (p_params->'kinds') ? 'harvests'
    ) x;
  WHEN 'get' THEN
    k := p_params->>'kind';
    IF k='crops' THEN
      SELECT (t.datos_json) || jsonb_build_object('id',t.id,'owner',t.usuario_id,'kind','crops') INTO p_result
      FROM public.cultivos t WHERE t.id=(p_params->>'id')::uuid AND t.usuario_id=(p_params->>'owner')::uuid;
    ELSIF k='plots' THEN
      SELECT (t.datos_json) || jsonb_build_object('photo_path',t.foto_ruta,'id',t.id,'owner',t.usuario_id,'kind','plots') INTO p_result
      FROM public.parcelas t WHERE t.id=(p_params->>'id')::uuid AND t.usuario_id=(p_params->>'owner')::uuid;
    ELSIF k='templates' THEN
      SELECT (t.datos_json) || jsonb_build_object('id',t.id,'owner',t.usuario_id,'kind','templates') INTO p_result
      FROM public.plantillas t WHERE t.id=(p_params->>'id')::uuid AND t.usuario_id=(p_params->>'owner')::uuid;
    ELSIF k='activities' THEN
      SELECT (t.datos_json) || jsonb_build_object('id',t.id,'owner',t.usuario_id,'kind','activities') INTO p_result
      FROM public.actividades t WHERE t.id=(p_params->>'id')::uuid AND t.usuario_id=(p_params->>'owner')::uuid;
    ELSIF k='harvests' THEN
      SELECT (t.datos_json || jsonb_build_object('stages', CASE WHEN t.datos_json->>'process_mode'='custom' THEN coalesce(t.datos_json->'stage_history','[]'::jsonb) ELSE coalesce((SELECT jsonb_agg(jsonb_build_object('stage',s.etapa,'quantity',s.cantidad,'date',s.fecha_utc,'notes',s.notas) ORDER BY s.orden) FROM public.etapas_lote s WHERE s.cosecha_id=t.id AND s.usuario_id=t.usuario_id),'[]'::jsonb) END)) || jsonb_build_object('id',t.id,'owner',t.usuario_id,'kind','harvests') INTO p_result
      FROM public.cosechas t WHERE t.id=(p_params->>'id')::uuid AND t.usuario_id=(p_params->>'owner')::uuid;
    ELSE RAISE EXCEPTION 'Entidad no autorizada'; END IF;
    p_result := coalesce(p_result,'null'::jsonb);
  WHEN 'save' THEN
    PERFORM public.agro_save_record(p_params->>'kind',p_params->'record');
    p_result := jsonb_build_object('ok',true);
  WHEN 'remove' THEN
    k := p_params->>'kind';
    IF k='activities' THEN
      DELETE FROM public.actividades WHERE id=(p_params->>'id')::uuid AND usuario_id=(p_params->>'owner')::uuid;
    ELSIF k='templates' THEN
      DELETE FROM public.plantillas WHERE id=(p_params->>'id')::uuid AND usuario_id=(p_params->>'owner')::uuid;
    ELSE RAISE EXCEPTION 'Eliminación de entidad no permitida'; END IF;
    GET DIAGNOSTICS n=ROW_COUNT;
    p_result := jsonb_build_object('ok',n=1);
  WHEN 'stage' THEN
    INSERT INTO public.etapas_lote(cosecha_id,usuario_id,orden,etapa,cantidad,fecha_utc,notas)
    VALUES((p_params->>'harvest')::uuid,(p_params->>'owner')::uuid,
      (p_params->>'order')::integer,p_params->'stage'->>'stage',
      (p_params->'stage'->>'quantity')::numeric,
      (p_params->'stage'->>'date')::timestamptz,
      coalesce(p_params->'stage'->>'notes',''));
    p_result := jsonb_build_object('ok',true);
  WHEN 'event' THEN
    r := p_params->'event';
    INSERT INTO public.bitacora(id,usuario_id,registro_id,tipo,etiqueta,accion,fecha_utc,parcela_id)
    VALUES((r->>'id')::uuid,(r->>'owner')::uuid,(r->>'record_id')::uuid,
      r->>'kind',r->>'label',r->>'action',(r->>'date')::timestamptz,
      nullif(r->>'plot_id','')::uuid);
    p_result := jsonb_build_object('ok',true);
  WHEN 'user_email' THEN
    SELECT jsonb_build_object('id',id,'name',nombre,'email',correo,'salt',btrim(sal),'hash',btrim(clave_hash))
    INTO p_result FROM public.usuarios WHERE lower(correo)=lower(p_params->>'email') LIMIT 1;
    p_result := coalesce(p_result,'null'::jsonb);
  WHEN 'add_user' THEN
    r := p_params->'user';
    INSERT INTO public.usuarios(id,nombre,correo,sal,clave_hash)
    VALUES((r->>'id')::uuid,r->>'name',r->>'email',r->>'salt',r->>'hash')
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS n=ROW_COUNT;
    p_result := jsonb_build_object('ok',n=1);
  WHEN 'add_session' THEN
    r := p_params->'session';
    INSERT INTO public.sesiones(token_hash,usuario_id,expira_epoch)
    VALUES(p_params->>'token',(r->>'user_id')::uuid,(r->>'expires')::double precision)
    ON CONFLICT(token_hash) DO UPDATE SET expira_epoch=excluded.expira_epoch;
    IF (p_params->>'now')::double precision > 0 THEN
       DELETE FROM public.sesiones WHERE expira_epoch < (p_params->>'now')::double precision;
    END IF;
    p_result := jsonb_build_object('ok',true);
  WHEN 'session_user' THEN
    SELECT jsonb_build_object('id',u.id,'name',u.nombre,'email',u.correo,'salt',btrim(u.sal),'hash',btrim(u.clave_hash))
    INTO p_result FROM public.sesiones s JOIN public.usuarios u ON u.id=s.usuario_id
    WHERE s.token_hash=p_params->>'token' AND s.expira_epoch>(p_params->>'now')::double precision;
    p_result := coalesce(p_result,'null'::jsonb);
  WHEN 'delete_session' THEN
    DELETE FROM public.sesiones WHERE token_hash=p_params->>'token';
    p_result := jsonb_build_object('ok',true);
  WHEN 'events' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'record_id',registro_id,'plot_id',
      coalesce(parcela_id, CASE WHEN tipo='plots' THEN registro_id ELSE null END),
      'kind',tipo,'label',etiqueta,'action',accion,'date',fecha_utc) ORDER BY fecha_utc DESC,id DESC),'[]'::jsonb)
    INTO p_result FROM public.bitacora WHERE usuario_id=(p_params->>'owner')::uuid;
  WHEN 'summary' THEN
    u := (p_params->>'owner')::uuid;
    SELECT jsonb_build_object(
      'active_plots',(SELECT count(*) FROM public.parcelas WHERE usuario_id=u AND activa),
      'area',(SELECT coalesce(sum(area_ha),0) FROM public.parcelas WHERE usuario_id=u AND activa),
      'pending',(SELECT count(*) FROM public.actividades WHERE usuario_id=u AND estado IN ('Pendiente','En curso')),
      'harvest_kg',(SELECT coalesce(sum(cantidad_inicial),0) FROM public.cosechas WHERE usuario_id=u),
      'current_kg',(SELECT coalesce(sum(cantidad_actual),0) FROM public.cosechas WHERE usuario_id=u),
      'completed',(SELECT count(*) FROM public.actividades WHERE usuario_id=u AND estado='Completada')) INTO p_result;
  WHEN 'reviews' THEN
    SELECT coalesce(jsonb_agg(alerta_id),'[]'::jsonb) INTO p_result
    FROM public.alertas_revisadas WHERE usuario_id=(p_params->>'owner')::uuid AND revisada=true;
  WHEN 'review' THEN
    IF (p_params->>'reviewed')::boolean THEN
      INSERT INTO public.alertas_revisadas(usuario_id,alerta_id,revisada)
      VALUES((p_params->>'owner')::uuid,p_params->>'alert',true)
      ON CONFLICT(usuario_id,alerta_id) DO UPDATE SET revisada=true,actualizado_en=now();
    ELSE
      DELETE FROM public.alertas_revisadas WHERE usuario_id=(p_params->>'owner')::uuid AND alerta_id=p_params->>'alert';
    END IF;
    p_result := jsonb_build_object('ok',true);
  WHEN 'snapshot' THEN
    SELECT jsonb_build_object('version',1,
      'users',coalesce((SELECT jsonb_object_agg(id::text,jsonb_build_object('id',id,'name',nombre,
          'email',correo,'salt',btrim(sal),'hash',btrim(clave_hash))) FROM public.usuarios),'{}'::jsonb),
      'sessions',coalesce((SELECT jsonb_object_agg(btrim(token_hash),jsonb_build_object('user_id',usuario_id,'expires',expira_epoch))
          FROM public.sesiones),'{}'::jsonb),
      'records',coalesce((SELECT jsonb_object_agg(x->>'id',x)
          FROM (SELECT jsonb_array_elements(public.agro_records('crops')) x
          UNION ALL SELECT jsonb_array_elements(public.agro_records('plots'))
          UNION ALL SELECT jsonb_array_elements(public.agro_records('templates'))
          UNION ALL SELECT jsonb_array_elements(public.agro_records('activities'))
          UNION ALL SELECT jsonb_array_elements(public.agro_records('harvests'))) all_records),'{}'::jsonb),
      'events',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'owner',usuario_id,
          'record_id',registro_id,'plot_id',parcela_id,'kind',tipo,'label',etiqueta,'action',accion,'date',fecha_utc)
          ORDER BY fecha_utc,id) FROM public.bitacora),'[]'::jsonb),
      'alert_reviews',coalesce((SELECT jsonb_object_agg(usuario_id::text,reviews)
          FROM (SELECT usuario_id,jsonb_object_agg(alerta_id,true) reviews FROM public.alertas_revisadas
          WHERE revisada=true GROUP BY usuario_id) x),'{}'::jsonb)) INTO p_result;
  ELSE
    RAISE EXCEPTION 'Operación no permitida: %',p_action;
  END CASE;
END;
$proc$;

-- Solo la conexión del backend (rol postgres) puede ejecutar el contrato.
REVOKE ALL ON PROCEDURE public.agro_exec(text,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agro_records(text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agro_save_record(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON PROCEDURE public.agro_exec(text,jsonb,jsonb) TO postgres;
GRANT EXECUTE ON FUNCTION public.agro_records(text,uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.agro_save_record(text,jsonb) TO postgres;
COMMIT;

-- Corrección V19: permite crear parcelas sin seleccionar cultivo.
-- No elimina datos, no modifica tablas.
BEGIN;
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
COMMIT;

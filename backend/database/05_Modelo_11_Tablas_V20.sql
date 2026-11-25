-- AgroConecta V20: esquema relacional normalizado de 11 tablas.
-- Para un proyecto nuevo. Para datos V18/V19 existentes, use la migración
-- transaccional 06_Migracion_V19_V20.sql en una instancia aislada primero.
BEGIN;

CREATE TABLE IF NOT EXISTS public.usuarios (
    id_usuario uuid PRIMARY KEY,
    nombre varchar(80) NOT NULL,
    correo_electronico varchar(254) NOT NULL,
    sal_criptografica char(32) NOT NULL,
    contrasena_hash char(128) NOT NULL,
    fecha_registro timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_usuarios_nombre CHECK (char_length(btrim(nombre)) BETWEEN 2 AND 80),
    CONSTRAINT ck_usuarios_correo CHECK (char_length(btrim(correo_electronico)) BETWEEN 5 AND 254)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_correo_insensible
    ON public.usuarios (lower(correo_electronico));

CREATE TABLE IF NOT EXISTS public.sesiones (
    id_sesion uuid PRIMARY KEY,
    id_usuario uuid NOT NULL REFERENCES public.usuarios(id_usuario) ON DELETE CASCADE,
    hash_token_sesion char(64) NOT NULL UNIQUE,
    fecha_inicio timestamptz,
    fecha_expiracion timestamptz NOT NULL,
    CONSTRAINT ck_sesiones_fechas CHECK (fecha_inicio IS NULL OR fecha_expiracion > fecha_inicio)
);
CREATE INDEX IF NOT EXISTS ix_sesiones_usuario ON public.sesiones(id_usuario);
CREATE INDEX IF NOT EXISTS ix_sesiones_expiracion ON public.sesiones(fecha_expiracion);

CREATE TABLE IF NOT EXISTS public.cultivos (
    id_cultivo uuid PRIMARY KEY,
    id_usuario uuid NOT NULL REFERENCES public.usuarios(id_usuario),
    nombre varchar(100) NOT NULL,
    variedad varchar(100) NOT NULL DEFAULT '',
    duracion_ciclo_dias integer NOT NULL DEFAULT 0,
    observaciones text NOT NULL DEFAULT '',
    activo boolean NOT NULL DEFAULT true,
    origen_imagen varchar(20) NOT NULL DEFAULT '',
    url_imagen varchar(600) NOT NULL DEFAULT '',
    credito_imagen varchar(350) NOT NULL DEFAULT '',
    licencia_imagen varchar(30) NOT NULL DEFAULT '',
    id_taxon_imagen integer,
    ruta_fotografia text,
    version_fotografia uuid,
    fecha_creacion timestamptz NOT NULL DEFAULT now(),
    fecha_actualizacion timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_cultivos_usuario_id UNIQUE (id_usuario, id_cultivo),
    CONSTRAINT ck_cultivos_nombre CHECK (char_length(btrim(nombre)) BETWEEN 2 AND 100),
    CONSTRAINT ck_cultivos_ciclo CHECK (duracion_ciclo_dias BETWEEN 0 AND 3650),
    CONSTRAINT ck_cultivos_observaciones CHECK (char_length(observaciones) <= 2000),
    CONSTRAINT ck_cultivos_origen_imagen CHECK (origen_imagen IN ('', 'inaturalist', 'custom')),
    CONSTRAINT ck_cultivos_taxon CHECK (id_taxon_imagen IS NULL OR id_taxon_imagen > 0)
);
CREATE INDEX IF NOT EXISTS ix_cultivos_usuario_activo ON public.cultivos(id_usuario, activo);

CREATE TABLE IF NOT EXISTS public.parcelas (
    id_parcela uuid PRIMARY KEY,
    id_usuario uuid NOT NULL REFERENCES public.usuarios(id_usuario),
    id_cultivo uuid,
    nombre varchar(100) NOT NULL,
    ubicacion varchar(160) NOT NULL,
    superficie_hectareas numeric(15,4) NOT NULL,
    latitud numeric(9,6) NOT NULL,
    longitud numeric(9,6) NOT NULL,
    tipo_suelo varchar(200) NOT NULL DEFAULT '',
    observaciones text NOT NULL DEFAULT '',
    activa boolean NOT NULL DEFAULT true,
    ruta_fotografia text,
    version_fotografia uuid,
    fecha_creacion timestamptz NOT NULL DEFAULT now(),
    fecha_actualizacion timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_parcelas_usuario_id UNIQUE (id_usuario, id_parcela),
    CONSTRAINT fk_parcelas_cultivo_usuario FOREIGN KEY (id_usuario, id_cultivo)
        REFERENCES public.cultivos(id_usuario, id_cultivo) ON DELETE RESTRICT,
    CONSTRAINT ck_parcelas_nombre CHECK (char_length(btrim(nombre)) BETWEEN 2 AND 100),
    CONSTRAINT ck_parcelas_ubicacion CHECK (char_length(btrim(ubicacion)) BETWEEN 2 AND 160),
    CONSTRAINT ck_parcelas_superficie CHECK (superficie_hectareas > 0 AND superficie_hectareas <= 100000),
    CONSTRAINT ck_parcelas_latitud CHECK (latitud BETWEEN -90 AND 90),
    CONSTRAINT ck_parcelas_longitud CHECK (longitud BETWEEN -180 AND 180),
    CONSTRAINT ck_parcelas_observaciones CHECK (char_length(observaciones) <= 2000)
);
CREATE INDEX IF NOT EXISTS ix_parcelas_usuario_activa ON public.parcelas(id_usuario, activa);
CREATE INDEX IF NOT EXISTS ix_parcelas_usuario_cultivo ON public.parcelas(id_usuario, id_cultivo);

CREATE TABLE IF NOT EXISTS public.plantillas (
    id_plantilla uuid PRIMARY KEY,
    id_usuario uuid NOT NULL REFERENCES public.usuarios(id_usuario),
    nombre varchar(100) NOT NULL,
    tipo_plantilla varchar(20) NOT NULL,
    titulo_actividad varchar(160),
    categoria varchar(30),
    descripcion text NOT NULL DEFAULT '',
    fecha_creacion timestamptz NOT NULL DEFAULT now(),
    fecha_actualizacion timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_plantillas_tipo CHECK (tipo_plantilla IN ('actividad', 'proceso')),
    CONSTRAINT ck_plantillas_campos_tipo CHECK (
        (tipo_plantilla = 'actividad' AND titulo_actividad IS NOT NULL AND categoria IS NOT NULL)
        OR (tipo_plantilla = 'proceso' AND titulo_actividad IS NULL AND categoria IS NULL)
    ),
    CONSTRAINT ck_plantillas_categoria CHECK (categoria IS NULL OR categoria IN
        ('Inspección', 'Mantenimiento', 'Siembra', 'Cosecha', 'Poscosecha', 'Otra')),
    CONSTRAINT ck_plantillas_nombre CHECK (char_length(btrim(nombre)) BETWEEN 2 AND 100),
    CONSTRAINT ck_plantillas_titulo CHECK (titulo_actividad IS NULL OR char_length(btrim(titulo_actividad)) BETWEEN 2 AND 160),
    CONSTRAINT ck_plantillas_descripcion CHECK (char_length(descripcion) <= 2000)
);
CREATE INDEX IF NOT EXISTS ix_plantillas_usuario ON public.plantillas(id_usuario);

CREATE TABLE IF NOT EXISTS public.etapas_plantilla (
    id_etapa_plantilla uuid PRIMARY KEY,
    id_plantilla uuid NOT NULL REFERENCES public.plantillas(id_plantilla) ON DELETE CASCADE,
    numero_orden smallint NOT NULL,
    nombre_etapa varchar(64) NOT NULL,
    CONSTRAINT uq_etapas_plantilla_orden UNIQUE (id_plantilla, numero_orden),
    CONSTRAINT ck_etapas_plantilla_orden CHECK (numero_orden BETWEEN 1 AND 10),
    CONSTRAINT ck_etapas_plantilla_nombre CHECK (char_length(btrim(nombre_etapa)) BETWEEN 2 AND 64
      AND lower(btrim(nombre_etapa)) NOT IN ('cosechado','cerrado'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_etapas_plantilla_nombre_insensible
    ON public.etapas_plantilla(id_plantilla, lower(nombre_etapa));

CREATE TABLE IF NOT EXISTS public.actividades (
    id_actividad uuid PRIMARY KEY,
    id_parcela uuid NOT NULL REFERENCES public.parcelas(id_parcela) ON DELETE RESTRICT,
    titulo varchar(160) NOT NULL,
    fecha_programada date NOT NULL,
    categoria varchar(30) NOT NULL DEFAULT 'Otra',
    estado varchar(20) NOT NULL DEFAULT 'Pendiente',
    observaciones text NOT NULL DEFAULT '',
    fecha_creacion timestamptz NOT NULL DEFAULT now(),
    fecha_actualizacion timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_actividades_titulo CHECK (char_length(btrim(titulo)) BETWEEN 2 AND 160),
    CONSTRAINT ck_actividades_categoria CHECK (categoria IN
        ('Inspección', 'Mantenimiento', 'Siembra', 'Cosecha', 'Poscosecha', 'Otra')),
    CONSTRAINT ck_actividades_estado CHECK (estado IN ('Pendiente', 'En curso', 'Completada', 'Cancelada')),
    CONSTRAINT ck_actividades_observaciones CHECK (char_length(observaciones) <= 2000)
);
CREATE INDEX IF NOT EXISTS ix_actividades_parcela_fecha ON public.actividades(id_parcela, fecha_programada);
CREATE INDEX IF NOT EXISTS ix_actividades_estado_fecha ON public.actividades(estado, fecha_programada);

CREATE TABLE IF NOT EXISTS public.cosechas (
    id_cosecha uuid PRIMARY KEY,
    id_parcela uuid NOT NULL REFERENCES public.parcelas(id_parcela) ON DELETE RESTRICT,
    id_cultivo_origen uuid REFERENCES public.cultivos(id_cultivo) ON DELETE RESTRICT,
    codigo_lote varchar(30) NOT NULL UNIQUE,
    nombre_cultivo_historico varchar(100),
    variedad_historica varchar(100),
    fecha_cosecha date NOT NULL,
    cantidad_inicial_kg numeric(18,3) NOT NULL,
    tipo_proceso varchar(20) NOT NULL DEFAULT 'estandar',
    id_plantilla_origen uuid,
    nombre_plantilla_origen varchar(100),
    observaciones text NOT NULL DEFAULT '',
    fecha_creacion timestamptz NOT NULL DEFAULT now(),
    fecha_actualizacion timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_cosechas_cantidad CHECK (cantidad_inicial_kg > 0 AND cantidad_inicial_kg <= 100000000),
    CONSTRAINT ck_cosechas_tipo_proceso CHECK (tipo_proceso IN ('estandar', 'personalizado')),
    CONSTRAINT ck_cosechas_observaciones CHECK (char_length(observaciones) <= 2000)
);
CREATE INDEX IF NOT EXISTS ix_cosechas_parcela_fecha ON public.cosechas(id_parcela, fecha_cosecha);
CREATE INDEX IF NOT EXISTS ix_cosechas_codigo ON public.cosechas(codigo_lote);

CREATE TABLE IF NOT EXISTS public.etapas_cosecha (
    id_etapa_cosecha uuid PRIMARY KEY,
    id_cosecha uuid NOT NULL REFERENCES public.cosechas(id_cosecha) ON DELETE CASCADE,
    numero_orden smallint NOT NULL,
    nombre_etapa varchar(64) NOT NULL,
    cantidad_restante_kg numeric(18,3),
    fecha_finalizacion timestamptz,
    observaciones text NOT NULL DEFAULT '',
    CONSTRAINT uq_etapas_cosecha_orden UNIQUE (id_cosecha, numero_orden),
    CONSTRAINT ck_etapas_cosecha_orden CHECK (numero_orden BETWEEN 1 AND 12),
    CONSTRAINT ck_etapas_cosecha_nombre CHECK (char_length(btrim(nombre_etapa)) BETWEEN 2 AND 64),
    CONSTRAINT ck_etapas_cosecha_inicial CHECK (numero_orden<>1 OR nombre_etapa='Cosechado'),
    CONSTRAINT ck_etapas_cosecha_cantidad CHECK (cantidad_restante_kg IS NULL OR cantidad_restante_kg BETWEEN 0 AND 100000000),
    CONSTRAINT ck_etapas_cosecha_evento CHECK ((fecha_finalizacion IS NULL) = (cantidad_restante_kg IS NULL)),
    CONSTRAINT ck_etapas_cosecha_observaciones CHECK (char_length(observaciones) <= 2000)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_etapas_cosecha_nombre_insensible
    ON public.etapas_cosecha(id_cosecha, lower(nombre_etapa));
CREATE INDEX IF NOT EXISTS ix_etapas_cosecha_completadas
    ON public.etapas_cosecha(id_cosecha, numero_orden DESC) WHERE fecha_finalizacion IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.bitacora (
    id_bitacora uuid PRIMARY KEY,
    id_usuario uuid NOT NULL REFERENCES public.usuarios(id_usuario),
    id_registro_afectado uuid NOT NULL,
    id_parcela_referencia uuid,
    tipo_entidad varchar(25) NOT NULL,
    nombre_registro varchar(160) NOT NULL,
    accion_realizada varchar(100) NOT NULL,
    fecha_registro timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_bitacora_tipo CHECK (tipo_entidad IN ('plots', 'crops', 'activities', 'harvests', 'templates'))
);
CREATE INDEX IF NOT EXISTS ix_bitacora_usuario_fecha ON public.bitacora(id_usuario, fecha_registro DESC);
CREATE INDEX IF NOT EXISTS ix_bitacora_usuario_parcela ON public.bitacora(id_usuario, id_parcela_referencia, fecha_registro DESC);

CREATE TABLE IF NOT EXISTS public.alertas (
    id_alerta uuid PRIMARY KEY,
    id_usuario uuid NOT NULL REFERENCES public.usuarios(id_usuario) ON DELETE CASCADE,
    codigo_alerta varchar(180) NOT NULL,
    revisada boolean NOT NULL DEFAULT true,
    fecha_actualizacion timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_alertas_usuario_codigo UNIQUE (id_usuario, codigo_alerta),
    CONSTRAINT ck_alertas_codigo CHECK (char_length(codigo_alerta) BETWEEN 1 AND 180)
);
CREATE INDEX IF NOT EXISTS ix_alertas_usuario_revisada ON public.alertas(id_usuario, revisada);

ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sesiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cultivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parcelas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plantillas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.etapas_plantilla ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actividades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cosechas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.etapas_cosecha ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bitacora ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alertas ENABLE ROW LEVEL SECURITY;

DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.usuarios, public.sesiones, public.cultivos, public.parcelas, public.plantillas, public.etapas_plantilla, public.actividades, public.cosechas, public.etapas_cosecha, public.bitacora, public.alertas FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.usuarios, public.sesiones, public.cultivos, public.parcelas, public.plantillas, public.etapas_plantilla, public.actividades, public.cosechas, public.etapas_cosecha, public.bitacora, public.alertas FROM authenticated';
  END IF;
END
$roles$;

COMMIT;

/*
  AGROCONECTA | ESQUEMA INICIAL DE POSTGRESQL PARA SUPABASE
  Proyecto: AgroConecta (Angular 22 + FastAPI + psycopg)
  10 tablas, índices, claves foráneas, validaciones básicas y RLS.

  INSTRUCCIONES
  1. Crear un proyecto NUEVO en Supabase.
  2. Desactivar Data API si Angular accede exclusivamente por FastAPI.
  3. Pegar este archivo completo en SQL Editor > New query > Run.
  4. Verificar que se creen 10 tablas bajo public.

  SEGURIDAD
  - NO crea usuarios de aplicación ni contraseñas.
  - Habilita RLS sin políticas para los roles de API anon/authenticated.
  - El rol de conexión privilegiado usado desde FastAPI puede eludir RLS;
    por tanto, FastAPI DEBE validar la propiedad de los registros.
  - No incluye permisos de acceso para el cliente Angular.
  - No instala extensiones ni altera tablas internas de Supabase.
  - No borra datos: usa CREATE TABLE/INDEX IF NOT EXISTS.

  IMPORTANTE
  Este script crea el esquema. El backend incluye el repositorio psycopg,
  que se activa al configurar DATABASE_URL.
  V18: las fotografías nuevas se guardan en un bucket PRIVADO de Supabase
  Storage; parcelas.foto_ruta guarda la referencia privada, no los bytes.
  Cultivos conserva la ruta privada en datos_json hasta una migración separada.
*/
BEGIN;

-- 1) Usuarios administrados por FastAPI (NO equivalen a auth.users de Supabase).
CREATE TABLE IF NOT EXISTS public.usuarios (
    id                  uuid PRIMARY KEY,
    nombre              varchar(80) NOT NULL,
    correo              varchar(254) NOT NULL,
    sal                 char(32) NOT NULL,
    clave_hash          char(128) NOT NULL,
    creado_en           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_usuarios_nombre CHECK (char_length(btrim(nombre)) >= 2),
    CONSTRAINT ck_usuarios_correo CHECK (char_length(btrim(correo)) >= 5)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_correo_insensible
    ON public.usuarios (lower(correo));

-- 2) Sesiones de cookie; se almacena el HASH del token, nunca el token real.
CREATE TABLE IF NOT EXISTS public.sesiones (
    token_hash          char(64) PRIMARY KEY,
    usuario_id          uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    expira_epoch        double precision NOT NULL,
    CONSTRAINT ck_sesiones_expira CHECK (expira_epoch > 0)
);
CREATE INDEX IF NOT EXISTS ix_sesiones_usuario ON public.sesiones(usuario_id);
CREATE INDEX IF NOT EXISTS ix_sesiones_expira ON public.sesiones(expira_epoch);

-- 3) Cultivos registrados por cada agricultor.
CREATE TABLE IF NOT EXISTS public.cultivos (
    id                  uuid PRIMARY KEY,
    usuario_id          uuid NOT NULL REFERENCES public.usuarios(id),
    nombre              varchar(100) NOT NULL,
    variedad            varchar(100) NOT NULL DEFAULT '',
    ciclo_dias          integer NOT NULL DEFAULT 0,
    notas               text NOT NULL DEFAULT '',
    activo              boolean NOT NULL DEFAULT true,
    datos_json          jsonb NOT NULL DEFAULT '{}'::jsonb,
    creado_en           timestamptz NOT NULL DEFAULT now(),
    actualizado_en      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_cultivos_usuario_id UNIQUE (usuario_id, id),
    CONSTRAINT ck_cultivos_nombre CHECK (char_length(btrim(nombre)) BETWEEN 2 AND 100),
    CONSTRAINT ck_cultivos_ciclo CHECK (ciclo_dias BETWEEN 0 AND 3650),
    CONSTRAINT ck_cultivos_notas CHECK (char_length(notas) <= 2000)
);
CREATE INDEX IF NOT EXISTS ix_cultivos_usuario_activo ON public.cultivos(usuario_id, activo);

-- 4) Parcelas: fotografía privada referenciada por ruta de Storage.
CREATE TABLE IF NOT EXISTS public.parcelas (
    id                  uuid PRIMARY KEY,
    usuario_id          uuid NOT NULL REFERENCES public.usuarios(id),
    cultivo_id          uuid,
    nombre              varchar(100) NOT NULL,
    ubicacion           varchar(160) NOT NULL,
    area_ha             numeric(15,4) NOT NULL,
    latitud             numeric(9,6) NOT NULL,
    longitud            numeric(9,6) NOT NULL,
    suelo               varchar(200) NOT NULL DEFAULT '',
    notas               text NOT NULL DEFAULT '',
    activa              boolean NOT NULL DEFAULT true,
    foto_ruta           text,
    foto_version        uuid,
    datos_json          jsonb NOT NULL DEFAULT '{}'::jsonb,
    creado_en           timestamptz NOT NULL DEFAULT now(),
    actualizado_en      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_parcelas_usuario_id UNIQUE (usuario_id, id),
    CONSTRAINT fk_parcelas_cultivo_usuario FOREIGN KEY (usuario_id, cultivo_id)
        REFERENCES public.cultivos(usuario_id, id) ON DELETE RESTRICT,
    CONSTRAINT ck_parcelas_nombre CHECK (char_length(btrim(nombre)) BETWEEN 2 AND 100),
    CONSTRAINT ck_parcelas_ubicacion CHECK (char_length(btrim(ubicacion)) BETWEEN 2 AND 160),
    CONSTRAINT ck_parcelas_area CHECK (area_ha > 0 AND area_ha <= 100000),
    CONSTRAINT ck_parcelas_lat CHECK (latitud BETWEEN -90 AND 90),
    CONSTRAINT ck_parcelas_lon CHECK (longitud BETWEEN -180 AND 180),
    CONSTRAINT ck_parcelas_notas CHECK (char_length(notas) <= 2000)
);
-- Para actualizar bases antiguas, ejecutar primero 06_Limpieza_V18_Supabase.sql.
ALTER TABLE public.parcelas ADD COLUMN IF NOT EXISTS foto_ruta text;

CREATE INDEX IF NOT EXISTS ix_parcelas_usuario_activa ON public.parcelas(usuario_id, activa);
CREATE INDEX IF NOT EXISTS ix_parcelas_usuario_cultivo ON public.parcelas(usuario_id, cultivo_id);

-- 5) Plantillas reutilizables para crear labores agrícolas.
CREATE TABLE IF NOT EXISTS public.plantillas (
    id                  uuid PRIMARY KEY,
    usuario_id          uuid NOT NULL REFERENCES public.usuarios(id),
    nombre              varchar(100) NOT NULL,
    titulo              varchar(160) NOT NULL,
    categoria           varchar(30) NOT NULL DEFAULT 'Otra',
    notas               text NOT NULL DEFAULT '',
    datos_json          jsonb NOT NULL DEFAULT '{}'::jsonb,
    creado_en           timestamptz NOT NULL DEFAULT now(),
    actualizado_en      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_plantillas_nombre CHECK (char_length(btrim(nombre)) BETWEEN 2 AND 100),
    CONSTRAINT ck_plantillas_titulo CHECK (char_length(btrim(titulo)) BETWEEN 2 AND 160),
    CONSTRAINT ck_plantillas_categoria CHECK (categoria IN
        ('Inspección', 'Mantenimiento', 'Siembra', 'Cosecha', 'Poscosecha', 'Otra')),
    CONSTRAINT ck_plantillas_notas CHECK (char_length(notas) <= 2000)
);
CREATE INDEX IF NOT EXISTS ix_plantillas_usuario ON public.plantillas(usuario_id);

-- 6) Actividades planificadas en una parcela del mismo usuario.
CREATE TABLE IF NOT EXISTS public.actividades (
    id                  uuid PRIMARY KEY,
    usuario_id          uuid NOT NULL REFERENCES public.usuarios(id),
    parcela_id          uuid NOT NULL,
    titulo              varchar(160) NOT NULL,
    fecha               date NOT NULL,
    categoria           varchar(30) NOT NULL DEFAULT 'Otra',
    estado              varchar(20) NOT NULL DEFAULT 'Pendiente',
    notas               text NOT NULL DEFAULT '',
    datos_json          jsonb NOT NULL DEFAULT '{}'::jsonb,
    creado_en           timestamptz NOT NULL DEFAULT now(),
    actualizado_en      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_actividades_parcela_usuario FOREIGN KEY (usuario_id, parcela_id)
        REFERENCES public.parcelas(usuario_id, id) ON DELETE RESTRICT,
    CONSTRAINT ck_actividades_titulo CHECK (char_length(btrim(titulo)) BETWEEN 2 AND 160),
    CONSTRAINT ck_actividades_estado CHECK (estado IN
        ('Pendiente', 'En curso', 'Completada', 'Cancelada')),
    CONSTRAINT ck_actividades_categoria CHECK (categoria IN
        ('Inspección', 'Mantenimiento', 'Siembra', 'Cosecha', 'Poscosecha', 'Otra')),
    CONSTRAINT ck_actividades_notas CHECK (char_length(notas) <= 2000)
);
CREATE INDEX IF NOT EXISTS ix_actividades_usuario_fecha ON public.actividades(usuario_id, fecha);
CREATE INDEX IF NOT EXISTS ix_actividades_parcela ON public.actividades(usuario_id, parcela_id);

-- 7) Cosechas / lotes. Cantidad inicial y cantidad actual se expresan en kg.
CREATE TABLE IF NOT EXISTS public.cosechas (
    id                  uuid PRIMARY KEY,
    usuario_id          uuid NOT NULL REFERENCES public.usuarios(id),
    parcela_id          uuid NOT NULL,
    codigo              varchar(30) NOT NULL,
    fecha               date NOT NULL,
    cantidad_inicial    numeric(18,3) NOT NULL,
    cantidad_actual     numeric(18,3) NOT NULL,
    etapa               varchar(25) NOT NULL DEFAULT 'Cosechado',
    notas               text NOT NULL DEFAULT '',
    datos_json          jsonb NOT NULL DEFAULT '{}'::jsonb,
    creado_en           timestamptz NOT NULL DEFAULT now(),
    actualizado_en      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_cosechas_usuario_id UNIQUE (usuario_id, id),
    CONSTRAINT uq_cosechas_usuario_codigo UNIQUE (usuario_id, codigo),
    CONSTRAINT fk_cosechas_parcela_usuario FOREIGN KEY (usuario_id, parcela_id)
        REFERENCES public.parcelas(usuario_id, id) ON DELETE RESTRICT,
    CONSTRAINT ck_cosechas_cantidades CHECK
        (cantidad_inicial > 0 AND cantidad_inicial <= 100000000 AND
         cantidad_actual >= 0 AND cantidad_actual <= cantidad_inicial),
    CONSTRAINT ck_cosechas_etapa CHECK (etapa IN
        ('Cosechado', 'Procesamiento', 'Secado', 'Almacenado', 'Cerrado')),
    CONSTRAINT ck_cosechas_notas CHECK (char_length(notas) <= 2000)
);
CREATE INDEX IF NOT EXISTS ix_cosechas_usuario_fecha ON public.cosechas(usuario_id, fecha);
CREATE INDEX IF NOT EXISTS ix_cosechas_parcela ON public.cosechas(usuario_id, parcela_id);
CREATE INDEX IF NOT EXISTS ix_cosechas_usuario_etapa ON public.cosechas(usuario_id, etapa);

-- 8) Historial de etapas. El backend valida el orden y que no aumente el peso.
CREATE TABLE IF NOT EXISTS public.etapas_lote (
    cosecha_id          uuid NOT NULL,
    usuario_id          uuid NOT NULL,
    orden               smallint NOT NULL,
    etapa               varchar(25) NOT NULL,
    cantidad            numeric(18,3) NOT NULL,
    fecha_utc           timestamptz NOT NULL DEFAULT now(),
    notas               text NOT NULL DEFAULT '',
    CONSTRAINT pk_etapas_lote PRIMARY KEY (cosecha_id, orden),
    CONSTRAINT fk_etapas_cosecha_usuario FOREIGN KEY (usuario_id, cosecha_id)
        REFERENCES public.cosechas(usuario_id, id) ON DELETE RESTRICT,
    CONSTRAINT ck_etapas_orden CHECK (orden BETWEEN 1 AND 5),
    CONSTRAINT ck_etapas_etapa CHECK (etapa IN
        ('Cosechado', 'Procesamiento', 'Secado', 'Almacenado', 'Cerrado')),
    CONSTRAINT ck_etapas_cantidad CHECK (cantidad BETWEEN 0 AND 100000000),
    CONSTRAINT ck_etapas_notas CHECK (char_length(notas) <= 2000)
);
CREATE INDEX IF NOT EXISTS ix_etapas_lote_usuario ON public.etapas_lote(usuario_id, cosecha_id);

-- 9) Bitácora. registro_id se refiere a distintos tipos de entidad;
--    por eso NO se define FK polimórfica sobre ese campo.
CREATE TABLE IF NOT EXISTS public.bitacora (
    id                  uuid PRIMARY KEY,
    usuario_id          uuid NOT NULL REFERENCES public.usuarios(id),
    registro_id         uuid NOT NULL,
    tipo                varchar(25) NOT NULL,
    etiqueta            varchar(160) NOT NULL,
    accion              varchar(100) NOT NULL,
    parcela_id          uuid,
    fecha_utc           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_bitacora_usuario_fecha ON public.bitacora(usuario_id, fecha_utc DESC);
-- Compatibilidad con las instalaciones anteriores.
ALTER TABLE public.bitacora ADD COLUMN IF NOT EXISTS parcela_id uuid;
CREATE INDEX IF NOT EXISTS ix_bitacora_usuario_parcela ON public.bitacora(usuario_id, parcela_id, fecha_utc DESC);

-- 10) Los avisos meteorológicos son calculados en FastAPI;
--     aquí solo se almacena si el usuario marcó uno como revisado.
CREATE TABLE IF NOT EXISTS public.alertas_revisadas (
    usuario_id          uuid NOT NULL REFERENCES public.usuarios(id),
    alerta_id           varchar(150) NOT NULL,
    revisada            boolean NOT NULL DEFAULT true,
    actualizado_en      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_alertas_revisadas PRIMARY KEY (usuario_id, alerta_id)
);

-- Defensa en profundidad: no permitir consultas por los roles de la Data API.
-- El acceso de FastAPI por la conexión PostgreSQL privilegiada sigue requiriendo
-- controles de usuario/propiedad EN EL BACKEND (RLS no los reemplaza).
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sesiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cultivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parcelas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plantillas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actividades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cosechas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.etapas_lote ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bitacora ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alertas_revisadas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.usuarios, public.sesiones, public.cultivos, public.parcelas,
    public.plantillas, public.actividades, public.cosechas, public.etapas_lote,
    public.bitacora, public.alertas_revisadas
FROM anon, authenticated;

COMMIT;

-- VERIFICACIÓN: debe mostrar 10 tablas.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name IN (
      'usuarios','sesiones','cultivos','parcelas','plantillas',
      'actividades','cosechas','etapas_lote','bitacora','alertas_revisadas'
  )
ORDER BY table_name;

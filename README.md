# AgroConecta

Aplicación web de gestión agrícola para administrar parcelas, cultivos, actividades, cosechas, lotes y reportes.

## Arquitectura

- Frontend: Angular, TypeScript y SCSS.
- Backend: FastAPI (Python), organizado en API, servicios y repositorios.
- Base de datos: PostgreSQL con rutinas almacenadas V20 y 11 tablas relacionales.
- Imágenes privadas: Supabase Storage.
- Integraciones externas: iNaturalist y datos meteorológicos.

## Funcionalidades

Registro e inicio de sesión, parcelas, cultivos, calendario y plantillas, clima, alertas, cosechas, seguimiento de lotes, historial, gráficos, Excel y PDF.

## Configuración local

1. Crear `backend/.env` a partir de `backend/.env.example`, con datos privados propios.
2. Para una base vacía, aplicar `backend/database/05_Modelo_11_Tablas_V20.sql` y luego `backend/database/04_Rutinas_Almacenadas.sql`.
3. En `backend/`, ejecutar `uv sync` y `uv run uvicorn main:app --port 8010`.
4. En `frontend/`, ejecutar `npm ci` y `npm start`.
5. Abrir `http://localhost:4200`.

## Pruebas

Backend: `cd backend && uv run python -m pytest -q`.
Frontend: `cd frontend && npm run build && npm test -- --watch=false`.
El workflow `.github/workflows/ci.yml` permite ejecutar estas comprobaciones en GitHub Actions.

## Despliegue del backend en Render (Docker)

El backend incluye `backend/Dockerfile` y `backend/.dockerignore`. En Render:

1. Crear un **Web Service** con **Language: Docker** y conectar este repositorio.
2. Branch `main`, **Root Directory** `backend`, Dockerfile Path `./Dockerfile`.
3. **Health Check Path**: `/health`.
4. Configurar las variables de entorno en el dashboard (no en el repositorio):

   | Variable | Valor |
   | --- | --- |
   | `DATABASE_URL` | Connection string del Session pooler de Supabase |
   | `SUPABASE_URL` | `https://<proyecto>.supabase.co` |
   | `SUPABASE_SECRET_KEY` | Clave secreta `sb_secret_*` (o `SUPABASE_SERVICE_ROLE_KEY`) |
   | `SUPABASE_STORAGE_BUCKET` | `agroconecta-private` |
   | `CORS_ORIGINS` | URL exacta del frontend, separada por comas (sin barra final) |
   | `AGRO_SECURE_COOKIES` | `true` (Render sirve por HTTPS) |

   No definir `PORT` ni `HOST`: Render inyecta `PORT` y el contenedor escucha en `0.0.0.0`.

5. El backend exige el contrato SQL V20; si no está aplicado, el arranque falla explícitamente.
6. Verificar: `curl https://<servicio>.onrender.com/health` debe responder `{"status":"ok"}`.

Notas del plan Free: el servicio se suspende tras 15 minutos sin tráfico y la primera petición tarda 30–60 s (cold start). El disco es efímero, por lo que las imágenes se guardan siempre en Supabase Storage.

## Seguridad

No publicar `backend/.env`, contraseñas, claves de Supabase o archivos BAT personales.
El almacenamiento de imágenes privadas se gestiona desde el backend.

## Modelo V20 y migración local

El esquema activo tiene 11 tablas. `backend/database/AgroConecta_Supabase_PostgreSQL.sql`, `EJECUTAR_EN_SUPABASE.sql` y `SOLUCION_ERROR_CREAR_PARCELA.sql` son nombres históricos y ahora se detienen con un error para evitar aplicar V18/V19 por accidente.

Para ensayar una actualización de una copia V18/V19, restaura primero un respaldo en PostgreSQL local aislado. Define `AGRO_MIGRATION_DATABASE_URL` apuntando a `localhost`, `127.0.0.1` o `::1` y ejecuta `python backend/database/migrate_v19_to_v20.py --apply`. El runner no lee `DATABASE_URL`, `.env`, credenciales de Supabase ni Storage; rechaza hosts remotos, conserva el esquema anterior en `agroconecta_legacy` y revierte toda la transacción si falla una comprobación. Se detiene si encuentra propiedades JSON sin mapear, fotos Base64 heredadas o procesos incompletos. No se ha ejecutado sobre Supabase.

No uses el runner con una base de producción. La migración futura a Supabase requiere aprobación explícita, respaldo, ensayo aislado, revisión de las fotos Base64 que bloqueen el proceso y una ventana de corte coordinada.

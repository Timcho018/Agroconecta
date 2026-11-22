# AgroConecta

Aplicación web de gestión agrícola para administrar parcelas, cultivos, actividades, cosechas, lotes y reportes.

## Arquitectura

- Frontend: Angular, TypeScript y SCSS.
- Backend: FastAPI (Python), organizado en API, servicios y repositorios.
- Base de datos: PostgreSQL alojado en Supabase, con rutinas almacenadas.
- Imágenes privadas: Supabase Storage.
- Integraciones externas: iNaturalist y datos meteorológicos.

## Funcionalidades

Registro e inicio de sesión, parcelas, cultivos, calendario y plantillas, clima, alertas, cosechas, seguimiento de lotes, historial, gráficos, Excel y PDF.

## Configuración local

1. Crear `backend/.env` a partir de `backend/.env.example`, con datos privados propios.
2. En Supabase ejecutar `backend/database/EJECUTAR_EN_SUPABASE.sql` solo después de leerlo y respaldar los datos.
3. En `backend/`, ejecutar `uv sync` y `uv run uvicorn main:app --port 8010`.
4. En `frontend/`, ejecutar `npm ci` y `npm start`.
5. Abrir `http://localhost:4200`.

## Pruebas

Backend: `cd backend && uv run python -m pytest -q`.
Frontend: `cd frontend && npm run build && npm test -- --watch=false`.
El workflow `.github/workflows/ci.yml` permite ejecutar estas comprobaciones en GitHub Actions.

## Seguridad

No publicar `backend/.env`, contraseñas, claves de Supabase o archivos BAT personales.
El almacenamiento de imágenes privadas se gestiona desde el backend.

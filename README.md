# El Pampa — Next.js + Supabase

## Qué quedó montado

- App migrada a **Next.js** con **TypeScript**.
- Frontend, login, panel y páginas de estado viven en `src/app`.
- La API quedó en route handlers de Next, así que Vercel puede ejecutarla sin un servidor Express aparte.
- La base de datos sigue siendo **Supabase Postgres** vía Prisma.
- El panel de admin permite crear, editar y eliminar productos, y confirmar o cancelar pedidos.
- Los productos ahora se venden por `kg`, `g` o `unidad`, sin stock manual.

## Desarrollo local

```bash
npm install
npm run dev
```

Abrí `http://localhost:3000` para la tienda y `http://localhost:3000/login` para el panel.

## Variables de entorno

```bash
cp .env.example .env
```

Completá:
- `DATABASE_URL`: la cadena del **pooler transaction mode** de Supabase.
- `DIRECT_URL`: la cadena del **pooler session mode** para migraciones y Prisma.
- `ADMIN_USERNAME` / `ADMIN_PASSWORD`: usuario y contraseña para vos.
- `JWT_SECRET`: texto largo y random (por ejemplo con `openssl rand -hex 32`).
- `STORE_NAME`: el nombre que aparece en los mensajes de WhatsApp.
- `STORE_ADDRESS`: dirección o zona local que se muestra en la web.
- `STORE_NEIGHBORHOOD`: barrio principal para SEO local y datos estructurados.
- `SITE_URL`: URL canónica del sitio para metadata y Open Graph.
- `TRANSFER_ALIAS` / `TRANSFER_CBU`: los datos que se le muestran al cliente para transferir.
- `WHATSAPP_NUMBER`: tu número con código de país, sin espacios ni signos (ej: `5493511234567`).
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`: para subir imágenes comprimidas a Supabase Storage desde el panel.

## Prisma

```bash
npx prisma migrate dev --name init
node prisma/seed.js   # opcional: carga 3 productos de ejemplo
```

En producción, antes del primer deploy, corré `npx prisma migrate deploy` contra la base de Supabase.

Si usás Supabase, dejá estas dos variables separadas:

- `DATABASE_URL` para runtime en Vercel y Next.js.
- `DIRECT_URL` para Prisma Migrate y operaciones de esquema.

## Deploy en Vercel

Configuración exacta:

- Framework Preset: `Next.js`
- Build Command: `npm run build`
- Install Command: `npm install`
- Output Directory: dejar el valor por defecto de Next/Vercel
- Root Directory: la raíz del repo

Variables de entorno en Vercel:

- `DATABASE_URL`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `JWT_SECRET`
- `STORE_NAME`
- `STORE_ADDRESS`
- `STORE_NEIGHBORHOOD`
- `SITE_URL`
- `TRANSFER_ALIAS`
- `TRANSFER_CBU`
- `WHATSAPP_NUMBER`

## Ver la página subida

1. Subí estos cambios a GitHub.
2. En Vercel, elegí **Add New Project** e importá ese repositorio.
3. Confirmá estas opciones:
	- Framework Preset: `Next.js`
	- Build Command: `npm run build`
	- Install Command: `npm install`
	- Root Directory: la raíz del repo
4. Cargá las variables de entorno del bloque anterior en Vercel.
5. Tocá **Deploy**.
6. Cuando termine, abrí la URL que te da Vercel. Esa ya es la página publicada.

Si después cambiás algo, solo volvés a hacer `git push` y Vercel redeploya solo.

## Rutas principales

- `/` tienda
- `/login` ingreso al panel
- `/panel` administración
- `/success`, `/failure`, `/pending` páginas de estado

## Notas

- El panel sigue usando token en `localStorage` y JWT firmado por el backend.
- El checkout sigue siendo por transferencia manual; Mercado Pago queda para una etapa posterior.
- Las imágenes de productos se comprimen en el navegador a WebP y se suben a Supabase Storage para ahorrar espacio.

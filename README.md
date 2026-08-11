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
- `/trastienda` ingreso al panel
- `/trastienda/gestion` administración
- `/success`, `/failure`, `/pending` páginas de estado

Las rutas privadas se llamaban `/login` y `/panel`. Se renombraron para que los bots
que barren `/admin`, `/login` y `/wp-admin` no las encuentren. **No es una medida de
seguridad real** (cualquiera que mire el JavaScript las ve): lo que protege el panel
sigue siendo el JWT, el rate limiting y la contraseña. Por eso tampoco se listan en
`robots.txt`, que es público: se sacan del índice con `noindex` en cada página.

Están centralizadas en `src/lib/routes.ts`; si se vuelven a cambiar, se toca solo ahí.

## Disponibilidad de productos

Cada producto tiene un campo `available`. Desde el panel se cambia con un botón, sin
entrar a editar. Un producto marcado sin stock:

- aparece **al final** de la tienda, no arriba;
- se muestra en gris con el cartel "Sin stock" y el botón deshabilitado;
- no se puede agregar al carrito, y si alguien fuerza el request el checkout lo
  rechaza con 409;
- no se ofrece como producto relacionado;
- figura como `OutOfStock` en los datos estructurados y en `/llms.txt`.

## Mercado Pago (opcional)

La tienda funciona sin Mercado Pago: si `MP_ACCESS_TOKEN` está vacío, el botón de
tarjeta no aparece y solo se ofrece transferencia.

Para activarlo:

1. Entrá a https://www.mercadopago.com.ar/developers/panel/app y creá una aplicación.
2. Copiá el **Access Token** de producción a `MP_ACCESS_TOKEN` (en Vercel también).
3. En el panel de MP, andá a **Webhooks > Configurar notificaciones** y cargá la URL
   `https://elpampa.vercel.app/api/webhooks/mercadopago`, marcando el evento **Pagos**.
4. Copiá la **clave secreta** que te da esa pantalla a `MP_WEBHOOK_SECRET`.

El webhook valida la firma HMAC de cada notificación y consulta el pago contra la API
de MP antes de tocar el pedido, así que nadie puede marcar pedidos como pagados
mandando un POST a esa URL.

## Base de datos: Row Level Security

Supabase publica automáticamente todas las tablas del schema `public` por su API
REST, usando los roles `anon` y `authenticated`. La *anon key* está pensada para ser
pública, así que hay que asumir que cualquiera la puede conseguir.

La migración `20260811050000_enable_row_level_security` deja RLS activo en todas las
tablas, sin políticas (denegar por defecto), y revoca los permisos de esos dos roles.
También cambia los privilegios por defecto para que **ninguna tabla nueva nazca
accesible**.

La app no se ve afectada porque se conecta con Prisma como el rol `postgres`, que es
dueño de las tablas y no está sujeto a RLS.

Si algún día se agrega una tabla, verificá que quede con RLS:

```bash
npx prisma migrate deploy
```

## Logs de seguridad

Los eventos sospechosos se escriben como JSON de una línea con la clave `secEvent`.
En Vercel: **Project > Logs**, y filtrás por `secEvent`. Se registran logins fallidos
(con el usuario probado, nunca la contraseña), rate limits alcanzados, tokens
inválidos, orígenes bloqueados y firmas de webhook inválidas.

## Protección contra ataques

El login y el checkout tienen un limitador de intentos por IP, pero es **en memoria**:
en Vercel cada instancia serverless tiene la suya, así que no es un límite global exacto.
Para protección real conviene activar el **Firewall de Vercel** (Project Settings >
Firewall): ahí se configuran reglas de rate limiting a nivel edge y el *Attack Challenge
Mode*, sin tocar código.

## Notas

- El panel sigue usando token en `localStorage` y JWT firmado por el backend.
- El checkout sigue siendo por transferencia manual; Mercado Pago queda para una etapa posterior.
- Las imágenes de productos se comprimen en el navegador a WebP y se suben a Supabase Storage para ahorrar espacio.

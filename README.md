# Verdulería Fresca — Guía de puesta en marcha

## Qué cambió en esta versión

- **Diseño nuevo**: identidad de verdulería de barrio (carteles de tiza, cajones de madera, papel craft) en vez de la plantilla genérica anterior.
- **Stock por producto**: se descuenta recién cuando vos (el admin) confirmás que llegó el pago.
- **Checkout por transferencia**: el cliente arma el carrito, el sitio le muestra tu alias/CBU y un botón para mandarte el comprobante por WhatsApp con el número de pedido. **Todavía no está integrado Mercado Pago** — queda para más adelante, ver el apéndice al final.
- **Login de administrador**: usuario/contraseña únicos, definidos por vos en `.env`, protegen el panel.
- **Panel de pedidos**: en `panel.html` ahora hay una sección "Pedidos" donde ves cada pedido pendiente y tenés botones "Confirmar pago" (descuenta el stock) o "Cancelar".

## 1. Instalar dependencias

```bash
npm install
```

## 2. Variables de entorno

```bash
cp .env.example .env
```

Completá:
- `DATABASE_URL`: tu Postgres (la que ya tenías).
- `ADMIN_USERNAME` / `ADMIN_PASSWORD`: usuario y contraseña para vos.
- `JWT_SECRET`: texto largo y random (por ejemplo con `openssl rand -hex 32`).
- `STORE_NAME`: el nombre que aparece en los mensajes de WhatsApp.
- `TRANSFER_ALIAS` / `TRANSFER_CBU`: los datos que se le muestran al cliente para transferir.
- `WHATSAPP_NUMBER`: tu número con código de país, sin espacios ni signos (ej: `5493511234567`).

## 3. Base de datos

```bash
npx prisma migrate dev --name init
node prisma/seed.js   # opcional: carga 3 productos de ejemplo
```

## 4. Correr en local

```bash
npm start
```

Abrí `index.html` con algún servidor estático (por ejemplo la extensión "Live Server"). El panel de admin está en `login.html`.

## 5. Cómo funciona el flujo de compra ahora

1. El cliente agrega productos (no puede superar el stock disponible).
2. Al tocar "Pedir por transferencia", el backend valida el stock real, crea el pedido (estado `pending`) y le muestra al cliente tu alias/CBU más un botón para mandarte el comprobante por WhatsApp.
3. El stock **todavía no se descuenta** en este punto — el pedido queda "reservado" solo de nombre.
4. Vos entrás al panel, ves el pedido en la sección "Pedidos", y cuando confirmás por WhatsApp que llegó la plata, tocás **"Confirmar pago"**. Ahí sí se descuenta el stock y el pedido pasa a "Confirmado".
5. Si el cliente se arrepiente o nunca transfiere, tocás **"Cancelar"** y no pasa nada con el stock.

## 6. Desplegar (Render, como ya lo tenías)

- El backend va como Web Service, igual que ahora. Cargá las mismas variables del `.env` en la sección "Environment" de Render.
- El frontend lo seguís sirviendo como sitio estático.

## 7. Cosas para personalizar antes de publicar

- **Dirección del mapa**: en `index.html`, en el `<iframe>` de Google Maps, reemplazá `Obelisco%2C%20Buenos%20Aires` (después de `q=`) por tu dirección real, con espacios como `%20`.
- **WhatsApp y email de contacto**: en `index.html`, sección "Contacto".
- **Colores/tipografía**: todo está centralizado en las variables `:root` al principio de `style.css`, así que se puede ajustar la paleta sin tocar el resto del archivo.

---

## Apéndice: cómo integrar Mercado Pago más adelante

Cuando quieras sumar el cobro automático con Mercado Pago (además o en vez de la transferencia manual), avisame y lo reconectamos. En resumen, los pasos van a ser:

1. Crear cuenta en https://www.mercadopago.com.ar/developers/panel y sacar el Access Token (de prueba primero, después el de producción).
2. Reinstalar la librería: `npm install mercadopago`.
3. El backend genera un "link de pago" (Checkout Pro) por cada pedido y Mercado Pago le avisa al servidor cuando se acredita, para descontar el stock automáticamente (en vez de que vos lo confirmes a mano).

Sobre las comisiones (a julio 2026, revisar siempre en mercadopago.com.ar porque cambian): un link de pago ronda 6,29% + IVA con acreditación inmediata para tarjeta de crédito, y baja si elegís que el dinero se acredite a los 14 o 30 días. El QR presencial es bastante más barato (cerca de 0,99%). Las transferencias directas no tienen comisión, que es justamente lo que estás usando ahora.

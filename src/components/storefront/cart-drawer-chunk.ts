/**
 * Todo lo que solo hace falta con el carrito abierto, en un chunk aparte del JS
 * inicial de la página: el panel (carrito, formulario, confirmación, resumen) y
 * lo que usa la tienda al confirmar (el POST del checkout y el mensaje de
 * WhatsApp). Lo carga storefront-page.tsx con next/dynamic y lo precarga con el
 * primer producto agregado o al acercarse al botón del carrito.
 *
 * Como el formulario de checkout vive acá, para cuando el cliente toca
 * «Confirmar pedido» este módulo ya está cargado: importarlo en el submit no
 * agrega ningún viaje de red.
 */
export { default } from './cart-drawer';
export { createIdempotencyKey, postCheckout } from './checkout-api';
export { buildOrderWhatsappUrl } from './order-message';

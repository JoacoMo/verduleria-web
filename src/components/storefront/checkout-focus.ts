import { CHECKOUT_FIELD_IDS, type CheckoutField } from './use-checkout-form';

/**
 * Lleva el foco (y el scroll) al campo con error.
 *
 * Va aparte del formulario (sin JSX) porque lo usa la tienda al confirmar: si
 * viniera de checkout-form.tsx, el formulario entero quedaría en el JS inicial
 * en vez de cargarse con el carrito.
 */
export function focusCheckoutField(field: CheckoutField) {
  const element = field === 'deliverySlot'
    ? document.querySelector<HTMLElement>(`#${CHECKOUT_FIELD_IDS.deliverySlot} input`)
    : document.getElementById(CHECKOUT_FIELD_IDS[field]);
  if (!element) return;
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

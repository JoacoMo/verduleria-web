'use client';

import { useEffect, useRef } from 'react';
import { RotateCw, ShoppingCart, X } from 'lucide-react';
import type { CartDrawerProps } from './cart-drawer';

/**
 * Lo que se ve si el JS del carrito no se pudo bajar (se cortó la señal, o se
 * publicó una versión nueva de la tienda y el archivo de la anterior ya no
 * existe). Sin esto, el error de carga rompía la página entera.
 *
 * El carrito está guardado en el navegador, así que recargar no pierde nada: la
 * página nueva trae los archivos que corresponden.
 */
export default function CartDrawerUnavailable({ isOpen, onClose }: Pick<CartDrawerProps, 'isOpen' | 'onClose'>) {
  const reloadRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    reloadRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="cart-drawer-overlay open" onClick={onClose}>
      <div
        className="cart-drawer"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cart-unavailable-title"
        aria-describedby="cart-unavailable-text"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="cart-drawer-header">
          <h2 id="cart-unavailable-title">
            <ShoppingCart size={26} aria-hidden="true" /> Tu carrito
          </h2>
          <button type="button" className="cart-drawer-close" onClick={onClose} aria-label="Cerrar">
            <X size={26} aria-hidden="true" />
          </button>
        </div>
        <div className="cart-drawer-body">
          <div className="checkout-notice checkout-notice-warning">
            <p className="checkout-notice-title">No pudimos abrir el carrito</p>
            <p id="cart-unavailable-text">
              Puede ser la señal, o que justo actualizamos la tienda. Tu carrito quedó guardado: recargá la página y
              seguís donde estabas.
            </p>
          </div>
          <button ref={reloadRef} type="button" className="checkout-btn" onClick={() => window.location.reload()}>
            <RotateCw size={18} aria-hidden="true" /> Recargar la página
          </button>
        </div>
      </div>
    </div>
  );
}

'use client';

import { ChevronUp, ShoppingCart } from 'lucide-react';
import { formatArs } from '@/lib/format-price';
import { pluralize } from './format';

type CartFabProps = {
  count: number;
  subtotal: number;
  onOpen: () => void;
  /** Al acercarse al botón (mouse, toque o foco): precarga el carrito. */
  onIntent?: () => void;
};

/**
 * Botón flotante del carrito: siempre a mano del pulgar en el celular y con el
 * total a la vista, para no tener que abrir el carrito para saber cuánto va.
 */
export default function CartFab({ count, subtotal, onOpen, onIntent }: CartFabProps) {
  const countText = `${count} ${pluralize(count, 'producto', 'productos')}`;

  return (
    <button
      type="button"
      className={`cart-fab ${count > 0 ? 'has-items' : ''}`}
      onClick={onOpen}
      onPointerEnter={onIntent}
      onPointerDown={onIntent}
      onFocus={onIntent}
      aria-label={count > 0 ? `Ver carrito: ${countText}, ${formatArs(subtotal)}` : 'Abrir carrito'}
    >
      <ShoppingCart size={24} aria-hidden="true" />
      {count > 0 ? (
        <>
          <span className="cart-fab-summary" aria-hidden="true">
            <span className="cart-fab-count-text">{countText}</span>
            <span className="cart-fab-total">{formatArs(subtotal)}</span>
          </span>
          <ChevronUp size={18} className="cart-fab-chevron" aria-hidden="true" />
        </>
      ) : null}
    </button>
  );
}

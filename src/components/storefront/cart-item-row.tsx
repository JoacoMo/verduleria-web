'use client';

import { memo, useEffect, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { formatArs } from '@/lib/format-price';
import { PRODUCT_MAX_CART_QUANTITY, PRODUCT_UNIT_LABELS, isWeightUnit, type ProductUnit } from '@/lib/product-units';
import { PLACEHOLDER_IMAGE, handleImageError } from './format';
import {
  displayStep,
  formatQuantityInput,
  fromDisplayQuantity,
  parseQuantityInput,
  toDisplayQuantity,
} from './quantity';
import type { CartItem } from './types';

type CartItemRowProps = {
  item: CartItem;
  /** Unidad en la que el cliente eligió ver la cantidad (kg o g, solo para lo que va por peso). */
  displayUnit: ProductUnit;
  onDisplayUnitChange: (productId: number, unit: ProductUnit) => void;
  onSetQuantity: (item: Pick<CartItem, 'id' | 'unit'>, quantity: number) => void;
  onRemove: (productId: number) => void;
};

function CartItemRowComponent({ item, displayUnit, onDisplayUnitChange, onSetQuantity, onRemove }: CartItemRowProps) {
  const displayQuantity = toDisplayQuantity(item.quantity, item.unit, displayUnit);
  const step = displayStep(displayUnit);
  const maxDisplay = toDisplayQuantity(PRODUCT_MAX_CART_QUANTITY[item.unit], item.unit, displayUnit);
  const inputId = `cart-qty-${item.id}`;

  function commit(nextDisplay: number) {
    if (!Number.isFinite(nextDisplay) || nextDisplay <= 0) return;
    onSetQuantity(item, fromDisplayQuantity(nextDisplay, item.unit, displayUnit));
  }

  return (
    <li className={`cart-drawer-item ${item.available ? '' : 'is-unavailable'}`}>
      <button
        type="button"
        className="remove-from-cart-btn"
        onClick={() => onRemove(item.id)}
        aria-label={`Sacar ${item.name} del carrito`}
      >
        <X size={18} aria-hidden="true" />
      </button>
      <div className="cart-item-info">
        <img
          src={item.image || PLACEHOLDER_IMAGE}
          alt=""
          width={56}
          height={56}
          loading="lazy"
          decoding="async"
          onError={handleImageError}
        />
        <div>
          <strong>{item.name}</strong>
          <p className="cart-item-price">
            {item.onOffer ? (
              <>
                <span className="visually-hidden">Precio normal:</span>
                <s className="regular-price">{formatArs(item.regularPrice)}</s>{' '}
              </>
            ) : null}
            <span className={item.onOffer ? 'offer-price' : ''}>{formatArs(item.unitPrice)}</span> / {PRODUCT_UNIT_LABELS[item.unit]}
            {' — '}
            <strong>{formatArs(item.lineTotal)}</strong>
          </p>
          {item.available ? null : (
            <p className="cart-item-unavailable">Se quedó sin stock: sacalo para seguir.</p>
          )}
        </div>
      </div>

      {item.available ? (
        <div className="cart-item-controls">
          {isWeightUnit(item.unit) ? (
            <div className="unit-toggle" role="group" aria-label={`Ver cantidad de ${item.name} en`}>
              <button
                type="button"
                className={displayUnit === 'kg' ? 'active' : ''}
                aria-pressed={displayUnit === 'kg'}
                onClick={() => onDisplayUnitChange(item.id, 'kg')}
              >
                kg
              </button>
              <button
                type="button"
                className={displayUnit === 'g' ? 'active' : ''}
                aria-pressed={displayUnit === 'g'}
                onClick={() => onDisplayUnitChange(item.id, 'g')}
              >
                g
              </button>
            </div>
          ) : null}
          <div className="qty-controls">
            <button
              type="button"
              onClick={() => commit(displayQuantity - step)}
              disabled={displayQuantity - step <= 0}
              aria-label={`Restar ${item.name}`}
            >
              <Minus size={18} aria-hidden="true" />
            </button>
            <label className="visually-hidden" htmlFor={inputId}>
              Cantidad de {item.name} en {PRODUCT_UNIT_LABELS[displayUnit]}
            </label>
            <QuantityInput id={inputId} value={displayQuantity} displayUnit={displayUnit} onCommit={commit} />
            <span className="qty-unit" aria-hidden="true">{PRODUCT_UNIT_LABELS[displayUnit]}</span>
            <button
              type="button"
              onClick={() => commit(displayQuantity + step)}
              disabled={displayQuantity + step > maxDisplay}
              aria-label={`Sumar ${item.name}`}
            >
              <Plus size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Campo para escribir la cantidad a mano. Guarda lo que se va tipeando y recién
 * lo aplica al salir del campo o con Enter: si se normalizara en cada tecla,
 * escribir "1,5" sería imposible (el "1," se convertía en 1 al instante).
 */
function QuantityInput({
  id,
  value,
  displayUnit,
  onCommit,
}: {
  id: string;
  value: number;
  displayUnit: ProductUnit;
  onCommit: (value: number) => void;
}) {
  const formatted = formatQuantityInput(value, displayUnit);
  const [draft, setDraft] = useState(formatted);

  // Si la cantidad cambia desde afuera (botones +/- o cambio de kg a g), el campo la sigue.
  useEffect(() => {
    setDraft(formatted);
  }, [formatted]);

  function apply() {
    const parsed = parseQuantityInput(draft, displayUnit);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDraft(formatted);
      return;
    }
    onCommit(parsed);
    // Si al normalizar quedó igual que antes, el efecto no se dispara: se restaura acá.
    setDraft(formatted);
  }

  return (
    <input
      id={id}
      type="text"
      inputMode={displayUnit === 'kg' ? 'decimal' : 'numeric'}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={apply}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          apply();
        }
      }}
      autoComplete="off"
    />
  );
}

const CartItemRow = memo(CartItemRowComponent);
export default CartItemRow;

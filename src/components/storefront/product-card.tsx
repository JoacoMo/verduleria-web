'use client';

import { memo } from 'react';
import { Check, Minus, Plus, ShoppingCart } from 'lucide-react';
import { formatArs } from '@/lib/format-price';
import {
  PRODUCT_CART_STEP,
  PRODUCT_MAX_CART_QUANTITY,
  PRODUCT_UNIT_LABELS,
  formatProductQuantity,
  isWeightUnit,
  type ProductUnit,
} from '@/lib/product-units';
import type { Product } from '@/lib/types';
import { PLACEHOLDER_IMAGE, handleImageError } from './format';

/** Cómo se carga la foto: las primeras de la grilla no esperan al scroll. */
export type ImagePriority = 'high' | 'eager' | 'lazy';

export type ProductCardProps = {
  product: Product;
  effectivePrice: number;
  onOffer: boolean;
  discountPercent: number;
  offerEndsLabel: string | null;
  /** Cantidad elegida con los +/- de la tarjeta (todavía no está en el carrito). */
  selectedQuantity: number;
  /** Lo que ya hay en el carrito (0 si nada). */
  inCartQuantity: number;
  imagePriority: ImagePriority;
  /**
   * Plegada hasta "Ver todos los productos": está en el HTML (para los
   * buscadores) pero oculta con CSS, y su foto no se baja (va con loading="lazy").
   */
  collapsed?: boolean;
  /** Tarjeta destacada de "Bolsones de la semana": muestra entera la descripción. */
  featured?: boolean;
  onAdjust: (productId: number, unit: ProductUnit, direction: 1 | -1) => void;
  onAdd: (product: Product, quantity: number) => void;
};

/**
 * Tarjeta de producto.
 *
 * Va con React.memo y recibe solo valores sueltos y funciones estables: al sumar
 * algo al carrito o tocar los +/- de una tarjeta, se vuelve a dibujar solo esa,
 * no las cien de la grilla (en un celular de gama baja se nota).
 */
function ProductCardComponent({
  product,
  effectivePrice,
  onOffer,
  discountPercent,
  offerEndsLabel,
  selectedQuantity,
  inCartQuantity,
  imagePriority,
  collapsed = false,
  featured = false,
  onAdjust,
  onAdd,
}: ProductCardProps) {
  const step = PRODUCT_CART_STEP[product.unit];
  const unitLabel = PRODUCT_UNIT_LABELS[product.unit];
  const isBolson = product.category === 'Bolsones';
  const canIncrease = selectedQuantity + step <= PRODUCT_MAX_CART_QUANTITY[product.unit];

  const classes = [
    'product-card',
    featured ? 'product-card-featured' : '',
    isBolson ? 'product-card-bolson' : '',
    onOffer ? 'product-card-offer' : '',
    product.available ? '' : 'product-card-unavailable',
    collapsed ? 'is-collapsed' : '',
  ].filter(Boolean).join(' ');

  return (
    <article className={classes}>
      <div className="product-card-image">
        <img
          src={product.image || PLACEHOLDER_IMAGE}
          alt={product.name}
          width={400}
          height={300}
          decoding="async"
          loading={imagePriority === 'lazy' ? 'lazy' : 'eager'}
          fetchPriority={imagePriority === 'high' ? 'high' : undefined}
          onError={handleImageError}
        />
        {discountPercent > 0 ? (
          <span className="discount-badge" aria-hidden="true">-{discountPercent}%</span>
        ) : null}
        <span className={`price-tag ${onOffer ? 'is-offer' : ''}`}>
          {formatArs(effectivePrice)} / {unitLabel}
        </span>
        {product.available ? null : <span className="unavailable-overlay">Sin stock</span>}
      </div>

      <div className="product-info">
        <h3>{product.name}</h3>

        {onOffer ? (
          <p className="offer-line">
            <span className="offer-label">Oferta{discountPercent > 0 ? ` -${discountPercent}%` : ''}</span>
            <span className="visually-hidden">Precio normal:</span>
            <s className="regular-price">{formatArs(product.price)}</s>
            {offerEndsLabel ? <span className="offer-ends">{offerEndsLabel}</span> : null}
          </p>
        ) : null}

        {product.description ? (
          <p className={`product-description ${featured ? 'is-full' : ''}`}>
            {isBolson ? <strong>Trae: </strong> : null}
            {product.description}
          </p>
        ) : null}

        {product.available ? (
          <p className="availability-note available">
            <span className="status-dot" aria-hidden="true" />
            Disponible
          </p>
        ) : (
          <p className="availability-note unavailable">
            <span className="status-dot" aria-hidden="true" />
            No disponible por ahora
          </p>
        )}
        <p className="stock-note">
          Se vende por {unitLabel}
          {isWeightUnit(product.unit) ? ' · se ajusta al pesar' : ''}
        </p>

        {product.available ? (
          <>
            <div className="grid-qty-controls">
              <button
                type="button"
                disabled={selectedQuantity <= step}
                onClick={() => onAdjust(product.id, product.unit, -1)}
                aria-label={`Restar cantidad de ${product.name}`}
              >
                <Minus size={18} aria-hidden="true" />
              </button>
              <span aria-live="polite">{formatProductQuantity(selectedQuantity, product.unit)}</span>
              <button
                type="button"
                disabled={!canIncrease}
                onClick={() => onAdjust(product.id, product.unit, 1)}
                aria-label={`Sumar cantidad de ${product.name}`}
              >
                <Plus size={18} aria-hidden="true" />
              </button>
            </div>
            <button type="button" className="add-to-cart-btn" onClick={() => onAdd(product, selectedQuantity)}>
              <ShoppingCart size={18} aria-hidden="true" /> Agregar al carrito
            </button>
            {inCartQuantity > 0 ? (
              <p className="in-cart-note">
                <Check size={16} aria-hidden="true" /> En tu carrito: {formatProductQuantity(inCartQuantity, product.unit)}
              </p>
            ) : null}
          </>
        ) : (
          <button type="button" className="add-to-cart-btn" disabled>
            Sin stock por ahora
          </button>
        )}
      </div>
    </article>
  );
}

const ProductCard = memo(ProductCardComponent);
export default ProductCard;

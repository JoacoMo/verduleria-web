'use client';

import { Plus, ShoppingBasket } from 'lucide-react';
import { formatArs } from '@/lib/format-price';
import { PRODUCT_UNIT_LABELS } from '@/lib/product-units';
import type { Product } from '@/lib/types';
import { PLACEHOLDER_IMAGE, handleImageError } from './format';
import type { ProductPriceView } from './types';

type CartSuggestionsProps = {
  /** Bolsón para sugerir si en el carrito no hay ninguno. */
  bolson: Product | null;
  related: Product[];
  pricing: Map<number, ProductPriceView>;
  onAdd: (product: Product) => void;
};

function PriceText({ product, price }: { product: Product; price: ProductPriceView | undefined }) {
  const effective = price?.effectivePrice ?? product.price;
  return (
    <>
      {price?.onOffer ? (
        <>
          <span className="visually-hidden">Precio normal:</span>
          <s className="regular-price">{formatArs(product.price)}</s>{' '}
        </>
      ) : null}
      <span className={price?.onOffer ? 'offer-price' : ''}>{formatArs(effective)}</span> / {PRODUCT_UNIT_LABELS[product.unit]}
    </>
  );
}

/**
 * Sugerencias dentro del carrito: un recordatorio suave del bolsón (si no llevó
 * ninguno) y algunos productos más, primero bolsones y ofertas.
 */
export default function CartSuggestions({ bolson, related, pricing, onAdd }: CartSuggestionsProps) {
  if (!bolson && related.length === 0) return null;

  return (
    <>
      {bolson ? (
        <div className="bolson-suggestion">
          <ShoppingBasket size={26} aria-hidden="true" />
          <div>
            <p className="bolson-suggestion-title">No te olvides de tu bolsón</p>
            <p>
              <strong>{bolson.name}</strong> · <PriceText product={bolson} price={pricing.get(bolson.id)} />
            </p>
            {bolson.description ? <p className="bolson-suggestion-desc">Trae: {bolson.description}</p> : null}
          </div>
          <button type="button" onClick={() => onAdd(bolson)} aria-label={`Sumar ${bolson.name} al carrito`}>
            <Plus size={18} aria-hidden="true" /> Sumar
          </button>
        </div>
      ) : null}

      {related.length > 0 ? (
        <div className="related-products">
          <h3>También te puede interesar</h3>
          <ul className="related-products-list">
            {related.map((product) => (
              <li className="related-product-card" key={product.id}>
                <img
                  src={product.image || PLACEHOLDER_IMAGE}
                  alt=""
                  width={44}
                  height={44}
                  loading="lazy"
                  decoding="async"
                  onError={handleImageError}
                />
                <div>
                  <strong>{product.name}</strong>
                  <p><PriceText product={product} price={pricing.get(product.id)} /></p>
                </div>
                <button type="button" onClick={() => onAdd(product)} aria-label={`Agregar ${product.name} al carrito`}>
                  <Plus size={16} aria-hidden="true" /> Agregar
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

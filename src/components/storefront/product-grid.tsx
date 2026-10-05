'use client';

import { PRODUCT_DEFAULT_CART_QUANTITY, type ProductUnit } from '@/lib/product-units';
import type { Product } from '@/lib/types';
import ProductCard, { type ImagePriority } from './product-card';
import { getPriceView } from './use-product-pricing';
import type { ProductPriceView } from './types';

/** Fotos que se cargan sin esperar al scroll (las que se ven al entrar). */
const EAGER_IMAGES = 4;

export type ProductGridProps = {
  products: Product[];
  pricing: Map<number, ProductPriceView>;
  /** Hora con la que se calculan los precios, por si un producto no está en `pricing`. */
  now: Date;
  gridQuantities: Record<number, number>;
  inCart: Map<number, number>;
  /** Cuántas fotos de producto hay arriba de esta grilla (para la prioridad de carga). */
  imageOffset?: number;
  featured?: boolean;
  className?: string;
  onAdjust: (productId: number, unit: ProductUnit, direction: 1 | -1) => void;
  onAdd: (product: Product, quantity: number) => void;
};

function imagePriorityFor(position: number): ImagePriority {
  if (position === 0) return 'high';
  return position < EAGER_IMAGES ? 'eager' : 'lazy';
}

/** Grilla de tarjetas. La usan el catálogo y la sección de bolsones. */
export default function ProductGrid({
  products,
  pricing,
  now,
  gridQuantities,
  inCart,
  imageOffset = 0,
  featured = false,
  className = 'product-grid',
  onAdjust,
  onAdd,
}: ProductGridProps) {
  return (
    <div className={className}>
      {products.map((product, index) => {
        const price = pricing.get(product.id) ?? getPriceView(product, now);
        return (
          <ProductCard
            key={product.id}
            product={product}
            effectivePrice={price.effectivePrice}
            onOffer={price.onOffer}
            discountPercent={price.discountPercent}
            offerEndsLabel={price.offerEndsLabel}
            selectedQuantity={gridQuantities[product.id] ?? PRODUCT_DEFAULT_CART_QUANTITY[product.unit]}
            inCartQuantity={inCart.get(product.id) ?? 0}
            imagePriority={imagePriorityFor(imageOffset + index)}
            featured={featured}
            onAdjust={onAdjust}
            onAdd={onAdd}
          />
        );
      })}
    </div>
  );
}

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
  /**
   * A partir de qué posición las tarjetas van plegadas ("Ver todos los
   * productos"); null o sin esto, se ven todas.
   */
  collapseAfter?: number | null;
  featured?: boolean;
  className?: string;
  onAdjust: (productId: number, unit: ProductUnit, direction: 1 | -1) => void;
  onAdd: (product: Product, quantity: number) => void;
};

function imagePriorityFor(position: number): ImagePriority {
  if (position === 0) return 'high';
  return position < EAGER_IMAGES ? 'eager' : 'lazy';
}

/** La tarjeta en esa posición va plegada. */
export function isCollapsedPosition(index: number, collapseAfter: number | null | undefined) {
  return collapseAfter !== null && collapseAfter !== undefined && index >= collapseAfter;
}

/**
 * Grilla de tarjetas. La usan el catálogo y la sección de bolsones.
 *
 * Se dibujan SIEMPRE todos los productos, también los que pasan del límite
 * inicial: esos van plegados con CSS (.is-collapsed) y su foto con loading="lazy",
 * que el navegador no baja mientras la tarjeta no se ve. Así el HTML del servidor
 * trae el catálogo completo con nombres y precios para los buscadores (antes
 * traía solo los primeros 8 y el resto existía solo en el JSON-LD).
 */
export default function ProductGrid({
  products,
  pricing,
  now,
  gridQuantities,
  inCart,
  imageOffset = 0,
  collapseAfter = null,
  featured = false,
  className = 'product-grid',
  onAdjust,
  onAdd,
}: ProductGridProps) {
  return (
    <div className={className}>
      {products.map((product, index) => {
        const price = pricing.get(product.id) ?? getPriceView(product, now);
        const collapsed = isCollapsedPosition(index, collapseAfter);
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
            imagePriority={collapsed ? 'lazy' : imagePriorityFor(imageOffset + index)}
            collapsed={collapsed}
            featured={featured}
            onAdjust={onAdjust}
            onAdd={onAdd}
          />
        );
      })}
    </div>
  );
}

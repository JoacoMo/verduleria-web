import { useMemo } from 'react';
import { getDiscountPercent, getEffectivePrice, isOfferActive } from '@/lib/pricing';
import type { Product } from '@/lib/types';
import { formatOfferEnds } from './format';
import type { ProductPriceView } from './types';

/** Precio que se muestra de un producto en un momento dado (todo sale de pricing.ts). */
export function getPriceView(product: Product, now: Date): ProductPriceView {
  const onOffer = isOfferActive(product, now);
  return {
    effectivePrice: getEffectivePrice(product, now),
    onOffer,
    discountPercent: onOffer ? getDiscountPercent(product, now) : 0,
    offerEndsLabel: onOffer ? formatOfferEnds(product.offerEndsAt) : null,
  };
}

/**
 * Precios de todo el catálogo, calculados una sola vez por catálogo y minuto.
 * Las tarjetas reciben números sueltos (no objetos nuevos), así React.memo puede
 * saltearse las que no cambiaron.
 */
export function useProductPricing(products: Product[], now: Date) {
  return useMemo(() => {
    const pricing = new Map<number, ProductPriceView>();
    for (const product of products) {
      pricing.set(product.id, getPriceView(product, now));
    }
    return pricing;
  }, [products, now]);
}

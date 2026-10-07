import { getEffectivePrice, isOfferActive, type PriceChange } from '@/lib/pricing';
import type { Product } from '@/lib/types';

/**
 * Ajustes al catálogo en memoria cuando el checkout avisa que algo cambió.
 *
 * La tienda no vuelve a pedir el catálogo entero: con mala señal es un viaje más
 * que puede fallar. El servidor ya dice qué cambió, y con eso alcanza para que
 * la tarjeta y el carrito muestren lo mismo que se va a cobrar.
 */

/**
 * Deja el producto con el precio que informó el servidor.
 *
 * El servidor manda el precio efectivo (con oferta o sin ella), no cuál de los
 * dos cambió. Si acá había una oferta vigente y el precio nuevo sigue por debajo
 * del normal, lo que cambió es la oferta; si no, se toma como precio normal y se
 * descarta la oferta (p. ej. venció mientras el cliente armaba el carrito).
 */
export function withServerPrice(product: Product, currentPrice: number, now: Date): Product {
  if (Math.abs(getEffectivePrice(product, now) - currentPrice) < 0.01) return product;
  if (isOfferActive(product, now) && currentPrice < product.price) {
    return { ...product, offerPrice: currentPrice };
  }
  return { ...product, price: currentPrice, offerPrice: null, offerEndsAt: null };
}

export function applyPriceChanges(products: Product[], changes: PriceChange[], now: Date): Product[] {
  if (changes.length === 0) return products;
  const byId = new Map(changes.map((change) => [change.id, change.currentPrice]));
  return products.map((product) => {
    const currentPrice = byId.get(product.id);
    return currentPrice === undefined ? product : withServerPrice(product, currentPrice, now);
  });
}

/** Marca sin stock lo que el servidor rechazó (también lo que se borró del catálogo). */
export function markUnavailable(products: Product[], ids: number[]): Product[] {
  if (ids.length === 0) return products;
  const unavailable = new Set(ids);
  return products.map((product) => (
    unavailable.has(product.id) && product.available ? { ...product, available: false } : product
  ));
}

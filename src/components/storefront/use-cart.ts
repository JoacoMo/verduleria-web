import { useCallback, useEffect, useMemo, useState } from 'react';
import { getEffectivePrice, isOfferActive, lineTotal } from '@/lib/pricing';
import { PRODUCT_DEFAULT_CART_QUANTITY } from '@/lib/product-units';
import type { Product } from '@/lib/types';
import { clampQuantity } from './quantity';
import { STORAGE_KEYS, readStorage, toCartLines, writeStorage } from './storage';
import type { CartItem, CartLine } from './types';

export type RepeatOrderResult = { loaded: number; missing: number };

/**
 * Estado del carrito.
 *
 * Se guardan solo líneas { id, quantity }; todo lo demás (precio con oferta,
 * nombre, foto, stock) se cruza con el catálogo en cada render. Así el precio que
 * ve el cliente es siempre el vigente y el servidor sigue siendo el que decide
 * cuánto se cobra (si cambió algo, el checkout lo avisa antes de registrar).
 *
 * Las acciones reciben el producto entero en vez de buscarlo por id: no dependen
 * del catálogo, son estables entre renders y las tarjetas memorizadas no se
 * vuelven a dibujar cada vez que cambia el carrito.
 */
export function useCart(products: Product[], now: Date) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [lastOrderLines, setLastOrderLines] = useState<CartLine[]>([]);
  // Hasta no leer localStorage no se escribe, para no pisar el carrito guardado
  // con el carrito vacío del primer render.
  const [storageLoaded, setStorageLoaded] = useState(false);

  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

  useEffect(() => {
    setLines(toCartLines(readStorage(STORAGE_KEYS.cart)));
    setLastOrderLines(toCartLines(readStorage(STORAGE_KEYS.lastOrder)));
    setStorageLoaded(true);
  }, []);

  useEffect(() => {
    if (!storageLoaded) return;
    writeStorage(STORAGE_KEYS.cart, lines);
  }, [lines, storageLoaded]);

  // Reconciliación con el catálogo: lo que se borró se saca y las cantidades se
  // llevan al paso de la unidad (por si el dueño cambió un producto de kg a
  // unidad). Si el catálogo vino vacío (falló la base en el render del servidor)
  // no se toca nada: mejor conservar el carrito que vaciarlo por un error.
  useEffect(() => {
    if (!storageLoaded || productsById.size === 0) return;
    setLines((current) => {
      let changed = false;
      const next = current.flatMap((line) => {
        const product = productsById.get(line.id);
        if (!product) {
          changed = true;
          return [];
        }
        const quantity = clampQuantity(line.quantity, product.unit);
        if (quantity !== line.quantity) changed = true;
        return [{ id: line.id, quantity }];
      });
      return changed ? next : current;
    });
  }, [productsById, storageLoaded]);

  const items = useMemo<CartItem[]>(() => lines.flatMap((line) => {
    const product = productsById.get(line.id);
    if (!product) return [];
    const unitPrice = getEffectivePrice(product, now);
    return [{
      id: product.id,
      name: product.name,
      image: product.image,
      unit: product.unit,
      category: product.category,
      available: product.available,
      quantity: line.quantity,
      unitPrice,
      regularPrice: product.price,
      onOffer: isOfferActive(product, now),
      lineTotal: lineTotal({ price: unitPrice, quantity: line.quantity }),
    }];
  }), [lines, productsById, now]);

  /** Cantidad de cada producto en el carrito, para el "En tu carrito" de las tarjetas. */
  const quantitiesById = useMemo(() => new Map(lines.map((line) => [line.id, line.quantity])), [lines]);

  /** Suma al carrito. Devuelve false si el producto no se puede comprar. */
  const addToCart = useCallback((product: Product, quantity?: number) => {
    // Nada sin stock entra al carrito. El servidor lo vuelve a chequear igual.
    if (!product.available) return false;
    const toAdd = quantity ?? PRODUCT_DEFAULT_CART_QUANTITY[product.unit];
    setLines((current) => {
      const index = current.findIndex((line) => line.id === product.id);
      if (index < 0) return [...current, { id: product.id, quantity: clampQuantity(toAdd, product.unit) }];
      const next = [...current];
      next[index] = { id: product.id, quantity: clampQuantity(current[index].quantity + toAdd, product.unit) };
      return next;
    });
    return true;
  }, []);

  /** Fija la cantidad (en la unidad del producto). Nunca la deja en 0: para sacar está la ×. */
  const setQuantity = useCallback((item: Pick<CartItem, 'id' | 'unit'>, quantity: number) => {
    const next = clampQuantity(quantity, item.unit);
    if (next <= 0) return;
    setLines((current) => current.map((line) => (line.id === item.id ? { ...line, quantity: next } : line)));
  }, []);

  const removeFromCart = useCallback((productId: number) => {
    setLines((current) => current.filter((line) => line.id !== productId));
  }, []);

  const clearCart = useCallback(() => setLines([]), []);

  /** Guarda el pedido recién hecho para poder repetirlo la próxima vez. */
  const saveLastOrder = useCallback((orderLines: CartLine[]) => {
    writeStorage(STORAGE_KEYS.lastOrder, orderLines);
    setLastOrderLines(orderLines);
  }, []);

  /** Carga el último pedido con lo que hoy hay en stock. */
  const repeatLastOrder = useCallback((): RepeatOrderResult => {
    const available = lastOrderLines.flatMap((line) => {
      const product = productsById.get(line.id);
      if (!product || !product.available) return [];
      return [{ id: line.id, quantity: clampQuantity(line.quantity, product.unit) }];
    });
    if (available.length > 0) setLines(available);
    return { loaded: available.length, missing: lastOrderLines.length - available.length };
  }, [lastOrderLines, productsById]);

  return {
    lines,
    items,
    quantitiesById,
    lastOrderLines,
    storageLoaded,
    addToCart,
    setQuantity,
    removeFromCart,
    clearCart,
    saveLastOrder,
    repeatLastOrder,
  };
}

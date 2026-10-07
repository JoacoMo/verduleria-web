import type { ProductCategory } from '@/lib/product-categories';
import type { ProductUnit } from '@/lib/product-units';
import type { ReplacementPolicy } from '@/lib/order-options';
import type { PriceChange } from '@/lib/pricing';
import type { CheckoutResponse } from '@/lib/types';

/**
 * Lo mínimo que se guarda del carrito: id y cantidad. El precio, el nombre y el
 * stock salen SIEMPRE del catálogo vigente, así un carrito guardado hace días no
 * arrastra precios viejos.
 */
export type CartLine = { id: number; quantity: number };

/** Línea del carrito ya cruzada con el catálogo y con el precio del día. */
export type CartItem = {
  id: number;
  name: string;
  image: string;
  unit: ProductUnit;
  category: ProductCategory;
  available: boolean;
  /** Cantidad en la unidad del producto (kg para lo que se vende por kilo). */
  quantity: number;
  /** Precio unitario que se cobra hoy (con la oferta, si está vigente). */
  unitPrice: number;
  /** Precio normal, para mostrarlo tachado cuando hay oferta. */
  regularPrice: number;
  onOffer: boolean;
  lineTotal: number;
};

/** Precio de un producto tal como se muestra en la tienda en este momento. */
export type ProductPriceView = {
  effectivePrice: number;
  onOffer: boolean;
  /** 0 si no hay oferta (o si el descuento redondeado da 0 %). */
  discountPercent: number;
  /** "Hasta el martes 6/10", o null si la oferta no vence. */
  offerEndsLabel: string | null;
};

export type CustomerForm = {
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  notes: string;
  replacementPolicy: ReplacementPolicy;
};

export type CheckoutStep = 'cart' | 'details';

/**
 * Aviso que se muestra en el carrito cuando el servidor no pudo registrar el
 * pedido. Reemplaza a los alert() de antes: el cliente ve qué pasó sin perder lo
 * que tenía cargado.
 */
export type CheckoutNotice =
  | { kind: 'price-changed'; changes: PriceChange[] }
  | { kind: 'unavailable'; ids: number[] }
  | { kind: 'slot' }
  /** contactUrl: link a WhatsApp para seguir el pedido por ahí (topes anti-spam). */
  | { kind: 'error'; message: string; contactUrl?: string };

export type OrderConfirmationData = {
  order: CheckoutResponse;
  whatsappUrl: string;
  hasWeightItems: boolean;
  customerAddress: string | null;
  /** Retiro: cuándo está listo ("hoy desde las 17:30"), calculado al confirmar. null si es envío. */
  pickupReady: string | null;
};

import type { ProductUnit } from './product-units';
import type { ProductCategory } from './product-categories';
import type { DeliveryMethod, OrderStatus, PaymentMethod } from './order-options';
import type { DeliverySlot } from './delivery-slots';

export type Product = {
  id: number;
  name: string;
  /** Precio normal por unidad de venta. El que se cobra sale de getEffectivePrice(). */
  price: number;
  image: string;
  unit: ProductUnit;
  category: ProductCategory;
  description: string | null;
  offerPrice: number | null;
  /** ISO 8601, o null si la oferta no vence. */
  offerEndsAt: string | null;
  available: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type OrderItem = {
  id: number;
  name: string;
  price: number;
  quantity: number;
  unit: ProductUnit;
};

export type { DeliveryMethod, OrderStatus, PaymentMethod };

export type OrderRecord = {
  id: number;
  items: OrderItem[];
  subtotal: number;
  shippingCost: number;
  total: number;
  status: OrderStatus;
  deliveryMethod: DeliveryMethod;
  paymentMethod: PaymentMethod | null;
  deliverySlot: string | null;
  adjustedAt: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  notes: string | null;
  replacementPolicy: string | null;
  createdAt?: string;
  updatedAt?: string;
};

/** Datos públicos del local que necesita el navegador. */
export type StoreInfo = {
  storeName: string;
  storeAddress: string;
  storeNeighborhood: string;
  storeHours: {
    weekday: string;
    sunday: string;
  };
  transferAlias: string;
  transferCbu: string;
  whatsappNumber: string;
  contactEmail: string;
  instagramUrl: string;
  googleReviewUrl: string;
  deliveryMaxWeightKg: number;
  deliveryMinPurchase: number;
  deliveryFee: number;
  deliveryFreeThreshold: number;
};

export type ProductPayload = {
  name?: string;
  price?: number;
  image?: string;
  unit?: ProductUnit;
  category?: ProductCategory;
  description?: string | null;
  offerPrice?: number | null;
  /** "YYYY-MM-DD" (vence al final de ese día, hora argentina) o null. */
  offerEndsAt?: string | null;
  available?: boolean;
};

/** Un precio que cambió entre lo que vio el cliente en el carrito y lo que se cobra. */
export type CheckoutPriceChange = { id: number; name: string; previousPrice: number; currentPrice: number };

/** Respuesta exitosa de POST /api/checkout. */
export type CheckoutResponse = {
  orderId: number;
  items: OrderItem[];
  subtotal: number;
  shippingCost: number;
  total: number;
  paymentMethod: PaymentMethod;
  deliveryMethod: DeliveryMethod;
  deliverySlot: DeliverySlot | null;
  transferAlias: string;
  transferCbu: string;
  whatsappNumber: string;
  storeName: string;
  /** true si la clave de idempotencia ya tenía un pedido (reintento). */
  yaExistia?: boolean;
  /**
   * Productos que bajaron de precio mientras el cliente armaba el carrito: el
   * pedido se creó con el precio menor (los ítems ya lo traen) y la tienda se
   * lo cuenta. Vacío si no bajó nada, y siempre vacío en un reintento (yaExistia).
   */
  priceDrops: CheckoutPriceChange[];
  /**
   * Cuándo se creó el pedido (ISO, hora del servidor). La tienda la usa para
   * decir cuándo está listo un retiro con la misma hora que usa el panel, y no
   * con el reloj del celular.
   */
  createdAt: string;
};

/**
 * Respuesta 409 de POST /api/checkout cuando algún precio SUBIÓ, o cuando una
 * baja igual cambia el trato (sube el total porque se pierde el envío gratis, o
 * el envío queda por debajo del mínimo). Si solo bajaron sin nada de eso, el
 * pedido se crea. `priceChanges` trae todos los que cambiaron, también los que
 * bajaron, para que el carrito quede con el total real.
 */
export type CheckoutPriceChangedResponse = {
  error: string;
  code: 'PRECIOS_CAMBIARON';
  priceChanges: CheckoutPriceChange[];
};

/** Respuesta 409 de POST /api/checkout cuando algo se quedó sin stock o dejó de existir. */
export type CheckoutUnavailableResponse = {
  error: string;
  code: 'SIN_STOCK';
  unavailableIds: number[];
};

/** Respuesta 400 cuando el turno elegido ya no está disponible. */
export type CheckoutSlotResponse = {
  error: string;
  code: 'TURNO_NO_DISPONIBLE';
  availableSlots: DeliverySlot[];
};

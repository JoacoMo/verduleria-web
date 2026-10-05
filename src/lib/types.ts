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
};

/** Respuesta 409 de POST /api/checkout cuando cambió algún precio. */
export type CheckoutPriceChangedResponse = {
  error: string;
  code: 'PRECIOS_CAMBIARON';
  priceChanges: Array<{ id: number; name: string; previousPrice: number; currentPrice: number }>;
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

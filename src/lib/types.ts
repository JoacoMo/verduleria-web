import type { ProductUnit } from './product-units';

export type Product = {
  id: number;
  name: string;
  price: number;
  image: string;
  unit: ProductUnit;
  createdAt?: string;
};

export type OrderItem = {
  id: number;
  name: string;
  price: number;
  quantity: number;
  unit: ProductUnit;
};

export type DeliveryMethod = 'pickup' | 'delivery';

export type OrderRecord = {
  id: number;
  items: OrderItem[];
  total: number;
  status: 'pending' | 'paid' | 'cancelled' | 'failed';
  deliveryMethod: DeliveryMethod;
  customerName: string | null;
  customerPhone: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type StoreInfo = {
  storeName: string;
  storeAddress: string;
  storeHours: {
    weekday: string;
    sunday: string;
  };
  transferAlias: string;
  transferCbu: string;
  whatsappNumber: string;
  deliveryProviderName: string;
  deliveryMaxWeightKg: number;
  deliveryMinPurchase: number;
};

export type ProductPayload = {
  name?: string;
  price?: number;
  image?: string;
  unit?: ProductUnit;
};

export type OrderConfirmation = StoreInfo & {
  orderId: number;
  total: number;
  items: OrderItem[];
  whatsappUrl: string;
};
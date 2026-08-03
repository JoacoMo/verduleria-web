export type Product = {
  id: number;
  name: string;
  price: number;
  image: string;
  stock: number;
  createdAt?: string;
};

export type OrderItem = {
  id: number;
  name: string;
  price: number;
  quantity: number;
};

export type OrderRecord = {
  id: number;
  items: OrderItem[];
  total: number;
  status: 'pending' | 'paid' | 'cancelled' | 'failed';
  customerName: string | null;
  customerPhone: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type StoreInfo = {
  storeName: string;
  transferAlias: string;
  transferCbu: string;
  whatsappNumber: string;
};

export type ProductPayload = {
  name?: string;
  price?: number;
  image?: string;
  stock?: number;
};

export type OrderConfirmation = StoreInfo & {
  orderId: number;
  total: number;
  items: OrderItem[];
};
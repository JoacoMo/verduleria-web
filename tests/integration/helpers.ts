import { randomUUID } from 'node:crypto';
import { describe, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ADMIN_COOKIE_NAME, createAdminToken } from '@/lib/auth';
import type { ProductUnit } from '@/lib/product-units';

/** true si hay base de integración. Sin ella, `describeDb` saltea el bloque. */
export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

export const describeDb = describe.skipIf(!hasTestDb);

export { prisma };

/* -------------------------------------------------------------------------- */
/* Requests                                                                   */
/* -------------------------------------------------------------------------- */

let ipCounter = 0;

/**
 * IP distinta por request. El rate limit es en memoria y por IP: sin esto, los
 * tests de checkout se comerían el cupo de 12 pedidos cada 10 minutos.
 */
export function nextIp() {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

type RequestOptions = {
  method?: string;
  /** Se manda como JSON. */
  body?: unknown;
  /** Cuerpo crudo (para probar JSON roto o bodies gigantes). */
  rawBody?: BodyInit;
  headers?: Record<string, string>;
  cookie?: string;
  /** IP para el rate limit. Por defecto, una nueva en cada request. */
  ip?: string;
};

export function apiRequest(path: string, options: RequestOptions = {}) {
  const headers: Record<string, string> = {
    'x-forwarded-for': options.ip ?? nextIp(),
    ...(options.cookie ? { cookie: options.cookie } : {}),
  };
  let body: BodyInit | undefined;
  if (options.rawBody !== undefined) {
    body = options.rawBody;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  return new Request(`http://localhost${path}`, {
    method: options.method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...headers, ...options.headers },
    body,
  });
}

/** Contexto de una ruta dinámica, al estilo Next 15 (params es una promesa). */
export function routeParams(id: string | number) {
  return { params: Promise.resolve({ id: String(id) }) };
}

export async function readJson<T = Record<string, unknown>>(response: Response): Promise<T> {
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

/* -------------------------------------------------------------------------- */
/* Sesión del panel                                                           */
/* -------------------------------------------------------------------------- */

/** Cookie de sesión válida, firmada con el JWT_SECRET de los tests. */
export function adminCookie() {
  return `${ADMIN_COOKIE_NAME}=${createAdminToken()}`;
}

/** "elpampa_admin=<token>" a partir del Set-Cookie de una respuesta de login. */
export function cookieFromSetCookie(response: Response) {
  const header = response.headers.get('set-cookie') ?? '';
  const pair = header.split(';')[0]?.trim() ?? '';
  return pair.startsWith(`${ADMIN_COOKIE_NAME}=`) ? pair : null;
}

/* -------------------------------------------------------------------------- */
/* Datos                                                                      */
/* -------------------------------------------------------------------------- */

let productCounter = 0;

type ProductInput = {
  name?: string;
  price?: number;
  unit?: ProductUnit;
  category?: string;
  available?: boolean;
  offerPrice?: number | null;
  offerEndsAt?: Date | null;
  description?: string | null;
};

/** Producto propio del test, con nombre único para no chocar con otros tests. */
export async function createProduct(input: ProductInput = {}) {
  productCounter += 1;
  return prisma.product.create({
    data: {
      name: input.name ?? `Test producto ${productCounter} ${randomUUID().slice(0, 8)}`,
      price: input.price ?? 1000,
      image: '',
      unit: input.unit ?? 'kg',
      category: input.category ?? 'Verduras',
      available: input.available ?? true,
      offerPrice: input.offerPrice ?? null,
      offerEndsAt: input.offerEndsAt ?? null,
      description: input.description ?? null,
    },
  });
}

type OrderInput = Partial<Omit<Prisma.OrderCreateInput, 'items'>> & {
  items?: Array<{ id: number; name: string; price: number; quantity: number; unit: ProductUnit }>;
};

/** Pedido insertado directo en la base (para los tests del panel y del cron). */
export async function createOrder(input: OrderInput = {}) {
  const items = input.items ?? [{ id: 1, name: 'Tomate', price: 1000, quantity: 1.5, unit: 'kg' as const }];
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return prisma.order.create({
    data: {
      subtotal,
      shippingCost: 0,
      total: subtotal,
      status: 'pending',
      deliveryMethod: 'pickup',
      paymentMethod: 'transfer',
      customerName: 'Cliente de prueba',
      customerPhone: '3510000000',
      replacementPolicy: 'replace',
      ...input,
      items,
    },
  });
}

export function newIdempotencyKey() {
  return randomUUID();
}

/* -------------------------------------------------------------------------- */
/* Reloj                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Congela SOLO `Date` (no setTimeout/setInterval: Prisma los usa para sus
 * timeouts). Así el handler ve la hora simulada en `new Date()`.
 */
export function freezeTime(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

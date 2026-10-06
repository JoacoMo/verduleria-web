import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST as checkout } from '@/app/api/checkout/route';
import { formatArs } from '@/lib/format-price';
import { ORDER_CAPS, RATE_LIMITS } from '@/lib/rate-limit';
import type { CheckoutResponse } from '@/lib/types';
import {
  apiRequest,
  createProduct,
  describeDb,
  freezeTime,
  newIdempotencyKey,
  nextIp,
  prisma,
  readJson,
} from './helpers';

type CartLine = { id: unknown; quantity: unknown; price?: unknown };

type CheckoutInput = {
  cart: CartLine[];
  deliveryMethod?: 'pickup' | 'delivery';
  deliverySlot?: unknown;
  paymentMethod?: unknown;
  customer?: Record<string, unknown>;
  idempotencyKey?: unknown;
};

const CUSTOMER = {
  customerName: 'Ana Pérez',
  customerPhone: '351 123-4567',
  customerAddress: 'Av. Colón 123, Centro',
  notes: 'Timbre 2B',
  replacementPolicy: 'replace',
};

let phoneCounter = 0;

/**
 * Teléfono distinto por pedido: el checkout corta en ORDER_CAPS.perPhone
 * pedidos por teléfono en 24 h, y sin esto los tests se cortarían entre sí.
 */
function uniquePhone() {
  phoneCounter += 1;
  return `351${String(4_000_000 + phoneCounter).padStart(7, '0')}`;
}

function body(input: CheckoutInput) {
  return {
    cart: input.cart,
    deliveryMethod: input.deliveryMethod ?? 'pickup',
    deliverySlot: input.deliverySlot,
    paymentMethod: input.paymentMethod ?? 'transfer',
    customer: { ...CUSTOMER, customerPhone: uniquePhone(), ...input.customer },
    idempotencyKey: input.idempotencyKey === undefined ? newIdempotencyKey() : input.idempotencyKey,
  };
}

function post(payload: unknown, ip?: string) {
  return checkout(apiRequest('/api/checkout', { method: 'POST', body: payload, ip }));
}

const ordersWithKey = (key: string) => prisma.order.count({ where: { idempotencyKey: key } });

// Lunes 5/10/2026 a las 11:00 de Córdoba: entran los dos turnos de hoy.
const MONDAY_11AM = '2026-10-05T14:00:00.000Z';

afterEach(() => {
  vi.useRealTimers();
});

describeDb('POST /api/checkout: pedidos que entran', () => {
  it('retiro: crea el pedido con los precios y cantidades del servidor', async () => {
    const tomate = await createProduct({ price: 1000, unit: 'kg' });
    const acelga = await createProduct({ price: 900, unit: 'atado' });
    const payload = body({
      cart: [
        { id: tomate.id, quantity: 1.5, price: 1000 },
        { id: acelga.id, quantity: 2, price: 900 },
      ],
      paymentMethod: 'cash',
      customer: { customerPhone: '351 123-4567' },
    });

    const response = await post(payload);
    expect(response.status).toBe(200);
    const data = await readJson<CheckoutResponse>(response);
    expect(data).toEqual({
      orderId: expect.any(Number),
      items: [
        { id: tomate.id, name: tomate.name, price: 1000, quantity: 1.5, unit: 'kg' },
        { id: acelga.id, name: acelga.name, price: 900, quantity: 2, unit: 'atado' },
      ],
      subtotal: 3300,
      shippingCost: 0,
      total: 3300,
      paymentMethod: 'cash',
      deliveryMethod: 'pickup',
      deliverySlot: null,
      transferAlias: 'el.pampa.test',
      transferCbu: '0000003100000000000001',
      whatsappNumber: '5493510000000',
      storeName: 'El Pampa',
      priceDrops: [],
      createdAt: expect.any(String),
    });
    // Nada interno en la respuesta.
    expect(JSON.stringify(data)).not.toContain(payload.idempotencyKey as string);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: data.orderId } });
    expect(order).toMatchObject({
      status: 'pending',
      subtotal: 3300,
      shippingCost: 0,
      total: 3300,
      deliveryMethod: 'pickup',
      paymentMethod: 'cash',
      deliverySlot: null,
      idempotencyKey: payload.idempotencyKey,
      customerName: 'Ana Pérez',
      customerPhone: '3511234567',
      // Con retiro no se guarda la dirección aunque venga.
      customerAddress: null,
      notes: 'Timbre 2B',
      replacementPolicy: 'replace',
      adjustedAt: null,
    });
    expect(order.items).toEqual(data.items);
    // La hora del pedido sale del servidor (la tienda la usa para el aviso del retiro).
    expect(data.createdAt).toBe(order.createdAt.toISOString());
  });

  it('envío con turno: suma el costo fijo y guarda el turno y la dirección', async () => {
    freezeTime(MONDAY_11AM);
    const papa = await createProduct({ price: 6000, unit: 'kg' });
    const response = await post(body({
      cart: [{ id: papa.id, quantity: 2, price: 6000 }],
      deliveryMethod: 'delivery',
      deliverySlot: '2026-10-05T13',
    }));
    expect(response.status).toBe(200);
    const data = await readJson<CheckoutResponse>(response);
    expect(data).toMatchObject({
      subtotal: 12000,
      shippingCost: 4000,
      total: 16000,
      deliveryMethod: 'delivery',
      paymentMethod: 'transfer',
      deliverySlot: { id: '2026-10-05T13', date: '2026-10-05', start: 780, end: 840, label: 'Hoy de 13 a 14 h' },
    });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: data.orderId } });
    expect(order).toMatchObject({ deliverySlot: '2026-10-05T13', customerAddress: 'Av. Colón 123, Centro', shippingCost: 4000, total: 16000 });
  });

  it('envío gratis desde el umbral (sobre el subtotal)', async () => {
    freezeTime(MONDAY_11AM);
    const bolson = await createProduct({ price: 20000, unit: 'unidad', category: 'Bolsones' });
    const response = await post(body({
      cart: [{ id: bolson.id, quantity: 1, price: 20000 }],
      deliveryMethod: 'delivery',
      deliverySlot: '2026-10-05T19',
    }));
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ subtotal: 20000, shippingCost: 0, total: 20000 });
  });

  it('cobra el precio de oferta vigente', async () => {
    const banana = await createProduct({ price: 1500, offerPrice: 1200, offerEndsAt: new Date(Date.now() + 86_400_000) });
    const response = await post(body({ cart: [{ id: banana.id, quantity: 1, price: 1200 }] }));
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ items: [expect.objectContaining({ price: 1200 })], total: 1200 });
  });

  it('pestaña vieja sin precio en el carrito ni deliveryMethod (isDelivery): igual entra', async () => {
    freezeTime(MONDAY_11AM);
    const product = await createProduct({ price: 11000, unit: 'unidad' });
    const payload = body({ cart: [{ id: product.id, quantity: 1 }], deliverySlot: '2026-10-06T13' });
    const legacy = { ...payload, deliveryMethod: undefined, isDelivery: true, paymentMethod: undefined };
    const response = await post(legacy);
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ deliveryMethod: 'delivery', paymentMethod: 'transfer', shippingCost: 4000 });
  });

  it('retiro: un turno que venga (aunque sea basura) se ignora', async () => {
    const product = await createProduct({ price: 500 });
    const response = await post(body({ cart: [{ id: product.id, quantity: 1, price: 500 }], deliverySlot: 'cualquier-cosa' }));
    expect(response.status).toBe(200);
    const data = await readJson<CheckoutResponse>(response);
    expect(data.deliverySlot).toBeNull();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: data.orderId } })).deliverySlot).toBeNull();
  });
});

describeDb('POST /api/checkout: mínimo de envío, stock y precios', () => {
  it('envío por debajo del mínimo → 400 con cuánto falta, sin crear pedido', async () => {
    freezeTime(MONDAY_11AM);
    const product = await createProduct({ price: 9000, unit: 'unidad' });
    const payload = body({ cart: [{ id: product.id, quantity: 1, price: 9000 }], deliveryMethod: 'delivery', deliverySlot: '2026-10-05T13' });
    const response = await post(payload);
    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({
      error: `El pedido mínimo para envío es ${formatArs(10000)} en productos. Te faltan ${formatArs(1000)}, o podés retirarlo en el local.`,
    });
    expect(await ordersWithKey(payload.idempotencyKey as string)).toBe(0);
  });

  it('el mismo carrito con retiro sí entra (el mínimo es solo para envíos)', async () => {
    const product = await createProduct({ price: 9000, unit: 'unidad' });
    expect((await post(body({ cart: [{ id: product.id, quantity: 1, price: 9000 }] }))).status).toBe(200);
  });

  it('producto desactivado → 409 SIN_STOCK', async () => {
    const ok = await createProduct({ price: 1000 });
    const off = await createProduct({ price: 700, unit: 'atado', available: false });
    const payload = body({ cart: [{ id: ok.id, quantity: 1, price: 1000 }, { id: off.id, quantity: 1, price: 700 }] });
    const response = await post(payload);
    expect(response.status).toBe(409);
    expect(await readJson(response)).toEqual({
      error: `Se quedaron sin stock: ${off.name}. Sacalos del carrito para seguir.`,
      code: 'SIN_STOCK',
      unavailableIds: [off.id],
    });
    expect(await ordersWithKey(payload.idempotencyKey as string)).toBe(0);
  });

  it('producto borrado del catálogo → 409 SIN_STOCK', async () => {
    const gone = await createProduct({ price: 1000 });
    await prisma.product.delete({ where: { id: gone.id } });
    const response = await post(body({ cart: [{ id: gone.id, quantity: 1, price: 1000 }] }));
    expect(response.status).toBe(409);
    expect(await readJson(response)).toEqual({
      error: 'Un producto ya no está en el catálogo. Sacalos del carrito para seguir.',
      code: 'SIN_STOCK',
      unavailableIds: [gone.id],
    });
  });

  it('sin stock y borrados juntos: primero los sin stock, después los borrados', async () => {
    const off = await createProduct({ available: false });
    const response = await post(body({ cart: [{ id: 99_999_998, quantity: 1 }, { id: off.id, quantity: 1 }, { id: 99_999_999, quantity: 1 }] }));
    expect(response.status).toBe(409);
    const data = await readJson<{ error: string; unavailableIds: number[] }>(response);
    expect(data.unavailableIds).toEqual([off.id, 99_999_998, 99_999_999]);
    expect(data.error).toBe(`Se quedaron sin stock: ${off.name}. Algunos productos ya no están en el catálogo. Sacalos del carrito para seguir.`);
  });

  it('precio cambiado → 409 PRECIOS_CAMBIARON sin crear pedido; con el precio nuevo y la misma clave, entra', async () => {
    const product = await createProduct({ price: 1000 });
    const payload = body({ cart: [{ id: product.id, quantity: 2, price: 900 }] });
    const response = await post(payload);
    expect(response.status).toBe(409);
    expect(await readJson(response)).toEqual({
      error: 'Cambiaron algunos precios mientras armabas el pedido. Revisá el carrito antes de confirmar.',
      code: 'PRECIOS_CAMBIARON',
      priceChanges: [{ id: product.id, name: product.name, previousPrice: 900, currentPrice: 1000 }],
    });
    expect(await ordersWithKey(payload.idempotencyKey as string)).toBe(0);

    // La clave no quedó "gastada": el cliente acepta el precio nuevo y reintenta.
    const retry = await post({ ...payload, cart: [{ id: product.id, quantity: 2, price: 1000 }] });
    expect(retry.status).toBe(200);
    expect(await readJson(retry)).toMatchObject({ total: 2000 });
  });

  // Antes también frenaba con 409 cuando un precio BAJABA: fricción sin beneficio.
  it('precio que bajó (oferta nueva) → el pedido se crea con el precio menor y lo informa en priceDrops', async () => {
    const uva = await createProduct({ price: 3000, offerPrice: 2500 });
    const tomate = await createProduct({ price: 1000 });
    const payload = body({ cart: [{ id: uva.id, quantity: 2, price: 3000 }, { id: tomate.id, quantity: 1, price: 1000 }] });
    const response = await post(payload);
    expect(response.status).toBe(200);
    const data = await readJson<CheckoutResponse>(response);
    expect(data).toMatchObject({
      items: [expect.objectContaining({ id: uva.id, price: 2500, quantity: 2 }), expect.objectContaining({ id: tomate.id, price: 1000 })],
      subtotal: 6000,
      total: 6000,
      priceDrops: [{ id: uva.id, name: uva.name, previousPrice: 3000, currentPrice: 2500 }],
    });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: data.orderId } })).toMatchObject({ total: 6000 });

    // En un reintento no se vuelve a avisar: el pedido ya está creado.
    const retry = await readJson<CheckoutResponse>(await post(payload));
    expect(retry).toMatchObject({ orderId: data.orderId, yaExistia: true, priceDrops: [] });
  });

  // Una baja que deja el subtotal debajo del envío gratis haría cobrar MÁS de lo
  // que vio el cliente (se suma el envío): ahí se frena con 409 como una suba.
  it('una baja que hace perder el envío gratis → 409 (nunca se cobra más de lo que vio)', async () => {
    freezeTime(MONDAY_11AM);
    const bolson = await createProduct({ price: 20000, offerPrice: 19000, unit: 'unidad', category: 'Bolsones' });
    const payload = body({
      cart: [{ id: bolson.id, quantity: 1, price: 20000 }],
      deliveryMethod: 'delivery',
      deliverySlot: '2026-10-05T19',
    });
    const response = await post(payload);
    expect(response.status).toBe(409);
    expect(await readJson(response)).toMatchObject({
      code: 'PRECIOS_CAMBIARON',
      priceChanges: [{ id: bolson.id, previousPrice: 20000, currentPrice: 19000 }],
    });
    expect(await ordersWithKey(payload.idempotencyKey as string)).toBe(0);
  });

  it('una baja que deja el envío debajo del mínimo → 409 (no un 400 que deja al cliente trabado)', async () => {
    freezeTime(MONDAY_11AM);
    const caja = await createProduct({ price: 10000, offerPrice: 9000, unit: 'unidad' });
    const response = await post(body({
      cart: [{ id: caja.id, quantity: 1, price: 10000 }],
      deliveryMethod: 'delivery',
      deliverySlot: '2026-10-05T19',
    }));
    expect(response.status).toBe(409);
    expect(await readJson(response)).toMatchObject({ code: 'PRECIOS_CAMBIARON' });
  });

  it('uno subió y otro bajó → 409 con los dos cambios (el carrito queda con el total real), sin crear pedido', async () => {
    const sube = await createProduct({ price: 1100 });
    const baja = await createProduct({ price: 2000, offerPrice: 1500 });
    const payload = body({ cart: [{ id: sube.id, quantity: 1, price: 1000 }, { id: baja.id, quantity: 1, price: 2000 }] });
    const response = await post(payload);
    expect(response.status).toBe(409);
    expect(await readJson(response)).toEqual({
      error: 'Cambiaron algunos precios mientras armabas el pedido. Revisá el carrito antes de confirmar.',
      code: 'PRECIOS_CAMBIARON',
      priceChanges: [
        { id: sube.id, name: sube.name, previousPrice: 1000, currentPrice: 1100 },
        { id: baja.id, name: baja.name, previousPrice: 2000, currentPrice: 1500 },
      ],
    });
    expect(await ordersWithKey(payload.idempotencyKey as string)).toBe(0);
  });

  it('oferta que venció mientras el cliente armaba el carrito → 409 con el precio normal', async () => {
    const product = await createProduct({ price: 1000, offerPrice: 800, offerEndsAt: new Date(Date.now() - 60_000) });
    const response = await post(body({ cart: [{ id: product.id, quantity: 1, price: 800 }] }));
    expect(response.status).toBe(409);
    expect(await readJson(response)).toMatchObject({ priceChanges: [{ previousPrice: 800, currentPrice: 1000 }] });
  });
});

describeDb('POST /api/checkout: idempotencia', () => {
  it('reintento con la misma clave: devuelve el mismo pedido aunque el precio haya cambiado después', async () => {
    const product = await createProduct({ price: 1000 });
    const payload = body({ cart: [{ id: product.id, quantity: 1, price: 1000 }] });
    const first = await readJson<CheckoutResponse>(await post(payload));
    expect(first.yaExistia).toBeUndefined();

    await prisma.product.update({ where: { id: product.id }, data: { price: 2000 } });

    const retry = await post(payload);
    expect(retry.status).toBe(200);
    const second = await readJson<CheckoutResponse>(retry);
    // También la hora original: el aviso del retiro no cambia por reintentar más tarde.
    expect(second).toMatchObject({ orderId: first.orderId, total: 1000, items: first.items, yaExistia: true, createdAt: first.createdAt });

    // Aunque el carrito del reintento sea otro, la clave manda.
    const other = await readJson<CheckoutResponse>(await post({ ...payload, cart: [{ id: product.id, quantity: 9, price: 2000 }] }));
    expect(other.orderId).toBe(first.orderId);
    expect(await ordersWithKey(payload.idempotencyKey as string)).toBe(1);
  });

  it('reintento de un envío cuyo turno ya pasó: devuelve el pedido con el turno descripto por fecha', async () => {
    freezeTime(MONDAY_11AM);
    const product = await createProduct({ price: 10000, unit: 'unidad' });
    const payload = body({ cart: [{ id: product.id, quantity: 1, price: 10000 }], deliveryMethod: 'delivery', deliverySlot: '2026-10-05T13' });
    const first = await readJson<CheckoutResponse>(await post(payload));
    vi.setSystemTime(new Date('2026-10-05T20:00:00.000Z')); // 17:00, el turno de las 13 ya pasó
    const retry = await readJson<CheckoutResponse>(await post(payload));
    expect(retry).toMatchObject({ orderId: first.orderId, yaExistia: true, deliverySlot: { id: '2026-10-05T13', label: 'Lunes 5/10 de 13 a 14 h' } });
  });

  it('requests simultáneos con la misma clave → un solo pedido', async () => {
    const product = await createProduct({ price: 1000 });
    const payload = body({ cart: [{ id: product.id, quantity: 1, price: 1000 }] });
    const responses = await Promise.all(Array.from({ length: 6 }, () => post(payload)));
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200]);
    const ids = new Set((await Promise.all(responses.map((response) => readJson<CheckoutResponse>(response)))).map((data) => data.orderId));
    expect(ids.size).toBe(1);
    expect(await ordersWithKey(payload.idempotencyKey as string)).toBe(1);
  });

  it('carrera forzada: los dos pasan la lectura previa y el índice único decide (P2002)', async () => {
    const product = await createProduct({ price: 1000 });
    const payload = body({ cart: [{ id: product.id, quantity: 1, price: 1000 }] });
    const first = await readJson<CheckoutResponse>(await post(payload));

    // El segundo request "no ve" el pedido en la lectura previa, como si hubiera
    // llegado en el mismo milisegundo: el create choca con el índice único.
    const spy = vi.spyOn(prisma.order, 'findUnique').mockResolvedValueOnce(null as never);
    const second = await post(payload);
    expect(second.status).toBe(200);
    expect(await readJson(second)).toMatchObject({ orderId: first.orderId, yaExistia: true });
    expect(spy).toHaveBeenCalledTimes(2); // la lectura previa (mock) + la del ganador (real)
    expect(await ordersWithKey(payload.idempotencyKey as string)).toBe(1);
  });

  it('sin clave de idempotencia (o una corta) → 400', async () => {
    for (const idempotencyKey of [null, '', '1234', 'a'.repeat(101), 'con espacios y más de 16']) {
      const response = await post({ ...body({ cart: [{ id: 1, quantity: 1 }] }), idempotencyKey });
      expect(response.status, String(idempotencyKey)).toBe(400);
      expect(await readJson(response)).toEqual({ error: 'No pudimos identificar el pedido. Recargá la página y probá de nuevo.' });
    }
  });
});

describeDb('POST /api/checkout: cantidades y tipos raros', () => {
  it('cantidad como string → la línea se descarta; si era la única, 400', async () => {
    const product = await createProduct({ price: 1000 });
    const response = await post(body({ cart: [{ id: product.id, quantity: '2', price: 1000 }] }));
    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: 'No hay productos válidos en el carrito.' });
  });

  it('precio como string → no se compara: se cobra el del servidor', async () => {
    const product = await createProduct({ price: 1000 });
    const response = await post(body({ cart: [{ id: product.id, quantity: 1, price: '1' }] }));
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ total: 1000 });
  });

  it('id como string numérico se acepta', async () => {
    const product = await createProduct({ price: 1000 });
    const response = await post(body({ cart: [{ id: String(product.id), quantity: 1, price: 1000 }] }));
    expect(response.status).toBe(200);
  });

  it('cantidades negativas o 0 → 400 si no queda ninguna línea', async () => {
    const product = await createProduct({ price: 1000 });
    for (const quantity of [-1, 0, -0.05, null]) {
      const response = await post(body({ cart: [{ id: product.id, quantity, price: 1000 }] }));
      expect(response.status, String(quantity)).toBe(400);
    }
  });

  it('una línea con cantidad negativa se descarta y el resto del pedido entra', async () => {
    const a = await createProduct({ price: 1000 });
    const b = await createProduct({ price: 500 });
    const response = await post(body({ cart: [{ id: a.id, quantity: 1, price: 1000 }, { id: b.id, quantity: -3, price: 500 }] }));
    expect(response.status).toBe(200);
    const data = await readJson<CheckoutResponse>(response);
    expect(data.items.map((item) => item.id)).toEqual([a.id]);
    expect(data.total).toBe(1000);
  });

  it('cantidades enormes se recortan al tope por unidad', async () => {
    const kg = await createProduct({ price: 10, unit: 'kg' });
    const g = await createProduct({ price: 0.1, unit: 'g' });
    const response = await post(body({ cart: [{ id: kg.id, quantity: 1e9, price: 10 }, { id: g.id, quantity: 1e300, price: 0.1 }] }));
    expect(response.status).toBe(200);
    const data = await readJson<CheckoutResponse>(response);
    expect(data.items.map((item) => item.quantity)).toEqual([100, 50000]);
    expect(data.total).toBe(100 * 10 + 50000 * 0.1);
  });

  it('atado fraccionario → se redondea a entero y se cobra eso', async () => {
    const acelga = await createProduct({ price: 900, unit: 'atado' });
    const perejil = await createProduct({ price: 500, unit: 'atado' });
    const response = await post(body({ cart: [{ id: acelga.id, quantity: 1.5, price: 900 }, { id: perejil.id, quantity: 0.4, price: 500 }] }));
    expect(response.status).toBe(200);
    const data = await readJson<CheckoutResponse>(response);
    expect(data.items.map((item) => item.quantity)).toEqual([2, 1]);
    expect(data.total).toBe(2 * 900 + 500);
  });

  it('kilos: se redondean a 50 g', async () => {
    const product = await createProduct({ price: 1000, unit: 'kg' });
    const data = await readJson<CheckoutResponse>(await post(body({ cart: [{ id: product.id, quantity: 0.333, price: 1000 }] })));
    expect(data.items[0].quantity).toBe(0.35);
    expect(data.total).toBe(350);
  });

  it('carrito vacío, que no es lista, o con demasiadas líneas → 400', async () => {
    for (const cart of [[], {}, 'x', null, Array.from({ length: 61 }, (_, i) => ({ id: i + 1, quantity: 1 }))]) {
      const response = await post(body({ cart: cart as CartLine[] }));
      expect(response.status).toBe(400);
    }
  });

  it('carrito con basura (no objetos, ids inválidos) → 400 sin tocar la base', async () => {
    const response = await post(body({ cart: [null, 'x', 1, { id: -1, quantity: 1 }, { id: 'abc', quantity: 1 }] as unknown as CartLine[] }));
    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: 'No hay productos válidos en el carrito.' });
  });
});

describeDb('POST /api/checkout: turnos', () => {
  beforeEach(() => {
    freezeTime(MONDAY_11AM);
  });

  it('turno inválido → 400 TURNO_NO_DISPONIBLE con los turnos que quedan', async () => {
    const product = await createProduct({ price: 12000, unit: 'unidad' });
    const response = await post(body({ cart: [{ id: product.id, quantity: 1, price: 12000 }], deliveryMethod: 'delivery', deliverySlot: '2026-10-05T15' }));
    expect(response.status).toBe(400);
    const data = await readJson<{ error: string; code: string; availableSlots: Array<{ id: string }> }>(response);
    expect(data.code).toBe('TURNO_NO_DISPONIBLE');
    expect(data.error).toBe('El turno que elegiste ya no está disponible. Elegí otro.');
    expect(data.availableSlots.map((slot) => slot.id)).toEqual(['2026-10-05T13', '2026-10-05T19', '2026-10-06T13', '2026-10-06T19']);
  });

  it('turno que pasó (12:01 para el de las 13) → 400', async () => {
    vi.setSystemTime(new Date('2026-10-05T15:01:00.000Z'));
    const product = await createProduct({ price: 12000, unit: 'unidad' });
    const response = await post(body({ cart: [{ id: product.id, quantity: 1, price: 12000 }], deliveryMethod: 'delivery', deliverySlot: '2026-10-05T13' }));
    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({ code: 'TURNO_NO_DISPONIBLE', availableSlots: [{ id: '2026-10-05T19' }, {}, {}, {}] });
  });

  it('12:00 en punto todavía entra el de las 13', async () => {
    vi.setSystemTime(new Date('2026-10-05T15:00:00.000Z'));
    const product = await createProduct({ price: 12000, unit: 'unidad' });
    const response = await post(body({ cart: [{ id: product.id, quantity: 1, price: 12000 }], deliveryMethod: 'delivery', deliverySlot: '2026-10-05T13' }));
    expect(response.status).toBe(200);
  });

  it('turno de ayer, sin turno o de otro tipo → 400', async () => {
    const product = await createProduct({ price: 12000, unit: 'unidad' });
    const cases: Array<[unknown, string]> = [
      ['2026-10-04T19', 'El turno que elegiste ya no está disponible. Elegí otro.'],
      [undefined, 'Elegí un turno de entrega.'],
      ['', 'Elegí un turno de entrega.'],
      [{ id: '2026-10-05T13' }, 'El turno que elegiste ya no está disponible. Elegí otro.'],
    ];
    for (const [deliverySlot, message] of cases) {
      const response = await post(body({ cart: [{ id: product.id, quantity: 1, price: 12000 }], deliveryMethod: 'delivery', deliverySlot }));
      expect(response.status).toBe(400);
      expect((await readJson<{ error: string }>(response)).error).toBe(message);
    }
  });

  it('envío sin dirección → 400 (antes de mirar el turno)', async () => {
    const response = await post(body({ cart: [{ id: 1, quantity: 1 }], deliveryMethod: 'delivery', deliverySlot: '2026-10-05T13', customer: { customerAddress: '' } }));
    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: 'Para el envío necesitamos la dirección (calle, número y barrio).' });
  });
});

describeDb('POST /api/checkout: cuerpos inválidos', () => {
  it('body que no es JSON → 400', async () => {
    const response = await checkout(apiRequest('/api/checkout', { method: 'POST', rawBody: '{"cart": [', headers: { 'content-type': 'application/json' } }));
    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: 'El cuerpo del pedido no es JSON válido.' });
  });

  it('JSON que no es objeto (null, lista, número) → 400 de validación, no 500', async () => {
    for (const raw of ['null', '[]', '42', '"hola"']) {
      const response = await checkout(apiRequest('/api/checkout', { method: 'POST', rawBody: raw }));
      expect(response.status, raw).toBe(400);
    }
  });

  // Era un bug: sin Content-Length (Transfer-Encoding: chunked) se leía el
  // cuerpo entero antes de responder 413.
  it('cuerpo chunked de 20 MB → 413 sin leerlo entero', async () => {
    const CHUNK = 64 * 1024;
    let produced = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (produced >= 20 * 1024 * 1024) {
          controller.close();
          return;
        }
        produced += CHUNK;
        controller.enqueue(new Uint8Array(CHUNK).fill(0x20));
      },
    });
    const request = new Request('http://localhost/api/checkout', {
      method: 'POST',
      headers: { 'x-forwarded-for': nextIp(), 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    const response = await checkout(request);
    expect(response.status).toBe(413);
    expect(await readJson(response)).toEqual({ error: 'El cuerpo del pedido es demasiado grande.' });
    expect(produced).toBeLessThanOrEqual(100 * 1024 + 2 * CHUNK);
  });

  it('body gigante → 413 (por tamaño real y por Content-Length declarado)', async () => {
    const huge = JSON.stringify({ ...body({ cart: [{ id: 1, quantity: 1 }] }), customer: { ...CUSTOMER, notes: 'x'.repeat(200 * 1024) } });
    const byLength = await checkout(apiRequest('/api/checkout', { method: 'POST', rawBody: huge }));
    expect(byLength.status).toBe(413);
    expect(await readJson(byLength)).toEqual({ error: 'El cuerpo del pedido es demasiado grande.' });

    const declared = await checkout(apiRequest('/api/checkout', { method: 'POST', rawBody: '{}', headers: { 'content-length': String(50 * 1024 * 1024) } }));
    expect(declared.status).toBe(413);
  });

  it('datos del cliente o medio de pago inválidos → 400', async () => {
    expect((await post(body({ cart: [{ id: 1, quantity: 1 }], customer: { customerPhone: '123' } }))).status).toBe(400);
    expect((await post(body({ cart: [{ id: 1, quantity: 1 }], customer: { customerName: '' } }))).status).toBe(400);
    const card = await post(body({ cart: [{ id: 1, quantity: 1 }], paymentMethod: 'mercadopago' }));
    expect(card.status).toBe(400);
    expect(await readJson(card)).toEqual({ error: 'Elegí cómo vas a pagar: transferencia o efectivo.' });
  });

  it('un error de base no se filtra al cliente: 500 genérico', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(prisma.order, 'findUnique').mockRejectedValueOnce(new Error('relation "Order" does not exist (detalle interno)'));
    const response = await post(body({ cart: [{ id: 1, quantity: 1 }] }));
    expect(response.status).toBe(500);
    expect(await readJson(response)).toEqual({ error: 'No se pudo registrar el pedido. Probá de nuevo en un rato.' });
  });
});

describeDb('POST /api/checkout: textos largos', () => {
  it('notas de más de 500 caracteres se recortan', async () => {
    const product = await createProduct({ price: 1000 });
    const data = await readJson<CheckoutResponse>(await post(body({ cart: [{ id: product.id, quantity: 1, price: 1000 }], customer: { notes: 'n'.repeat(800) } })));
    expect((await prisma.order.findUniqueOrThrow({ where: { id: data.orderId } })).notes).toHaveLength(500);
  });

  // Era un bug: el corte partía el emoji, Prisma rechazaba el surrogate suelto y
  // el checkout daba 500 (y reintentar daba lo mismo). Ahora se corta entero.
  it('notas de 500+ caracteres con un emoji en el borde del corte: el pedido se crea', async () => {
    const product = await createProduct({ price: 1000 });
    const payload = body({ cart: [{ id: product.id, quantity: 1, price: 1000 }], customer: { notes: `${'a'.repeat(499)}🍅 y algo más` } });
    const response = await post(payload);
    // Se lee de la base ANTES de afirmar nada: además deja al motor de Prisma
    // limpio para el resto del archivo (ver setup.ts).
    const saved = await prisma.order.findFirst({ where: { idempotencyKey: payload.idempotencyKey as string } });
    expect(response.status).toBe(200);
    expect(saved?.notes?.isWellFormed()).toBe(true);
  });

  it('un surrogate suelto mandado a mano en el JSON tampoco rompe el checkout', async () => {
    const product = await createProduct({ price: 1000 });
    const payload = body({ cart: [{ id: product.id, quantity: 1, price: 1000 }], customer: { notes: 'hola \ud83d chau' } });
    expect((await post(payload)).status).toBe(200);
  });

  it('ids fuera del rango de la base o mal tipados no dan 500', async () => {
    for (const id of [3_000_000_000, true, [1], '0x1']) {
      const response = await post(body({ cart: [{ id, quantity: 1, price: 1000 }] }));
      expect(response.status, String(id)).toBe(400);
    }
  });
});

describeDb('POST /api/checkout: rate limit y topes de spam', () => {
  it(`más de ${RATE_LIMITS.checkout.limit} intentos en 10 minutos desde la misma IP → 429`, async () => {
    const ip = nextIp();
    // Bodies inválidos: el rate limit va antes que cualquier lectura de la base.
    for (let i = 0; i < RATE_LIMITS.checkout.limit; i += 1) {
      expect((await post({}, ip)).status).toBe(400);
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const limited = await post({}, ip);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await readJson(limited)).toEqual({ error: 'Estás haciendo muchos pedidos seguidos. Esperá unos minutos.' });
    // Otra IP no está afectada.
    expect((await post({})).status).toBe(400);
  });

  // Antes el cupo de 12 contaba todo: corregir el formulario o recibir un 409 de
  // precios gastaba lo mismo que un pedido real.
  it(`pedidos creados: más de ${RATE_LIMITS.checkoutCreate.limit} en 10 minutos desde la misma IP → 429; los intentos fallidos no cuentan`, async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ip = nextIp();
    const product = await createProduct({ price: 1000 });
    for (let i = 0; i < 5; i += 1) {
      expect((await post(body({ cart: [{ id: product.id, quantity: 1, price: 900 }] }), ip)).status).toBe(409);
    }
    for (let i = 0; i < RATE_LIMITS.checkoutCreate.limit; i += 1) {
      expect((await post(body({ cart: [{ id: product.id, quantity: 1, price: 1000 }] }), ip)).status).toBe(200);
    }
    const payload = body({ cart: [{ id: product.id, quantity: 1, price: 1000 }] });
    const limited = await post(payload, ip);
    expect(limited.status).toBe(429);
    expect(await readJson(limited)).toEqual({ error: 'Estás haciendo muchos pedidos seguidos. Esperá unos minutos.' });
    expect(await ordersWithKey(payload.idempotencyKey as string)).toBe(0);
  });

  it(`tope por teléfono: ${ORDER_CAPS.perPhone.limit} pedidos en 24 h → el siguiente 429 sin crear; los cancelados y los viejos no cuentan`, async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const product = await createProduct({ price: 1000 });
    const phone = uniquePhone();
    // El mismo número escrito de otra forma es el mismo teléfono.
    const spelled = `${phone.slice(0, 3)} ${phone.slice(3, 6)}-${phone.slice(6)}`;
    const ids: number[] = [];
    for (let i = 0; i < ORDER_CAPS.perPhone.limit; i += 1) {
      const response = await post(body({ cart: [{ id: product.id, quantity: 1, price: 1000 }], customer: { customerPhone: i % 2 ? spelled : phone } }));
      expect(response.status).toBe(200);
      ids.push((await readJson<CheckoutResponse>(response)).orderId);
    }

    const payload = body({ cart: [{ id: product.id, quantity: 1, price: 1000 }], customer: { customerPhone: phone } });
    const capped = await post(payload);
    expect(capped.status).toBe(429);
    expect(await readJson(capped)).toEqual({ error: 'Ya hiciste varios pedidos con este teléfono en las últimas 24 horas. Si necesitás otro, escribinos por WhatsApp.' });
    expect(await ordersWithKey(payload.idempotencyKey as string)).toBe(0);
    // Queda un evento de seguridad, sin el teléfono.
    const logged = vi.mocked(console.error).mock.calls.map(([line]) => String(line)).filter((line) => line.includes('"secEvent":"rate_limit"'));
    expect(logged.some((line) => line.includes('por teléfono'))).toBe(true);
    expect(logged.join('\n')).not.toContain(phone);

    // Otro teléfono, sin problema.
    expect((await post(body({ cart: [{ id: product.id, quantity: 1, price: 1000 }] }))).status).toBe(200);

    // Si el dueño cancela uno (por ejemplo, un pedido repetido), puede volver a pedir.
    await prisma.order.update({ where: { id: ids[0] }, data: { status: 'cancelled' } });
    expect((await post(payload)).status).toBe(200);

    // Los de hace más de 24 h no cuentan.
    await prisma.order.updateMany({ where: { customerPhone: phone }, data: { createdAt: new Date(Date.now() - ORDER_CAPS.perPhone.windowMs - 60_000) } });
    expect((await post(body({ cart: [{ id: product.id, quantity: 1, price: 1000 }], customer: { customerPhone: phone } }))).status).toBe(200);
  });

  it(`tope global: ${ORDER_CAPS.global.limit} pedidos en la última hora → 503 sin crear`, async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const product = await createProduct({ price: 1000 });
    const prefix = `tope-global-${Date.now()}-`;
    // Se cuenta igual que el checkout (sin los cancelados): si otro archivo de
    // tests dejó un cancelado de la última hora, faltaba uno para llegar al tope.
    const recent = await prisma.order.count({
      where: { createdAt: { gte: new Date(Date.now() - ORDER_CAPS.global.windowMs) }, status: { not: 'cancelled' } },
    });
    const missing = Math.max(0, ORDER_CAPS.global.limit - recent);
    await prisma.order.createMany({
      data: Array.from({ length: missing }, (_, i) => ({
        items: [],
        subtotal: 1000,
        shippingCost: 0,
        total: 1000,
        status: 'pending',
        deliveryMethod: 'pickup',
        customerPhone: `39900${String(i).padStart(5, '0')}`,
        idempotencyKey: `${prefix}${i}`,
      })),
    });
    try {
      const payload = body({ cart: [{ id: product.id, quantity: 1, price: 1000 }] });
      const response = await post(payload);
      expect(response.status).toBe(503);
      expect(response.headers.get('Retry-After')).toBe('300');
      expect(await readJson(response)).toEqual({ error: 'Estamos recibiendo demasiados pedidos. Probá en unos minutos o escribinos por WhatsApp.' });
      expect(await ordersWithKey(payload.idempotencyKey as string)).toBe(0);
      expect(vi.mocked(console.error).mock.calls.some(([line]) => String(line).includes('tope global'))).toBe(true);

      // Un reintento de un pedido que YA se creó sigue respondiendo (va antes de los topes).
      await prisma.order.deleteMany({ where: { idempotencyKey: `${prefix}0` } });
      const created = await readJson<CheckoutResponse>(await post(payload));
      expect(created.orderId).toEqual(expect.any(Number));
      expect(await post(body({ cart: [{ id: product.id, quantity: 1, price: 1000 }] }))).toHaveProperty('status', 503);
      expect(await readJson(await post(payload))).toMatchObject({ orderId: created.orderId, yaExistia: true });

      // Si el dueño cancela el spam desde el panel, la tienda vuelve a aceptar
      // pedidos al instante: el tope global no cuenta los cancelados.
      await prisma.order.updateMany({ where: { idempotencyKey: { startsWith: prefix } }, data: { status: 'cancelled' } });
      expect(await post(body({ cart: [{ id: product.id, quantity: 1, price: 1000 }] }))).toHaveProperty('status', 200);
    } finally {
      await prisma.order.deleteMany({ where: { idempotencyKey: { startsWith: prefix } } });
    }
  });
});

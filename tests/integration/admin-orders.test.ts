import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET as listOrders } from '@/app/api/gestion/orders/route';
import { GET as listOverdue } from '@/app/api/gestion/orders/atrasados/route';
import { DELETE as deleteOrderRoute, PUT as adjustOrderRoute } from '@/app/api/gestion/orders/[id]/route';
import { PUT as confirmRoute } from '@/app/api/gestion/orders/[id]/confirm/route';
import { PUT as cancelRoute } from '@/app/api/gestion/orders/[id]/cancel/route';
import { MAX_OVERDUE_ORDERS } from '@/lib/order-lifecycle';
import { getArgentinaParts } from '@/lib/store-hours';
import type { OrderRecord } from '@/lib/types';
import { adminCookie, apiRequest, createOrder, createProduct, describeDb, freezeTime, prisma, readJson, routeParams } from './helpers';

const confirm = (id: number | string) => confirmRoute(apiRequest(`/api/gestion/orders/${id}/confirm`, { method: 'PUT', cookie: adminCookie() }), routeParams(id));
const cancel = (id: number | string) => cancelRoute(apiRequest(`/api/gestion/orders/${id}/cancel`, { method: 'PUT', cookie: adminCookie() }), routeParams(id));
/** PUT con el cuerpo tal cual (para probar cuerpos inválidos y versiones viejas). */
const adjustRaw = (id: number | string, body: unknown) =>
  adjustOrderRoute(apiRequest(`/api/gestion/orders/${id}`, { method: 'PUT', body, cookie: adminCookie() }), routeParams(id));
/** Versión del pedido como la tiene el panel (OrderRecord.updatedAt). */
const versionOf = async (id: number) => (await prisma.order.findUniqueOrThrow({ where: { id } })).updatedAt.toISOString();
/** Ajuste desde un editor recién abierto: manda la versión actual del pedido. */
const adjust = async (id: number, items: unknown) => adjustRaw(id, { items, expectedUpdatedAt: await versionOf(id) });
const remove = (id: number | string) => deleteOrderRoute(apiRequest(`/api/gestion/orders/${id}`, { method: 'DELETE', cookie: adminCookie() }), routeParams(id));
const list = (query = '') => listOrders(apiRequest(`/api/gestion/orders${query}`, { cookie: adminCookie() }));
const idsOf = async (response: Response) => (await readJson<OrderRecord[]>(response)).map((order) => order.id);

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

const CHANGED = { error: 'El pedido cambió mientras lo editabas. Recargá para ver la última versión.' };

describeDb('GET /api/gestion/orders', () => {
  it('pedidos del día: los que entraron hoy y los que se entregan ese día', async () => {
    const today = getArgentinaParts().date;
    const createdToday = await createOrder({ idempotencyKey: `hoy-${Date.now()}-abcdefgh` });
    const forLater = await createOrder({ deliveryMethod: 'delivery', deliverySlot: '2031-01-15T13', customerAddress: 'Calle 1' });

    const todayIds = (await readJson<OrderRecord[]>(await list())).map((order) => order.id);
    expect(todayIds).toEqual(expect.arrayContaining([createdToday.id, forLater.id]));
    expect((await readJson<OrderRecord[]>(await list(`?date=${today}`))).map((order) => order.id)).toEqual(expect.arrayContaining([createdToday.id]));

    // Para el día del turno aparece solo el que se entrega ese día.
    const slotDay = await readJson<OrderRecord[]>(await list('?date=2031-01-15'));
    expect(slotDay.map((order) => order.id)).toEqual([forLater.id]);
    expect(slotDay[0]).toMatchObject({ deliverySlot: '2031-01-15T13', status: 'pending', deliveryMethod: 'delivery' });
  });

  it('nunca expone la clave de idempotencia ni columnas internas', async () => {
    const order = await createOrder({ idempotencyKey: `secreta-${Date.now()}-abcdefgh`, mpPaymentId: 'mp-123' });
    const body = JSON.stringify(await readJson(await list()));
    expect(body).toContain(`"id":${order.id}`);
    expect(body).not.toContain('secreta-');
    expect(body).not.toContain('idempotencyKey');
    expect(body).not.toContain('mp-123');
  });

  // Era un bug: la tienda promete que un retiro que entra después del corte se
  // prepara al día siguiente, pero el panel solo lo mostraba el día que entró.
  it('retiro del domingo a las 15 (el local cerró a las 14) aparece el lunes; el de la mañana, no', async () => {
    const sundayAfternoon = await createOrder({ deliveryMethod: 'pickup', createdAt: new Date('2026-10-04T18:00:00Z') }); // 15:00
    const sundayAtClose = await createOrder({ deliveryMethod: 'pickup', createdAt: new Date('2026-10-04T17:00:00Z') }); // 14:00 justo
    const sundayMorning = await createOrder({ deliveryMethod: 'pickup', createdAt: new Date('2026-10-04T13:00:00Z') }); // 10:00
    // Un envío del domingo a la tarde para el martes: aparece el martes (por el turno), no el lunes.
    const sundayDelivery = await createOrder({
      deliveryMethod: 'delivery',
      deliverySlot: '2026-10-06T13',
      customerAddress: 'Calle 1',
      createdAt: new Date('2026-10-04T18:00:00Z'),
    });
    try {
      const sunday = await idsOf(await list('?date=2026-10-04'));
      expect(sunday).toEqual(expect.arrayContaining([sundayAfternoon.id, sundayAtClose.id, sundayMorning.id, sundayDelivery.id]));

      const monday = await idsOf(await list('?date=2026-10-05'));
      expect(monday).toEqual(expect.arrayContaining([sundayAfternoon.id, sundayAtClose.id]));
      expect(monday).not.toContain(sundayMorning.id);
      expect(monday).not.toContain(sundayDelivery.id);

      const tuesday = await idsOf(await list('?date=2026-10-06'));
      expect(tuesday).toContain(sundayDelivery.id);
      expect(tuesday).not.toContain(sundayAfternoon.id);
    } finally {
      await prisma.order.deleteMany({ where: { id: { in: [sundayAfternoon.id, sundayAtClose.id, sundayMorning.id, sundayDelivery.id] } } });
    }
  });

  it('retiro del lunes desde las 19:00 aparece el martes; el de las 18:59, solo el lunes', async () => {
    const before = await createOrder({ deliveryMethod: 'pickup', createdAt: new Date('2026-10-05T21:59:00Z') }); // 18:59
    const atCutoff = await createOrder({ deliveryMethod: 'pickup', createdAt: new Date('2026-10-05T22:00:00Z') }); // 19:00
    const late = await createOrder({ deliveryMethod: 'pickup', paymentMethod: 'cash', createdAt: new Date('2026-10-05T23:30:00Z') }); // 20:30
    try {
      const tuesday = await idsOf(await list('?date=2026-10-06'));
      expect(tuesday).toEqual(expect.arrayContaining([atCutoff.id, late.id]));
      expect(tuesday).not.toContain(before.id);
      // El lunes siguen apareciendo los tres (entraron ese día).
      expect(await idsOf(await list('?date=2026-10-05'))).toEqual(expect.arrayContaining([before.id, atCutoff.id, late.id]));
    } finally {
      await prisma.order.deleteMany({ where: { id: { in: [before.id, atCutoff.id, late.id] } } });
    }
  });

  // Por rango de ids del día y no por igualdad contra las franjas actuales: si
  // algún día cambian los horarios, un envío tomado con la franja vieja tiene
  // que seguir apareciendo en su día (y no en otro).
  it('el turno se busca por rango del día: una franja vieja aparece en su día y la de otro día no', async () => {
    const real = await createOrder({ deliveryMethod: 'delivery', deliverySlot: '2031-02-20T19', customerAddress: 'Calle 1' });
    const oldWindow = await createOrder({ deliveryMethod: 'delivery', deliverySlot: '2031-02-20T15', customerAddress: 'Calle 1' });
    const otherDay = await createOrder({ deliveryMethod: 'delivery', deliverySlot: '2031-02-21T13', customerAddress: 'Calle 1' });
    try {
      const day = await idsOf(await list('?date=2031-02-20'));
      expect(day.sort()).toEqual([real.id, oldWindow.id].sort());
    } finally {
      await prisma.order.deleteMany({ where: { id: { in: [real.id, oldWindow.id, otherDay.id] } } });
    }
  });

  it('fecha inválida → 400', async () => {
    for (const query of ['?date=2026-02-30', '?date=hoy', '?date=2026-1-1', '?date=']) {
      const response = await list(query);
      expect(response.status, query).toBe(400);
      expect(await readJson(response)).toEqual({ error: 'Fecha inválida. Usá el formato AAAA-MM-DD.' });
    }
  });
});

describeDb('PUT /api/gestion/orders/[id]: ajuste con los pesos reales', () => {
  async function weightOrder(overrides: Parameters<typeof createOrder>[0] = {}) {
    const tomate = await createProduct({ price: 1000, unit: 'kg' });
    const acelga = await createProduct({ price: 900, unit: 'atado' });
    const order = await createOrder({
      items: [
        { id: tomate.id, name: tomate.name, price: 1000, quantity: 1.5, unit: 'kg' },
        { id: acelga.id, name: acelga.name, price: 900, quantity: 2, unit: 'atado' },
      ],
      shippingCost: 4000,
      deliveryMethod: 'delivery',
      ...overrides,
    });
    return { order, tomate, acelga };
  }

  it('respeta el precio guardado aunque el catálogo haya cambiado, y no toca el envío', async () => {
    const { order, tomate, acelga } = await weightOrder();
    await prisma.product.update({ where: { id: tomate.id }, data: { price: 5000 } });

    const response = await adjust(order.id, [{ id: tomate.id, quantity: 1.37 }, { id: acelga.id, quantity: 1 }]);
    expect(response.status).toBe(200);
    const record = await readJson<OrderRecord>(response);
    expect(record.items).toEqual([
      { id: tomate.id, name: tomate.name, price: 1000, quantity: 1.37, unit: 'kg' },
      { id: acelga.id, name: acelga.name, price: 900, quantity: 1, unit: 'atado' },
    ]);
    expect(record).toMatchObject({ id: order.id, subtotal: 2270, shippingCost: 4000, total: 6270, status: 'pending' });
    expect(record.adjustedAt).toEqual(expect.any(String));
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ subtotal: 2270, total: 6270 });
  });

  // Era un bug: el peso real se redondeaba a 50 g (11,237 kg → 11,25 kg).
  it('guarda el peso de la balanza (5 g), no el redondeo de 50 g del carrito', async () => {
    const { order, tomate } = await weightOrder();
    const record = await readJson<OrderRecord>(await adjust(order.id, [{ id: tomate.id, quantity: 11.237 }]));
    expect(record.items).toEqual([expect.objectContaining({ id: tomate.id, quantity: 11.235 })]);
    expect(record).toMatchObject({ subtotal: 11_235, total: 15_235 });
  });

  it('cantidad 0 saca el ítem; no se pueden agregar productos nuevos ni dejarlo vacío', async () => {
    const { order, tomate, acelga } = await weightOrder();
    const removed = await readJson<OrderRecord>(await adjust(order.id, [{ id: tomate.id, quantity: 0 }, { id: acelga.id, quantity: 2 }]));
    expect(removed.items.map((item) => item.id)).toEqual([acelga.id]);

    const intruder = await adjust(order.id, [{ id: acelga.id, quantity: 1 }, { id: 99_999_999, quantity: 1 }]);
    expect(intruder.status).toBe(400);
    expect(await readJson(intruder)).toEqual({ error: 'El producto 99999999 no estaba en el pedido. Solo se pueden ajustar los que pidió el cliente.' });

    const empty = await adjust(order.id, []);
    expect(empty.status).toBe(400);
    expect(await readJson(empty)).toEqual({ error: 'El pedido tiene que quedar con al menos un producto. Si no se lleva nada, cancelalo.' });
  });

  it('pedido pagado o cancelado → 409; "con problema" se puede ajustar', async () => {
    const paid = await weightOrder({ status: 'paid' });
    const response = await adjust(paid.order.id, [{ id: paid.tomate.id, quantity: 1 }]);
    expect(response.status).toBe(409);
    expect(await readJson(response)).toEqual({ error: 'El pedido ya figura como "Pagado". Solo se pueden ajustar pedidos pendientes.' });

    const cancelled = await weightOrder({ status: 'cancelled' });
    expect((await adjust(cancelled.order.id, [{ id: cancelled.tomate.id, quantity: 1 }])).status).toBe(409);

    const failed = await weightOrder({ status: 'failed' });
    expect((await adjust(failed.order.id, [{ id: failed.tomate.id, quantity: 1 }])).status).toBe(200);
  });

  // Era un bug: el servidor comparaba contra lo que él mismo acababa de leer, y
  // un editor abierto hacía rato pisaba en silencio el ajuste de otro dispositivo.
  it('editor viejo (otro dispositivo ajustó después de abrirlo) → 409 sin pisar nada; con la versión nueva, entra', async () => {
    const { order, tomate, acelga } = await weightOrder();
    const openedAt = order.updatedAt.toISOString();

    const other = await adjustRaw(order.id, { items: [{ id: tomate.id, quantity: 12 }, { id: acelga.id, quantity: 2 }], expectedUpdatedAt: openedAt });
    expect(other.status).toBe(200);
    const otherRecord = await readJson<OrderRecord>(other);

    const stale = await adjustRaw(order.id, { items: [{ id: tomate.id, quantity: 11.25 }, { id: acelga.id, quantity: 3 }], expectedUpdatedAt: openedAt });
    expect(stale.status).toBe(409);
    expect(await readJson(stale)).toEqual(CHANGED);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      items: [expect.objectContaining({ id: tomate.id, quantity: 12 }), expect.objectContaining({ id: acelga.id, quantity: 2 })],
      total: 12_000 + 1_800 + 4000,
    });

    // Recargó: con la versión que devolvió el otro ajuste, sí se guarda.
    const fresh = await adjustRaw(order.id, { items: [{ id: tomate.id, quantity: 11.25 }, { id: acelga.id, quantity: 3 }], expectedUpdatedAt: otherRecord.updatedAt });
    expect(fresh.status).toBe(200);
    expect(await readJson(fresh)).toMatchObject({ total: 11_250 + 2_700 + 4000 });
  });

  it('confirmado mientras el editor estaba abierto → 409 con el estado, sin tocar el pedido', async () => {
    const { order, tomate } = await weightOrder();
    const openedAt = order.updatedAt.toISOString();
    expect((await confirm(order.id)).status).toBe(200);
    const response = await adjustRaw(order.id, { items: [{ id: tomate.id, quantity: 1 }], expectedUpdatedAt: openedAt });
    expect(response.status).toBe(409);
    expect(await readJson(response)).toEqual({ error: 'El pedido ya figura como "Pagado". Solo se pueden ajustar pedidos pendientes.' });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ adjustedAt: null, status: 'paid' });
  });

  it('sin expectedUpdatedAt (o con basura) → 400, sin tocar el pedido', async () => {
    const { order, tomate } = await weightOrder();
    for (const expectedUpdatedAt of [undefined, null, 'ayer', 12345]) {
      const response = await adjustRaw(order.id, { items: [{ id: tomate.id, quantity: 1 }], expectedUpdatedAt });
      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({ error: 'Falta la versión del pedido que estabas editando. Recargá el panel y volvé a cargar los pesos.' });
    }
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).adjustedAt).toBeNull();
  });

  it('409 si el pedido cambió entre la lectura y la escritura (otra pestaña)', async () => {
    const { order, tomate } = await weightOrder();
    const realFindUnique = prisma.order.findUnique.bind(prisma.order);
    vi.spyOn(prisma.order, 'findUnique').mockImplementationOnce((async (args: Parameters<typeof realFindUnique>[0]) => {
      const snapshot = await realFindUnique(args);
      // Mientras el dueño cargaba los pesos, otra pestaña tocó el pedido.
      await new Promise((resolve) => setTimeout(resolve, 5));
      await prisma.order.update({ where: { id: order.id }, data: { notes: 'cambiado en otra pestaña' } });
      return snapshot;
    }) as never);

    const response = await adjust(order.id, [{ id: tomate.id, quantity: 1 }]);
    expect(response.status).toBe(409);
    expect(await readJson(response)).toEqual(CHANGED);
    // No se pisó nada.
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ adjustedAt: null, notes: 'cambiado en otra pestaña' });
  });

  it('body inválido → 400; inexistente → 404; id inválido → 400', async () => {
    const { order } = await weightOrder();
    const version = order.updatedAt.toISOString();
    expect((await adjustRaw(order.id, { items: 'x', expectedUpdatedAt: version })).status).toBe(400);
    expect((await adjustRaw(order.id, { items: [{ id: 1, quantity: -1 }], expectedUpdatedAt: version })).status).toBe(400);
    const broken = await adjustOrderRoute(apiRequest(`/api/gestion/orders/${order.id}`, { method: 'PUT', rawBody: '{', cookie: adminCookie() }), routeParams(order.id));
    expect(broken.status).toBe(400);
    const missing = await adjustRaw(99_999_999, { items: [{ id: 1, quantity: 1 }], expectedUpdatedAt: version });
    expect(missing.status).toBe(404);
    expect(await readJson(missing)).toEqual({ error: 'Pedido no encontrado.' });
    expect((await adjustRaw('abc', { items: [], expectedUpdatedAt: version })).status).toBe(400);
  });
});

describeDb('GET /api/gestion/orders/atrasados', () => {
  /**
   * "Hoy" simulado: jueves 15/1/2026 a las 12:00 de Córdoba. Es ANTERIOR a los
   * pedidos que crean los otros tests con la hora real, así que para esta fecha
   * están en el futuro y no se mezclan. Cada test borra lo que crea (el del cron
   * también usa enero de 2026).
   */
  const TODAY = '2026-01-15T15:00:00.000Z';
  const overdue = () => listOverdue(apiRequest('/api/gestion/orders/atrasados', { cookie: adminCookie() }));

  it('abiertos de días anteriores, del más viejo al más nuevo; sin los que se arman hoy o más adelante', async () => {
    freezeTime(TODAY);
    const orders = {
      pickupOld: await createOrder({ createdAt: new Date('2026-01-10T15:00:00Z') }),
      failedOld: await createOrder({ status: 'failed', createdAt: new Date('2026-01-11T15:00:00Z') }),
      // Envío en efectivo ya entregado (y pesado) que no se marcó pagado.
      cashDelivered: await createOrder({
        deliveryMethod: 'delivery',
        deliverySlot: '2026-01-13T13',
        customerAddress: 'Calle 1',
        paymentMethod: 'cash',
        adjustedAt: new Date('2026-01-13T15:00:00Z'),
        createdAt: new Date('2026-01-12T15:00:00Z'),
      }),
      pickupYesterdayMorning: await createOrder({ createdAt: new Date('2026-01-14T13:00:00Z') }), // miércoles 10:00
      // No van:
      pickupYesterdayLate: await createOrder({ createdAt: new Date('2026-01-14T23:30:00Z') }), // 20:30: se arma hoy
      deliveryToday: await createOrder({ deliveryMethod: 'delivery', deliverySlot: '2026-01-15T19', customerAddress: 'Calle 1', createdAt: new Date('2026-01-14T15:00:00Z') }),
      deliveryTomorrow: await createOrder({ deliveryMethod: 'delivery', deliverySlot: '2026-01-16T13', customerAddress: 'Calle 1', createdAt: new Date('2026-01-13T15:00:00Z') }),
      paidOld: await createOrder({ status: 'paid', createdAt: new Date('2026-01-09T15:00:00Z') }),
      cancelledOld: await createOrder({ status: 'cancelled', createdAt: new Date('2026-01-09T15:00:00Z') }),
      createdToday: await createOrder({ createdAt: new Date('2026-01-15T12:00:00Z') }),
    };
    try {
      const response = await overdue();
      expect(response.status).toBe(200);
      const records = await readJson<OrderRecord[]>(response);
      const mine = new Set(Object.values(orders).map((order) => order.id));
      expect(records.filter((record) => mine.has(record.id)).map((record) => record.id)).toEqual([
        orders.pickupOld.id,
        orders.failedOld.id,
        orders.cashDelivered.id,
        orders.pickupYesterdayMorning.id,
      ]);
      expect(records.find((record) => record.id === orders.cashDelivered.id)).toMatchObject({
        status: 'pending',
        paymentMethod: 'cash',
        deliverySlot: '2026-01-13T13',
        adjustedAt: '2026-01-13T15:00:00.000Z',
      });
      expect(JSON.stringify(records)).not.toContain('idempotencyKey');
    } finally {
      await prisma.order.deleteMany({ where: { id: { in: Object.values(orders).map((order) => order.id) } } });
    }
  });

  it(`hasta ${MAX_OVERDUE_ORDERS}, empezando por los más viejos`, async () => {
    freezeTime(TODAY);
    const prefix = `atrasado-${Date.now()}-`;
    await prisma.order.createMany({
      data: Array.from({ length: MAX_OVERDUE_ORDERS + 5 }, (_, i) => ({
        items: [],
        total: 1000,
        status: 'pending',
        deliveryMethod: 'pickup',
        idempotencyKey: `${prefix}${i}`,
        createdAt: new Date(Date.UTC(2025, 11, 1, 12, i)),
      })),
    });
    try {
      const records = await readJson<OrderRecord[]>(await overdue());
      expect(records).toHaveLength(MAX_OVERDUE_ORDERS);
      expect(records[0].createdAt).toBe('2025-12-01T12:00:00.000Z');
      const times = records.map((record) => Date.parse(record.createdAt ?? ''));
      expect(times).toEqual([...times].sort((a, b) => a - b));
    } finally {
      await prisma.order.deleteMany({ where: { idempotencyKey: { startsWith: prefix } } });
    }
  });

  it('sin sesión → 401', async () => {
    const response = await listOverdue(apiRequest('/api/gestion/orders/atrasados'));
    expect(response.status).toBe(401);
  });
});

describeDb('PUT /api/gestion/orders/[id]/confirm y /cancel', () => {
  it('confirmar un pendiente → pagado; confirmar de nuevo → 409', async () => {
    const order = await createOrder();
    const first = await confirm(order.id);
    expect(first.status).toBe(200);
    expect(await readJson(first)).toEqual({ message: 'Pedido confirmado.' });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('paid');

    const second = await confirm(order.id);
    expect(second.status).toBe(409);
    expect(await readJson(second)).toEqual({ error: 'El pedido ya figura como "Pagado".' });
    // Un pagado no se puede cancelar.
    const cancelPaid = await cancel(order.id);
    expect(cancelPaid.status).toBe(409);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('paid');
  });

  it('cancelar un pendiente; cancelar de nuevo → 409; un cancelado no se confirma', async () => {
    const order = await createOrder();
    expect(await readJson(await cancel(order.id))).toEqual({ message: 'Pedido cancelado.' });
    const again = await cancel(order.id);
    expect(again.status).toBe(409);
    expect(await readJson(again)).toEqual({ error: 'El pedido ya figura como "Cancelado".' });
    expect((await confirm(order.id)).status).toBe(409);
  });

  it('un pedido "con problema" se puede confirmar o cancelar a mano', async () => {
    expect((await confirm((await createOrder({ status: 'failed' })).id)).status).toBe(200);
    expect((await cancel((await createOrder({ status: 'failed' })).id)).status).toBe(200);
  });

  it('confirmar y cancelar a la vez: gana uno solo, el otro recibe 409', async () => {
    const order = await createOrder();
    const [confirmed, cancelled] = await Promise.all([confirm(order.id), cancel(order.id)]);
    expect([confirmed.status, cancelled.status].sort()).toEqual([200, 409]);
    const final = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status;
    expect(final).toBe(confirmed.status === 200 ? 'paid' : 'cancelled');
  });

  it('inexistente → 404; id inválido → 400', async () => {
    expect((await confirm(99_999_999)).status).toBe(404);
    expect((await cancel(99_999_999)).status).toBe(404);
    expect(await readJson(await confirm('abc'))).toEqual({ error: 'Id de pedido inválido.' });
    expect((await cancel('-1')).status).toBe(400);
  });
});

describeDb('DELETE /api/gestion/orders/[id]', () => {
  it('borra (204) y un segundo borrado da 404', async () => {
    const order = await createOrder();
    const first = await remove(order.id);
    expect(first.status).toBe(204);
    expect(await prisma.order.findUnique({ where: { id: order.id } })).toBeNull();
    const second = await remove(order.id);
    expect(second.status).toBe(404);
    expect(await readJson(second)).toEqual({ error: 'Pedido no encontrado.' });
    expect((await remove('0')).status).toBe(400);
  });
});

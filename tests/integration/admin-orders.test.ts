import { beforeEach, expect, it, vi } from 'vitest';
import { GET as listOrders } from '@/app/api/gestion/orders/route';
import { DELETE as deleteOrderRoute, PUT as adjustOrderRoute } from '@/app/api/gestion/orders/[id]/route';
import { PUT as confirmRoute } from '@/app/api/gestion/orders/[id]/confirm/route';
import { PUT as cancelRoute } from '@/app/api/gestion/orders/[id]/cancel/route';
import { getArgentinaParts } from '@/lib/store-hours';
import type { OrderRecord } from '@/lib/types';
import { adminCookie, apiRequest, createOrder, createProduct, describeDb, prisma, readJson, routeParams } from './helpers';

const confirm = (id: number | string) => confirmRoute(apiRequest(`/api/gestion/orders/${id}/confirm`, { method: 'PUT', cookie: adminCookie() }), routeParams(id));
const cancel = (id: number | string) => cancelRoute(apiRequest(`/api/gestion/orders/${id}/cancel`, { method: 'PUT', cookie: adminCookie() }), routeParams(id));
const adjust = (id: number | string, body: unknown) =>
  adjustOrderRoute(apiRequest(`/api/gestion/orders/${id}`, { method: 'PUT', body, cookie: adminCookie() }), routeParams(id));
const remove = (id: number | string) => deleteOrderRoute(apiRequest(`/api/gestion/orders/${id}`, { method: 'DELETE', cookie: adminCookie() }), routeParams(id));
const list = (query = '') => listOrders(apiRequest(`/api/gestion/orders${query}`, { cookie: adminCookie() }));

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

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

    const response = await adjust(order.id, { items: [{ id: tomate.id, quantity: 1.37 }, { id: acelga.id, quantity: 1 }] });
    expect(response.status).toBe(200);
    const record = await readJson<OrderRecord>(response);
    expect(record.items).toEqual([
      { id: tomate.id, name: tomate.name, price: 1000, quantity: 1.35, unit: 'kg' },
      { id: acelga.id, name: acelga.name, price: 900, quantity: 1, unit: 'atado' },
    ]);
    expect(record).toMatchObject({ id: order.id, subtotal: 2250, shippingCost: 4000, total: 6250, status: 'pending' });
    expect(record.adjustedAt).toEqual(expect.any(String));
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ subtotal: 2250, total: 6250 });
  });

  it('cantidad 0 saca el ítem; no se pueden agregar productos nuevos ni dejarlo vacío', async () => {
    const { order, tomate, acelga } = await weightOrder();
    const removed = await readJson<OrderRecord>(await adjust(order.id, { items: [{ id: tomate.id, quantity: 0 }, { id: acelga.id, quantity: 2 }] }));
    expect(removed.items.map((item) => item.id)).toEqual([acelga.id]);

    const intruder = await adjust(order.id, { items: [{ id: acelga.id, quantity: 1 }, { id: 99_999_999, quantity: 1 }] });
    expect(intruder.status).toBe(400);
    expect(await readJson(intruder)).toEqual({ error: 'El producto 99999999 no estaba en el pedido. Solo se pueden ajustar los que pidió el cliente.' });

    const empty = await adjust(order.id, { items: [] });
    expect(empty.status).toBe(400);
    expect(await readJson(empty)).toEqual({ error: 'El pedido tiene que quedar con al menos un producto. Si no se lleva nada, cancelalo.' });
  });

  it('pedido pagado o cancelado → 409; "con problema" se puede ajustar', async () => {
    const paid = await weightOrder({ status: 'paid' });
    const response = await adjust(paid.order.id, { items: [{ id: paid.tomate.id, quantity: 1 }] });
    expect(response.status).toBe(409);
    expect(await readJson(response)).toEqual({ error: 'El pedido ya figura como "Pagado". Solo se pueden ajustar pedidos pendientes.' });

    const cancelled = await weightOrder({ status: 'cancelled' });
    expect((await adjust(cancelled.order.id, { items: [{ id: cancelled.tomate.id, quantity: 1 }] })).status).toBe(409);

    const failed = await weightOrder({ status: 'failed' });
    expect((await adjust(failed.order.id, { items: [{ id: failed.tomate.id, quantity: 1 }] })).status).toBe(200);
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

    const response = await adjust(order.id, { items: [{ id: tomate.id, quantity: 1 }] });
    expect(response.status).toBe(409);
    expect(await readJson(response)).toEqual({ error: 'El pedido cambió mientras lo editabas. Recargá y volvé a cargar los pesos.' });
    // No se pisó nada.
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ adjustedAt: null, notes: 'cambiado en otra pestaña' });
  });

  it('body inválido → 400; inexistente → 404; id inválido → 400', async () => {
    const { order } = await weightOrder();
    expect((await adjust(order.id, { items: 'x' })).status).toBe(400);
    expect((await adjust(order.id, { items: [{ id: 1, quantity: -1 }] })).status).toBe(400);
    const broken = await adjustOrderRoute(apiRequest(`/api/gestion/orders/${order.id}`, { method: 'PUT', rawBody: '{', cookie: adminCookie() }), routeParams(order.id));
    expect(broken.status).toBe(400);
    const missing = await adjust(99_999_999, { items: [{ id: 1, quantity: 1 }] });
    expect(missing.status).toBe(404);
    expect(await readJson(missing)).toEqual({ error: 'Pedido no encontrado.' });
    expect((await adjust('abc', { items: [] })).status).toBe(400);
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

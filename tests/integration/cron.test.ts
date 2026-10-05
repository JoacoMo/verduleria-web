import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET as cleanup } from '@/app/api/cron/limpiar-pedidos/route';
import { apiRequest, createOrder, describeDb, freezeTime, prisma, readJson } from './helpers';

/**
 * Fecha simulada: 15/1/2026. Es ANTERIOR a cualquier pedido real que creen los
 * otros tests (con la hora de verdad), así la limpieza solo puede tocar los
 * pedidos que arma este archivo con fechas relativas a este "hoy".
 */
const FAKE_NOW = new Date('2026-01-15T12:00:00.000Z');
const daysAgo = (days: number) => new Date(FAKE_NOW.getTime() - days * 24 * 60 * 60 * 1000);

const callCron = (authorization?: string) =>
  cleanup(apiRequest('/api/cron/limpiar-pedidos', { headers: authorization === undefined ? {} : { authorization } }));

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describeDb('GET /api/cron/limpiar-pedidos: autorización', () => {
  it('sin Authorization, con otro secreto o mal formado → 401 sin tocar nada', async () => {
    const order = await createOrder({ createdAt: new Date('2000-01-01T00:00:00Z') });
    const secret = process.env.CRON_SECRET!;
    for (const header of [undefined, '', secret, `Bearer ${secret}x`, `bearer ${secret}`, `Bearer  ${secret}`, 'Bearer otro-secreto']) {
      const response = await callCron(header);
      expect(response.status, String(header)).toBe(401);
      expect(await readJson(response)).toEqual({ error: 'No autorizado.' });
    }
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('pending');
    // Cada intento queda registrado como evento de seguridad (sin el secreto).
    const logged = vi.mocked(console.error).mock.calls.map(([line]) => String(line));
    expect(logged.some((line) => line.includes('"secEvent":"cron_no_autorizado"'))).toBe(true);
    expect(logged.join('\n')).not.toContain(secret);
    await prisma.order.delete({ where: { id: order.id } });
  });

  it('sin CRON_SECRET configurado la limpieza no corre (500), ni siquiera con "Bearer "', async () => {
    vi.stubEnv('CRON_SECRET', '');
    for (const header of [undefined, 'Bearer ', 'Bearer undefined']) {
      const response = await callCron(header);
      expect(response.status).toBe(500);
      expect(await readJson(response)).toEqual({ error: 'La limpieza no está configurada.' });
    }
  });
});

describeDb('GET /api/cron/limpiar-pedidos: limpieza en una fecha simulada', () => {
  it('cancela pendientes de más de 7 días y borra cerrados de más de 90; los pagados no se tocan', async () => {
    freezeTime(FAKE_NOW.toISOString());
    const pendingOld = await createOrder({ status: 'pending', createdAt: daysAgo(8) });
    const pendingEdge = await createOrder({ status: 'pending', createdAt: daysAgo(7) }); // justo 7 días: no es "más de"
    const pendingRecent = await createOrder({ status: 'pending', createdAt: daysAgo(5) });
    const failedRecent = await createOrder({ status: 'failed', createdAt: daysAgo(10) });
    const paidAncient = await createOrder({ status: 'paid', createdAt: daysAgo(400) });
    const cancelledOld = await createOrder({ status: 'cancelled', createdAt: daysAgo(91) });
    const failedOld = await createOrder({ status: 'failed', createdAt: daysAgo(97) });
    const cancelledRecent = await createOrder({ status: 'cancelled', createdAt: daysAgo(75) });
    // Un pendiente de hace 100 días: se cancela y, en la misma corrida, se borra.
    const pendingAncient = await createOrder({ status: 'pending', createdAt: daysAgo(100) });

    // Pedidos "reales" de los otros tests: para esta fecha simulada están en el futuro.
    const othersBefore = await prisma.order.findMany({ where: { createdAt: { gt: FAKE_NOW } }, select: { id: true, status: true }, orderBy: { id: 'asc' } });

    const response = await callCron(`Bearer ${process.env.CRON_SECRET}`);
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ pendientesCancelados: 2, pedidosBorrados: 3 });

    const statusOf = async (id: number) => (await prisma.order.findUnique({ where: { id } }))?.status ?? 'borrado';
    expect(await statusOf(pendingOld.id)).toBe('cancelled');
    expect(await statusOf(pendingEdge.id)).toBe('pending');
    expect(await statusOf(pendingRecent.id)).toBe('pending');
    expect(await statusOf(failedRecent.id)).toBe('failed');
    expect(await statusOf(paidAncient.id)).toBe('paid');
    expect(await statusOf(cancelledOld.id)).toBe('borrado');
    expect(await statusOf(failedOld.id)).toBe('borrado');
    expect(await statusOf(cancelledRecent.id)).toBe('cancelled');
    expect(await statusOf(pendingAncient.id)).toBe('borrado');

    // El resumen sale por console.info en una línea JSON (Vercel lo indexa).
    expect(JSON.parse(String(vi.mocked(console.info).mock.calls.at(-1)?.[0]))).toMatchObject({
      cron: 'limpiar-pedidos',
      pendientesCancelados: 2,
      pedidosBorrados: 3,
    });

    // Correrla de nuevo el mismo día no hace nada más.
    expect(await readJson(await callCron(`Bearer ${process.env.CRON_SECRET}`))).toEqual({ pendientesCancelados: 0, pedidosBorrados: 0 });

    // Los pedidos de los otros tests siguen exactamente igual.
    expect(await prisma.order.findMany({ where: { createdAt: { gt: FAKE_NOW } }, select: { id: true, status: true }, orderBy: { id: 'asc' } })).toEqual(othersBefore);

    await prisma.order.deleteMany({ where: { id: { in: [pendingOld.id, pendingEdge.id, pendingRecent.id, failedRecent.id, paidAncient.id, cancelledRecent.id] } } });
  });

  it('un error de base → 500 genérico', async () => {
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('conexión caída'));
    const response = await callCron(`Bearer ${process.env.CRON_SECRET}`);
    expect(response.status).toBe(500);
    expect(await readJson(response)).toEqual({ error: 'No se pudieron limpiar los pedidos.' });
  });
});

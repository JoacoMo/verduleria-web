import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET as cleanup } from '@/app/api/cron/limpiar-pedidos/route';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { apiRequest, createOrder, describeDb, freezeTime, nextIp, prisma, readJson } from './helpers';

/**
 * Fecha simulada: 15/1/2026. Es ANTERIOR a cualquier pedido real que creen los
 * otros tests (con la hora de verdad), así la limpieza solo puede tocar los
 * pedidos que arma este archivo con fechas relativas a este "hoy".
 */
const FAKE_NOW = new Date('2026-01-15T12:00:00.000Z');
const daysAgo = (days: number) => new Date(FAKE_NOW.getTime() - days * 24 * 60 * 60 * 1000);

const callCron = (authorization?: string, ip?: string) =>
  cleanup(apiRequest('/api/cron/limpiar-pedidos', { headers: authorization === undefined ? {} : { authorization }, ip }));

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

  it(`rate limit ANTES de comparar el secreto: más de ${RATE_LIMITS.cron.limit} intentos desde la misma IP → 429 aunque traiga el correcto`, async () => {
    const ip = nextIp();
    for (let i = 0; i < RATE_LIMITS.cron.limit; i += 1) {
      expect((await callCron(`Bearer adivinando-${i}`, ip)).status).toBe(401);
    }
    const limited = await callCron(`Bearer ${process.env.CRON_SECRET}`, ip);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    // Una línea por cliente por minuto, no una por intento (log flooding).
    const logged = vi.mocked(console.error).mock.calls.map(([line]) => String(line)).filter((line) => line.includes(ip));
    expect(logged.filter((line) => line.includes('"secEvent":"cron_no_autorizado"'))).toHaveLength(1);
    expect(logged.filter((line) => line.includes('"secEvent":"rate_limit"'))).toHaveLength(1);
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
  it('cancela abiertos de más de 7 días salvo efectivo o ya pesados; borra solo cancelados de hace más de 90 días (por updatedAt); los pagados no se tocan', async () => {
    freezeTime(FAKE_NOW.toISOString());
    const at = (days: number) => ({ createdAt: daysAgo(days), updatedAt: daysAgo(days) });
    const orders = {
      // Se cancelan: transferencia (o sin medio de pago, pedidos viejos) sin pesar.
      transferOld: await createOrder({ status: 'pending', paymentMethod: 'transfer', ...at(8) }),
      legacyNoMethod: await createOrder({ status: 'pending', paymentMethod: null, ...at(8) }),
      // Con link de Mercado Pago (época anterior): pudo pagarse sin que llegue el aviso.
      mercadoPagoOld: await createOrder({ status: 'pending', paymentMethod: null, mpPreferenceId: 'pref-vieja', ...at(30) }),
      mercadoPagoFailed: await createOrder({ status: 'failed', paymentMethod: null, mpPreferenceId: 'pref-fallida', ...at(30) }),
      failedOld: await createOrder({ status: 'failed', paymentMethod: 'transfer', ...at(10) }),
      // Un pendiente de hace 120 días se cancela, pero NO se borra en la misma corrida.
      pendingAncient: await createOrder({ status: 'pending', ...at(120) }),
      // No se tocan todavía.
      pendingEdge: await createOrder({ status: 'pending', ...at(7) }), // justo 7 días: no es "más de"
      pendingRecent: await createOrder({ status: 'pending', ...at(5) }),
      // En efectivo o ya pesado: casi seguro se entregó y falta "Confirmar pago".
      cashOld: await createOrder({ status: 'pending', paymentMethod: 'cash', ...at(8) }),
      cashAdjusted: await createOrder({
        status: 'pending',
        paymentMethod: 'cash',
        deliveryMethod: 'delivery',
        deliverySlot: '2026-01-07T13',
        customerAddress: 'Calle 1',
        adjustedAt: daysAgo(8),
        ...at(8),
      }),
      transferAdjusted: await createOrder({ status: 'pending', paymentMethod: 'transfer', adjustedAt: daysAgo(30), ...at(30) }),
      // Un 'failed' viejo ya no se borra estando abierto (antes sí, a los 90 días).
      failedCashAncient: await createOrder({ status: 'failed', paymentMethod: 'cash', ...at(97) }),
      paidAncient: await createOrder({ status: 'paid', ...at(400) }),
      // Cancelados: cuenta desde que se cancelaron, no desde que se crearon.
      cancelledLongAgo: await createOrder({ status: 'cancelled', createdAt: daysAgo(120), updatedAt: daysAgo(91) }),
      cancelledRecently: await createOrder({ status: 'cancelled', createdAt: daysAgo(120), updatedAt: daysAgo(10) }),
    };
    const ids = Object.values(orders).map((order) => order.id);

    // Pedidos "reales" de los otros tests: para esta fecha simulada están en el futuro.
    const othersWhere = { createdAt: { gt: FAKE_NOW }, id: { notIn: ids } };
    const othersBefore = await prisma.order.findMany({ where: othersWhere, select: { id: true, status: true }, orderBy: { id: 'asc' } });

    const response = await callCron(`Bearer ${process.env.CRON_SECRET}`);
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ pendientesCancelados: 4, pedidosBorrados: 1 });

    const stateOf = async (id: number) => {
      const order = await prisma.order.findUnique({ where: { id } });
      return order ? order.status : 'borrado';
    };
    const states = async () => Object.fromEntries(await Promise.all(Object.entries(orders).map(async ([name, order]) => [name, await stateOf(order.id)])));
    expect(await states()).toEqual({
      transferOld: 'cancelled',
      legacyNoMethod: 'cancelled',
      mercadoPagoOld: 'pending',
      mercadoPagoFailed: 'failed',
      failedOld: 'cancelled',
      pendingAncient: 'cancelled',
      pendingEdge: 'pending',
      pendingRecent: 'pending',
      cashOld: 'pending',
      cashAdjusted: 'pending',
      transferAdjusted: 'pending',
      failedCashAncient: 'failed',
      paidAncient: 'paid',
      cancelledLongAgo: 'borrado',
      cancelledRecently: 'cancelled',
    });
    // Los 90 días hasta el borrado se cuentan desde la cancelación.
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orders.pendingAncient.id } })).updatedAt).toEqual(FAKE_NOW);

    // El resumen sale por console.info en una línea JSON (Vercel lo indexa).
    expect(JSON.parse(String(vi.mocked(console.info).mock.calls.at(-1)?.[0]))).toMatchObject({
      cron: 'limpiar-pedidos',
      pendientesCancelados: 4,
      pedidosBorrados: 1,
    });

    // Correrla de nuevo el mismo día no hace nada más.
    expect(await readJson(await callCron(`Bearer ${process.env.CRON_SECRET}`))).toEqual({ pendientesCancelados: 0, pedidosBorrados: 0 });

    // 91 días después: se borran los que se cancelaron en la primera corrida y
    // el cancelado hace 10 días; se cancelan los de transferencia que quedaban.
    vi.setSystemTime(new Date(FAKE_NOW.getTime() + 91 * 24 * 60 * 60 * 1000));
    expect(await readJson(await callCron(`Bearer ${process.env.CRON_SECRET}`))).toEqual({ pendientesCancelados: 2, pedidosBorrados: 5 });
    expect(await states()).toEqual({
      transferOld: 'borrado',
      legacyNoMethod: 'borrado',
      mercadoPagoOld: 'pending',
      mercadoPagoFailed: 'failed',
      failedOld: 'borrado',
      pendingAncient: 'borrado',
      pendingEdge: 'cancelled',
      pendingRecent: 'cancelled',
      cashOld: 'pending',
      cashAdjusted: 'pending',
      transferAdjusted: 'pending',
      failedCashAncient: 'failed',
      paidAncient: 'paid',
      cancelledLongAgo: 'borrado',
      cancelledRecently: 'borrado',
    });

    // Los pedidos de los otros tests siguen exactamente igual.
    expect(await prisma.order.findMany({ where: othersWhere, select: { id: true, status: true }, orderBy: { id: 'asc' } })).toEqual(othersBefore);

    await prisma.order.deleteMany({ where: { id: { in: ids } } });
  });

  it('un error de base → 500 genérico', async () => {
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('conexión caída'));
    const response = await callCron(`Bearer ${process.env.CRON_SECRET}`);
    expect(response.status).toBe(500);
    expect(await readJson(response)).toEqual({ error: 'No se pudieron limpiar los pedidos.' });
  });
});

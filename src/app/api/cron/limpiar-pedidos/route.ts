import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isExampleSecret, safeCompare } from '@/lib/auth';
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit';
import { logSecurityEvent } from '@/lib/security-log';
import { OPEN_ORDER_STATUSES, getCleanupCutoffs } from '@/lib/order-lifecycle';

export const runtime = 'nodejs';
// Nunca cachear: cada llamada tiene que tocar la base.
export const dynamic = 'force-dynamic';

const PATH = '/api/cron/limpiar-pedidos';

/**
 * Limpieza diaria de pedidos (la dispara Vercel Cron, ver vercel.json: todos
 * los días a las 09:00 UTC = 06:00 en Córdoba, antes de abrir; el plan Hobby de
 * Vercel solo permite crons diarios).
 *
 * - Los abiertos (pendientes o con problema) de más de 7 días
 *   (STALE_PENDING_DAYS) se cancelan: nadie va a pagar por transferencia un
 *   pedido de verdura de hace una semana, y así no ensucian el panel.
 *   EXCEPTO los que van en efectivo o ya tienen los pesos cargados: esos casi
 *   seguro se entregaron y el dueño no llegó a tocar "Confirmar pago". Cancelarlos
 *   (y borrarlos después) perdía el registro de una venta real; quedan en
 *   "Pendientes de días anteriores" del panel hasta que el dueño los resuelva.
 * - Los cancelados se borran a los 90 días (CLOSED_ORDER_RETENTION_DAYS) de
 *   cancelados, contados por updatedAt: no hay nada que cobrar ni reclamar, y
 *   tienen nombre, teléfono y dirección que no hace falta guardar para siempre.
 *   Lo que se cancela hoy queda 90 días visible: nunca se cancela y se borra en
 *   la misma corrida. Los 'failed' NO se borran: siguen abiertos (se pueden
 *   resolver a mano) y, si nadie los toca, primero se cancelan.
 * Los pagados no se tocan nunca.
 *
 * Vercel manda "Authorization: Bearer <CRON_SECRET>" solo si CRON_SECRET está
 * configurado en el proyecto. Sin secreto la ruta no hace nada: si no, cualquiera
 * que conozca la URL podría cancelar pedidos.
 */
export async function GET(request: Request) {
  // Antes de comparar el secreto: alguien probando secretos no puede hacer más
  // que unos pocos intentos (y no llena los logs, ver security-log.ts).
  const limited = enforceRateLimit(request, 'cron');
  if (limited) return limited;

  const secret = process.env.CRON_SECRET;
  if (!secret || isExampleSecret(secret)) {
    console.error(`Error en GET ${PATH}: falta CRON_SECRET o tiene un valor de ejemplo o de prueba publicado en el repo; no se corre la limpieza.`);
    return NextResponse.json({ error: 'La limpieza no está configurada.' }, { status: 500 });
  }

  // Comparación en tiempo constante: no filtra cuántos caracteres coinciden.
  const authorization = request.headers.get('authorization') ?? '';
  if (!safeCompare(authorization, `Bearer ${secret}`)) {
    logSecurityEvent('cron_no_autorizado', { ip: getClientIp(request), path: PATH, method: 'GET' });
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  try {
    const now = new Date();
    const { cancelStaleBefore, deleteCancelledBefore } = getCleanupCutoffs(now);

    // Primero se borran los cancelados viejos y DESPUÉS se cancelan los
    // abandonados: lo que se cancela en esta corrida no puede borrarse en ella
    // (además, su updatedAt pasa a ser ahora). Usan los índices
    // (status, updatedAt) y (status, createdAt).
    const [deleted, cancelled] = await prisma.$transaction([
      prisma.order.deleteMany({
        where: { status: 'cancelled', updatedAt: { lt: deleteCancelledBefore } },
      }),
      prisma.order.updateMany({
        where: {
          status: { in: [...OPEN_ORDER_STATUSES] },
          createdAt: { lt: cancelStaleBefore },
          // Ya pesado: el dueño lo armó, casi seguro se entregó.
          adjustedAt: null,
          // En efectivo: se cobra en la puerta o en el mostrador. Sin medio de
          // pago (pedidos de antes de que se guardara) se toma como transferencia.
          OR: [{ paymentMethod: null }, { paymentMethod: { not: 'cash' } }],
          // Con link de Mercado Pago (de cuando se cobraba por ahí): el cliente
          // pudo pagar aunque el pedido figure abierto, porque ya no llega el
          // aviso de MP. Esos los revisa y cierra el dueño a mano.
          mpPreferenceId: null,
        },
        // updatedAt explícito: desde acá se cuentan los 90 días hasta el borrado.
        data: { status: 'cancelled', updatedAt: now },
      }),
    ]);

    console.info(JSON.stringify({
      cron: 'limpiar-pedidos',
      ts: now.toISOString(),
      pendientesCancelados: cancelled.count,
      pedidosBorrados: deleted.count,
    }));

    return NextResponse.json({
      pendientesCancelados: cancelled.count,
      pedidosBorrados: deleted.count,
    });
  } catch (error) {
    console.error(`Error en GET ${PATH}:`, error);
    return NextResponse.json({ error: 'No se pudieron limpiar los pedidos.' }, { status: 500 });
  }
}

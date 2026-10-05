import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isExampleSecret, safeCompare } from '@/lib/auth';
import { getClientIp } from '@/lib/rate-limit';
import { logSecurityEvent } from '@/lib/security-log';
import { getCleanupCutoffs } from '@/lib/order-lifecycle';

export const runtime = 'nodejs';
// Nunca cachear: cada llamada tiene que tocar la base.
export const dynamic = 'force-dynamic';

const PATH = '/api/cron/limpiar-pedidos';

/**
 * Limpieza diaria de pedidos (la dispara Vercel Cron, ver vercel.json: todos
 * los días a las 09:00 UTC = 06:00 en Córdoba, antes de abrir; el plan Hobby de
 * Vercel solo permite crons diarios).
 *
 * - Los pendientes de más de 7 días (STALE_PENDING_DAYS) se cancelan: nadie va a
 *   pagar un pedido de verdura de hace una semana, y así no ensucian el panel.
 * - Los cancelados o con problema de más de 90 días (CLOSED_ORDER_RETENTION_DAYS)
 *   se borran: no hay nada que cobrar ni reclamar, y tienen nombre, teléfono y
 *   dirección de clientes que no hace falta guardar para siempre.
 * Los pagados no se tocan nunca.
 *
 * Vercel manda "Authorization: Bearer <CRON_SECRET>" solo si CRON_SECRET está
 * configurado en el proyecto. Sin secreto la ruta no hace nada: si no, cualquiera
 * que conozca la URL podría cancelar pedidos.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || isExampleSecret(secret)) {
    console.error(`Error en GET ${PATH}: falta CRON_SECRET o tiene el valor de ejemplo de .env.example, no se corre la limpieza.`);
    return NextResponse.json({ error: 'La limpieza no está configurada.' }, { status: 500 });
  }

  // Comparación en tiempo constante: no filtra cuántos caracteres coinciden.
  const authorization = request.headers.get('authorization') ?? '';
  if (!safeCompare(authorization, `Bearer ${secret}`)) {
    logSecurityEvent('cron_no_autorizado', { ip: getClientIp(request), path: PATH, method: 'GET' });
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  try {
    const { cancelPendingBefore, deleteClosedBefore } = getCleanupCutoffs();

    // Primero se cancelan los pendientes viejos y después se borran los cerrados
    // viejos. Las dos sentencias usan el índice (status, createdAt).
    const [cancelled, deleted] = await prisma.$transaction([
      prisma.order.updateMany({
        where: { status: 'pending', createdAt: { lt: cancelPendingBefore } },
        data: { status: 'cancelled' },
      }),
      prisma.order.deleteMany({
        where: { status: { in: ['cancelled', 'failed'] }, createdAt: { lt: deleteClosedBefore } },
      }),
    ]);

    console.info(JSON.stringify({
      cron: 'limpiar-pedidos',
      ts: new Date().toISOString(),
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

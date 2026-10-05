import 'server-only';
import { PrismaClient } from '@prisma/client';

/**
 * Cliente de Prisma, uno solo por proceso.
 *
 * Por qué el singleton: en desarrollo Next recarga los módulos en cada cambio y
 * cada recarga creaba un PrismaClient nuevo con su propio pool, hasta agotar
 * las conexiones de Supabase. Guardarlo en globalThis hace que sobreviva a esas
 * recargas. En producción cada instancia serverless evalúa el módulo una sola
 * vez, así que alcanza con la variable del módulo.
 *
 * Por qué `connection_limit=1` en DATABASE_URL (ver .env.example): en Vercel
 * puede haber muchas instancias a la vez y cada una abre su propio pool. Con
 * una conexión por instancia, el que multiplexa es Supavisor (el pooler de
 * Supabase en modo transacción), que es justamente para lo que está.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Códigos de error de Prisma que los handlers traducen a una respuesta:
 * P2002 = choque con un índice único, P2025 = el registro no existe.
 */
export function hasPrismaCode(error: unknown, code: 'P2002' | 'P2025') {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code;
}

import { afterAll, beforeAll } from 'vitest';

/**
 * Se corre antes de cada archivo de integración (setupFiles).
 *
 * 1. Freno de seguridad: el cliente de Prisma de la app lee DATABASE_URL, y si
 *    no coincide con TEST_DATABASE_URL (por ejemplo, Prisma tomó la del .env)
 *    los tests escribirían en otra base. Se corta antes de tocar nada.
 * 2. Al terminar el archivo se cierra la conexión, así Vitest no queda colgado.
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

beforeAll(() => {
  if (testDatabaseUrl && process.env.DATABASE_URL !== testDatabaseUrl) {
    throw new Error('DATABASE_URL no es TEST_DATABASE_URL: no se corren tests de integración contra otra base.');
  }
});

afterAll(async () => {
  if (!testDatabaseUrl) return;
  const { prisma } = await import('@/lib/prisma');
  try {
    await prisma.$disconnect();
  } catch (error) {
    // El motor de Prisma 6 re-lanza en $disconnect el último error de un
    // request con argumentos inválidos (ver el test del emoji en el checkout).
    // No es un fallo de ningún test: se avisa y se sigue.
    console.warn('[integración] prisma.$disconnect() falló:', (error as Error).message);
  }
});

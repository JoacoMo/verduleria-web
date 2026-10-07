import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { SEED_PRODUCTS } from './seed-data';

/**
 * Preparación de la base de integración, una vez por corrida:
 *
 * 1. Crea la base de TEST_DATABASE_URL si no existe (en CI ya la crea el
 *    servicio de Postgres con POSTGRES_DB).
 * 2. Se asegura de que existan los roles `anon` y `authenticated`: la migración
 *    de RLS les revoca permisos y falla si no están (en Supabase vienen de fábrica).
 * 3. Corre `prisma migrate deploy` con DATABASE_URL=TEST_DATABASE_URL: las mismas
 *    migraciones que producción, no un `db push`.
 * 4. Vacía las tablas y siembra un catálogo conocido (seed-data.ts).
 *
 * Sin TEST_DATABASE_URL no hace nada: los tests se saltean con un aviso.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function databaseNameOf(url: URL) {
  return decodeURIComponent(url.pathname.replace(/^\//, ''));
}

/**
 * Freno de seguridad: esta función TRUNCA tablas. Si alguien deja apuntando
 * TEST_DATABASE_URL a la base real (o a la de desarrollo), mejor cortar acá.
 */
function assertIsTestDatabase(name: string) {
  if (!/test/i.test(name)) {
    throw new Error(
      `TEST_DATABASE_URL apunta a la base "${name}". Por seguridad, la base de integración tiene que tener "test" en el nombre (ej. elpampa_test): los tests la vacían.`,
    );
  }
}

function quoteIdentifier(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

async function ensureDatabaseAndRoles(testUrl: URL) {
  const name = databaseNameOf(testUrl);
  const adminUrl = new URL(testUrl.toString());
  adminUrl.pathname = '/postgres';

  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    const existing = await admin.$queryRaw<Array<{ datname: string }>>`SELECT datname FROM pg_database WHERE datname = ${name}`;
    if (existing.length === 0) {
      // CREATE DATABASE no admite parámetros: el nombre ya pasó por assertIsTestDatabase y se cita.
      await admin.$executeRawUnsafe(`CREATE DATABASE ${quoteIdentifier(name)}`);
      console.info(`[integración] Base "${name}" creada.`);
    }

    // Los roles son del cluster, no de la base: se crean una sola vez.
    for (const role of ['anon', 'authenticated']) {
      const found = await admin.$queryRaw<Array<{ rolname: string }>>`SELECT rolname FROM pg_roles WHERE rolname = ${role}`;
      if (found.length === 0) {
        try {
          await admin.$executeRawUnsafe(`CREATE ROLE ${quoteIdentifier(role)} NOLOGIN`);
        } catch (error) {
          // Otro proceso lo creó a la vez, o el usuario no tiene CREATEROLE:
          // si de verdad falta, la migración de RLS lo va a decir claramente.
          console.warn(`[integración] No se pudo crear el rol ${role}:`, (error as Error).message);
        }
      }
    }
  } finally {
    await admin.$disconnect();
  }
}

function migrate(testUrl: string) {
  const prismaBin = `${ROOT}node_modules/.bin/prisma${process.platform === 'win32' ? '.cmd' : ''}`;
  if (!existsSync(prismaBin)) {
    throw new Error('No se encontró node_modules/.bin/prisma. Corré npm install.');
  }
  execFileSync(prismaBin, ['migrate', 'deploy'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: testUrl, DIRECT_URL: testUrl, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function resetAndSeed(testUrl: string) {
  const prisma = new PrismaClient({ datasourceUrl: testUrl });
  try {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Order", "Product" RESTART IDENTITY CASCADE');
    await prisma.product.createMany({ data: SEED_PRODUCTS });
  } finally {
    await prisma.$disconnect();
  }
}

export default async function setup() {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) {
    console.warn(
      '\n[integración] TEST_DATABASE_URL no está definida: se saltean los tests de integración.\n' +
        '  Ejemplo: TEST_DATABASE_URL="postgresql://postgres@localhost:5433/elpampa_test" npm run test:integration\n',
    );
    return;
  }

  const testUrl = new URL(raw);
  assertIsTestDatabase(databaseNameOf(testUrl));

  await ensureDatabaseAndRoles(testUrl);
  try {
    migrate(raw);
  } catch (error) {
    const output = error as { stdout?: Buffer; stderr?: Buffer };
    console.error(output.stdout?.toString(), output.stderr?.toString());
    throw new Error('Falló `prisma migrate deploy` contra la base de integración (ver salida arriba).');
  }
  await resetAndSeed(raw);
}

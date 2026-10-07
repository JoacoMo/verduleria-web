#!/usr/bin/env node
/**
 * Aplica las migraciones pendientes SOLO en el build de producción de Vercel.
 *
 * Por qué: antes las migraciones se aplicaban a mano y el código y el esquema
 * quedaban desacoplados (código nuevo contra una base sin migrar, o al revés).
 * Corriendo `prisma migrate deploy` en el mismo build que publica el código, la
 * base se migra justo antes de que el código nuevo empiece a recibir tráfico.
 * Las migraciones se escriben compatibles hacia atrás (agregan, no rompen), así
 * que el código viejo sigue andando durante los minutos del build.
 *
 * Si la migración falla, el build falla y Vercel deja en línea la versión
 * anterior: nunca queda código nuevo contra una base vieja. Por lo mismo, todo
 * lo dudoso corta el build (falla cerrado):
 * - Sin VERCEL_ENV pero con señales de ser Vercel (VERCEL=1, o el build corre en
 *   /vercel/...) o con DIRECT_URL en el entorno: no se sabe si es producción.
 *   Ojo: si en Vercel se apagan las variables de sistema desaparecen VERCEL y
 *   VERCEL_ENV juntas, por eso no alcanza con mirar VERCEL.
 * - Sin DIRECT_URL: las migraciones no pueden ir por el pooler en modo
 *   transacción de DATABASE_URL.
 * - Después de migrar se comprueba el esquema (scripts/verificar-esquema.sql)
 *   contra DATABASE_URL, la base que usa el código: `migrate deploy` no detecta
 *   una migración aplicada con otro contenido, ni que DIRECT_URL apunte a otra
 *   base, y en los dos casos el código nuevo daría 500.
 *
 * También avisa (sin cortar) si quedan funciones de public que la API pública
 * de Supabase puede ejecutar: Prisma no muestra los NOTICE de las migraciones.
 *
 * En los previews (ramas), en CI y en local NO se migra nada: un preview no puede
 * tocar la base de producción antes de que el cambio se apruebe. Un build local
 * con DIRECT_URL exportada corta; para seguir sin migrar: MIGRACIONES_EN_BUILD=no.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TAG = '[migraciones]';

function fail(lines) {
  for (const line of lines) console.error(`${TAG} ${line}`);
  process.exit(1);
}

const vercelEnv = process.env.VERCEL_ENV;

if (!vercelEnv) {
  const looksLikeVercel = process.env.VERCEL === '1' || process.cwd().startsWith('/vercel/');
  const hasDirectUrl = Boolean(process.env.DIRECT_URL);
  const skipAllowed = process.env.GITHUB_ACTIONS === 'true' || process.env.MIGRACIONES_EN_BUILD === 'no';
  if (looksLikeVercel || (hasDirectUrl && !skipAllowed)) {
    fail([
      'Falta VERCEL_ENV: no se puede saber si es el build de producción, así que se corta el build.',
      'En Vercel: Settings → Environment Variables → tildá "Automatically expose System Environment Variables".',
      'En un build local con DIRECT_URL exportada: sacala del entorno o corré con MIGRACIONES_EN_BUILD=no.',
    ]);
  }
}

if (vercelEnv !== 'production') {
  console.log(`${TAG} VERCEL_ENV=${vercelEnv ?? '(sin definir)'}: no se migra (solo en producción).`);
  process.exit(0);
}

if (!process.env.DIRECT_URL) {
  fail([
    'Falta DIRECT_URL en las variables de Production de Vercel: las migraciones la necesitan.',
    'Es la conexión de Supabase en modo "session" (Supabase → Connect → Session pooler, puerto 5432).',
    'Cargala en Vercel → Settings → Environment Variables (Production) y volvé a desplegar.',
  ]);
}
if (!process.env.DATABASE_URL) {
  fail(['Falta DATABASE_URL en las variables de Production de Vercel.']);
}

console.log(`${TAG} Build de producción: aplicando migraciones pendientes…`);
const migrate = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (migrate.status !== 0) {
  fail([
    'Falló `prisma migrate deploy`: se corta el build y queda en línea la versión anterior.',
    'El motivo está arriba. Para ver el estado, con DATABASE_URL y DIRECT_URL de producción: npx prisma migrate status',
    'Si una migración quedó marcada como fallida (error P3009 en los builds siguientes), corregí la causa y marcala',
    'como revertida para que el próximo deploy la vuelva a aplicar: npx prisma migrate resolve --rolled-back <nombre>',
  ]);
}

// Con el cliente de Prisma (lo generó `prisma generate` antes de este paso):
// usa DATABASE_URL, la misma conexión que el código, y la URL no queda en la
// línea de comandos.
console.log(`${TAG} Comprobando que la base que usa el código (DATABASE_URL) tenga el esquema que espera…`);
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
try {
  const schemaCheck = readFileSync(fileURLToPath(new URL('./verificar-esquema.sql', import.meta.url)), 'utf8');
  try {
    await prisma.$executeRawUnsafe(schemaCheck);
  } catch (error) {
    fail([
      `El esquema no es el que espera el código: ${error instanceof Error ? error.message.trim().split('\n').at(-1) : String(error)}`,
      'Se corta el build. Suele pasar si una migración se aplicó a mano con otro contenido, o si DIRECT_URL y',
      'DATABASE_URL apuntan a bases distintas (se migró una y el código usa la otra).',
    ]);
  }

  // Aviso, sin cortar: una función de public ejecutable por anon/authenticated
  // se puede llamar con la anon key por /rest/v1/rpc. La migración 20261007
  // cierra las propias, pero no puede tocar las de otro dueño.
  const exposed = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT p.oid::regprocedure::text AS firma
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.rolname IN ('anon', 'authenticated')
    WHERE n.nspname = 'public' AND has_function_privilege(r.oid, p.oid, 'EXECUTE')
    ORDER BY 1`);
  if (exposed.length > 0) {
    console.warn(`${TAG} ATENCIÓN: estas funciones de public las puede ejecutar la API pública de Supabase (anon/authenticated):`);
    for (const { firma } of exposed) console.warn(`${TAG}   - ${firma}`);
    console.warn(`${TAG} Si no las usa nadie desde afuera, revocales EXECUTE en Supabase (SQL editor, como su dueño).`);
  }
} finally {
  await prisma.$disconnect();
}
console.log(`${TAG} Listo.`);

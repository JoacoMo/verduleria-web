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
 * - En Vercel sin VERCEL_ENV: no se sabe si es producción.
 * - Sin DIRECT_URL: las migraciones no pueden ir por el pooler en modo
 *   transacción de DATABASE_URL.
 * - Después de migrar se comprueba el esquema (scripts/verificar-esquema.sql):
 *   `migrate deploy` no detecta una migración que se aplicó con otro contenido
 *   (por ejemplo una versión vieja), y ahí el código nuevo daría 500.
 *
 * En los previews (ramas) y en local NO se migra nada: un preview no puede
 * tocar la base de producción antes de que el cambio se apruebe.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TAG = '[migraciones]';

function run(args) {
  return spawnSync('npx', ['prisma', ...args], { stdio: 'inherit', shell: process.platform === 'win32' });
}

function fail(lines) {
  for (const line of lines) console.error(`${TAG} ${line}`);
  process.exit(1);
}

const vercelEnv = process.env.VERCEL_ENV;

if (process.env.VERCEL === '1' && !vercelEnv) {
  fail([
    'Build en Vercel sin VERCEL_ENV: no se puede saber si es producción, así que se corta el build.',
    'Revisá en Vercel → Settings → Environment Variables que esté tildado "Automatically expose System Environment Variables".',
  ]);
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

console.log(`${TAG} Build de producción: aplicando migraciones pendientes…`);
const migrate = run(['migrate', 'deploy']);
if (migrate.status !== 0) {
  fail([
    'Falló `prisma migrate deploy`: se corta el build y queda en línea la versión anterior.',
    'El motivo está arriba. Para ver el estado, con DATABASE_URL y DIRECT_URL de producción: npx prisma migrate status',
    'Si una migración quedó marcada como fallida (error P3009 en los builds siguientes), corregí la causa y marcala',
    'como revertida para que el próximo deploy la vuelva a aplicar: npx prisma migrate resolve --rolled-back <nombre>',
  ]);
}

console.log(`${TAG} Comprobando que el esquema sea el que espera el código…`);
const schemaCheck = fileURLToPath(new URL('./verificar-esquema.sql', import.meta.url));
// Con --schema la conexión sale de las variables de entorno (la URL, que lleva
// la contraseña, no queda en la línea de comandos).
const verify = run(['db', 'execute', '--schema', 'prisma/schema.prisma', '--file', schemaCheck]);
if (verify.status !== 0) {
  fail([
    'El esquema de la base no coincide con el que espera el código (el detalle está arriba): se corta el build.',
    'Suele pasar si alguna migración se aplicó a mano con otro contenido. No se publica nada hasta corregirlo.',
  ]);
}
console.log(`${TAG} Listo.`);

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
 * anterior: nunca queda código nuevo contra una base vieja.
 *
 * En los previews (ramas) y en local NO se migra nada: un preview no puede
 * tocar la base de producción antes de que el cambio se apruebe.
 */
import { spawnSync } from 'node:child_process';

if (process.env.VERCEL_ENV !== 'production') {
  console.log(`[migraciones] VERCEL_ENV=${process.env.VERCEL_ENV ?? '(sin definir)'}: no se migra (solo en producción).`);
  process.exit(0);
}

console.log('[migraciones] Build de producción: aplicando migraciones pendientes…');
const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (result.status !== 0) {
  console.error('[migraciones] Falló `prisma migrate deploy`: se corta el build para no publicar código contra una base sin migrar.');
  process.exit(result.status ?? 1);
}

#!/usr/bin/env node
/**
 * Control de fugas en el bundle del navegador.
 *
 * Después de `next build`, recorre .next/static/**\/*.js (lo único que se le
 * manda al navegador) y falla si encuentra:
 *
 * 1. El NOMBRE de una variable de entorno de servidor (JWT_SECRET, DATABASE_URL,
 *    ...). Si aparece, un módulo de servidor se coló en un componente cliente:
 *    aunque hoy el valor no viaje, es cuestión de tiempo.
 * 2. El VALOR de cualquiera de esas variables (y de otras sensibles) tal como
 *    está en process.env al correr el script, si tiene 8 caracteres o más
 *    (más corto daría falsos positivos: "admin", "1").
 * 3. Una cadena de conexión de Postgres con usuario y contraseña.
 *
 * Uso:
 *   node scripts/check-client-bundle.mjs              # revisa .next/static
 *   node scripts/check-client-bundle.mjs otra/carpeta # revisa otra carpeta
 *
 * En CI corre con las mismas variables (de prueba) con las que se hizo el build,
 * así un valor que se haya inyectado en el bundle se detecta. Nunca imprime los
 * valores: solo el nombre de la variable y el archivo.
 *
 * Sale con 0 si está limpio, 1 si encontró algo y 2 si no hay build que revisar.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

/** Variables que solo existen en el servidor: su nombre no puede aparecer en el navegador. */
const SERVER_ONLY_VARS = [
  'JWT_SECRET',
  'ADMIN_PASSWORD',
  'ADMIN_USERNAME',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'DIRECT_URL',
  'CRON_SECRET',
  'ADMIN_TOKEN_VERSION',
];

/** Además de las de arriba, variables cuyo VALOR tampoco puede viajar al navegador. */
const EXTRA_SECRET_VALUE_VARS = ['PEXELS_API_KEY', 'MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET'];

const MIN_SECRET_LENGTH = 8;

/** postgres://usuario:contraseña@host (o postgresql://). */
const POSTGRES_URL_WITH_PASSWORD = /postgres(?:ql)?:\/\/[^\s"'`/:@]+:[^\s"'`@]+@/i;

const root = resolve(process.cwd(), process.argv[2] ?? '.next/static');

async function listJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return listJsFiles(full);
      return /\.(?:m|c)?js$/.test(entry.name) ? [full] : [];
    }),
  );
  return nested.flat();
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Formas en las que un string puede quedar escrito dentro de un .js. */
function encodedForms(value) {
  const jsonEscaped = JSON.stringify(value).slice(1, -1);
  return [...new Set([value, jsonEscaped, encodeURIComponent(value)])];
}

function secretValues() {
  return [...SERVER_ONLY_VARS, ...EXTRA_SECRET_VALUE_VARS].flatMap((name) => {
    const value = process.env[name];
    if (!value || value.length < MIN_SECRET_LENGTH) return [];
    return [{ name, forms: encodedForms(value) }];
  });
}

async function main() {
  if (!existsSync(root)) {
    console.error(`No existe ${relative(process.cwd(), root) || root}: corré \`next build\` antes de revisar el bundle.`);
    process.exit(2);
  }

  const files = await listJsFiles(root);
  if (files.length === 0) {
    console.error(`No hay archivos .js en ${relative(process.cwd(), root)}: ¿el build terminó bien?`);
    process.exit(2);
  }

  const namePatterns = SERVER_ONLY_VARS.map((name) => ({ name, pattern: new RegExp(`\\b${escapeRegExp(name)}\\b`) }));
  const values = secretValues();
  const findings = [];

  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const where = relative(process.cwd(), file);

    for (const { name, pattern } of namePatterns) {
      if (pattern.test(content)) findings.push(`${where}: aparece el nombre de la variable de servidor ${name}`);
    }
    for (const { name, forms } of values) {
      if (forms.some((form) => content.includes(form))) findings.push(`${where}: aparece el VALOR de ${name}`);
    }
    if (POSTGRES_URL_WITH_PASSWORD.test(content)) {
      findings.push(`${where}: aparece una URL de Postgres con usuario y contraseña`);
    }
  }

  const checkedValues = values.map((value) => value.name);
  console.log(
    `Bundle del navegador: ${files.length} archivos .js revisados en ${relative(process.cwd(), root)}. ` +
      `Nombres buscados: ${SERVER_ONLY_VARS.length}. ` +
      `Valores buscados: ${checkedValues.length > 0 ? checkedValues.join(', ') : 'ninguno (no hay variables sensibles de 8+ caracteres en el entorno)'}.`,
  );

  if (findings.length > 0) {
    console.error(`\nSe encontraron ${findings.length} posibles fugas de datos de servidor en el bundle del navegador:`);
    for (const finding of findings) console.error(`  - ${finding}`);
    console.error('\nRevisá qué componente "use client" importa un módulo de servidor (src/lib/site.ts, auth.ts, prisma.ts, ...).');
    process.exit(1);
  }

  console.log('OK: no hay nombres ni valores de variables de servidor en el bundle del navegador.');
}

main().catch((error) => {
  console.error('Error revisando el bundle:', error);
  process.exit(2);
});

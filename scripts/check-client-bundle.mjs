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
 * 3. Una cadena de conexión de Postgres con usuario y contraseña, un JWT o una
 *    clave secreta de Supabase (patrones en scripts/secret-scan.mjs).
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
import { SERVER_ONLY_VARS, createSecretScanner } from './secret-scan.mjs';

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

  const scanner = createSecretScanner();
  const findings = [];

  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const where = relative(process.cwd(), file);
    for (const problem of scanner.scan(content)) findings.push(`${where}: ${problem}`);
  }

  const checkedValues = scanner.valueNames;
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

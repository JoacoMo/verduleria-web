#!/usr/bin/env node
/**
 * Control de fugas en lo que el servidor manda en cada request: el HTML de las
 * páginas, el payload RSC (las props que los Server Components le pasan a los
 * componentes del navegador) y las respuestas de la API, incluidas las de error.
 *
 * check-client-bundle.mjs revisa los .js del build, pero las páginas se arman
 * por request (la CSP con nonce obliga a force-dynamic): si un Server Component
 * le pasara por error siteConfig entero o un secreto como prop, solo se vería
 * acá. Es lo mismo que ve cualquiera con F12 → Network.
 *
 * Uso (después de `next build`, con las mismas variables de prueba):
 *   node scripts/check-rendered-pages.mjs                       # levanta `next start` en el puerto 3100
 *   node scripts/check-rendered-pages.mjs http://127.0.0.1:3000 # usa un servidor que ya está corriendo
 *
 * Busca lo mismo que el control del bundle (scripts/secret-scan.mjs). Nunca
 * imprime los valores. Sale con 0 si está limpio, 1 si encontró algo y 2 si no
 * pudo revisar (el servidor no levantó o no respondió).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SERVER_ONLY_VARS, createSecretScanner } from './secret-scan.mjs';

const PORT = 3100;
const PAGES = [
  '/', '/bolsones', '/ofertas', '/frutas', '/verduras', '/envios', '/terminos', '/privacidad',
  '/trastienda', '/trastienda/gestion', '/no-existe-esta-pagina',
];
const OTHER_GETS = [
  '/robots.txt', '/sitemap.xml', '/llms.txt', '/api/products', '/api/store-info',
  '/api/gestion/session', '/api/gestion/orders', '/api/gestion/orders/atrasados', '/api/cron/limpiar-pedidos',
];
// Errores a propósito: un mensaje de error es donde más fácil se cuela un detalle interno.
const POSTS = [
  { path: '/api/checkout', body: '{}' },
  { path: '/api/checkout', body: '{"cart":[{"id":999999,"quantity":1,"price":1}],"deliveryMethod":"pickup","paymentMethod":"cash","customer":{"customerName":"Prueba","customerPhone":"3510000000"},"idempotencyKey":"00000000-0000-4000-8000-000000000000"}' },
  { path: '/api/checkout', body: 'esto no es json' },
  { path: '/api/gestion/login', body: '{"username":"x","password":"y"}' },
];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitUntilUp(base, server) {
  for (let i = 0; i < 120; i += 1) {
    if (server && server.exitCode !== null) return false;
    try {
      const response = await fetch(`${base}/robots.txt`);
      if (response.ok) return true;
    } catch {
      // Todavía no levantó.
    }
    await sleep(500);
  }
  return false;
}

function startServer() {
  const nextBin = resolve('node_modules/next/dist/bin/next');
  if (!existsSync(resolve('.next/BUILD_ID'))) {
    console.error('No hay build: corré `next build` antes de revisar las páginas.');
    process.exit(2);
  }
  const server = spawn(process.execPath, [nextBin, 'start', '-p', String(PORT)], {
    env: process.env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return server;
}

async function main() {
  const external = process.argv[2];
  const base = (external ?? `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
  const server = external ? null : startServer();

  try {
    if (!(await waitUntilUp(base, server))) {
      console.error(`El servidor no respondió en ${base}: no se pudo revisar nada.`);
      process.exitCode = 2;
      return;
    }

    const scanner = createSecretScanner();
    const findings = [];
    const statuses = new Map();
    let checked = 0;

    async function check(label, request) {
      let response;
      try {
        response = await request();
      } catch (error) {
        findings.push(`${label}: no respondió (${error instanceof Error ? error.message : String(error)})`);
        return;
      }
      const body = await response.text();
      const headers = JSON.stringify([...response.headers.entries()]);
      checked += 1;
      statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
      for (const problem of scanner.scan(`${headers}\n${body}`)) findings.push(`${label} (${response.status}): ${problem}`);
    }

    for (const path of PAGES) {
      await check(`GET ${path}`, () => fetch(`${base}${path}`));
      // Lo mismo que pide el navegador al navegar entre páginas: el payload RSC.
      await check(`GET ${path} (RSC)`, () => fetch(`${base}${path}`, { headers: { RSC: '1' } }));
    }
    for (const path of OTHER_GETS) {
      await check(`GET ${path}`, () => fetch(`${base}${path}`));
    }
    for (const { path, body } of POSTS) {
      await check(`POST ${path}`, () => fetch(`${base}${path}`, {
        method: 'POST',
        // Sin Origin (como un pedido del mismo sitio): así llega al handler y se
        // revisan sus errores de verdad, no el 403 del middleware.
        headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body,
      }));
    }

    console.log(
      `Páginas y API: ${checked} respuestas revisadas en ${base} (HTML, RSC, JSON y headers; ` +
        `estados ${[...statuses].sort(([a], [b]) => a - b).map(([status, count]) => `${status}×${count}`).join(', ')}). ` +
        `Nombres buscados: ${SERVER_ONLY_VARS.length}. ` +
        `Valores buscados: ${scanner.valueNames.length > 0 ? scanner.valueNames.join(', ') : 'ninguno (no hay variables sensibles de 8+ caracteres en el entorno)'}.`,
    );

    if (findings.length > 0) {
      console.error(`\nSe encontraron ${findings.length} posibles fugas de datos de servidor en lo que se le manda al navegador:`);
      for (const finding of findings) console.error(`  - ${finding}`);
      console.error('\nRevisá qué props le pasa cada Server Component a los componentes del navegador y qué devuelve cada route handler.');
      process.exitCode = 1;
      return;
    }

    console.log('OK: ninguna página ni respuesta de la API trae nombres o valores de variables de servidor.');
  } finally {
    server?.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error('Error revisando las páginas:', error);
  process.exit(2);
});

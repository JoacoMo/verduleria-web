import { fileURLToPath } from 'node:url';

/**
 * Alias compartidos entre la config de tests unitarios (vitest.config.ts) y la
 * de integración (vitest.integration.config.ts).
 *
 * - '@/...'       → ./src (igual que tsconfig.json).
 * - 'server-only' → módulo vacío (el real tira fuera de un bundle de RSC).
 * - 'next/cache'  → unstable_cache passthrough + revalidateTag espía.
 */
const fromRoot = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

export const sharedAlias: Array<{ find: RegExp; replacement: string }> = [
  { find: /^@\//, replacement: `${fromRoot('src')}/` },
  { find: /^server-only$/, replacement: fromRoot('tests/mocks/server-only.ts') },
  { find: /^next\/cache$/, replacement: fromRoot('tests/mocks/next-cache.ts') },
];

/**
 * Datos del local fijos para que los tests no dependan del .env de quien los
 * corre (siteConfig lee estas variables al importarse).
 */
export const storeTestEnv: Record<string, string> = {
  STORE_NAME: 'El Pampa',
  STORE_ADDRESS: 'Rosario de Santa Fe 1211, Barrio General Paz, Córdoba Capital',
  STORE_NEIGHBORHOOD: 'Barrio General Paz',
  SITE_URL: 'https://elpampa.test',
  CONTACT_EMAIL: 'contacto@elpampa.test',
  TRANSFER_ALIAS: 'el.pampa.test',
  TRANSFER_CBU: '0000003100000000000001',
  WHATSAPP_NUMBER: '5493510000000',
  INSTAGRAM_URL: '',
  GOOGLE_REVIEW_URL: '',
  DELIVERY_FEE: '4000',
  DELIVERY_FREE_THRESHOLD: '20000',
  DELIVERY_MIN_PURCHASE: '10000',
  DELIVERY_MAX_WEIGHT_KG: '7',
  // Secretos de prueba (nunca los reales).
  JWT_SECRET: 'secreto-de-tests-con-mas-de-32-caracteres-para-jwt',
  ADMIN_USERNAME: 'admin-tests',
  ADMIN_PASSWORD: 'clave-de-tests',
  ADMIN_TOKEN_VERSION: '1',
  CRON_SECRET: 'cron-de-tests-0123456789',
  SUPABASE_URL: 'https://supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-de-tests',
  SUPABASE_STORAGE_BUCKET: 'product-images',
};

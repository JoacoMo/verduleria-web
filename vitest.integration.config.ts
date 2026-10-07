import { defineConfig } from 'vitest/config';
import { sharedAlias, storeTestEnv } from './tests/vitest.shared';

/**
 * Tests de INTEGRACIÓN (`npm run test:integration`): los route handlers de
 * src/app/api se llaman como funciones (POST(request), PUT(request, { params }))
 * contra un Postgres REAL con las migraciones aplicadas.
 *
 * La base sale de TEST_DATABASE_URL. Si no está, la globalSetup avisa y todos
 * los tests se saltean (no fallan): así `npm run test:integration` no rompe en
 * una máquina sin Postgres. En CI la variable siempre está.
 *
 * Ejemplo local:
 *   TEST_DATABASE_URL="postgresql://postgres@localhost:5433/elpampa_test" npm run test:integration
 *
 * Los archivos corren de a uno (fileParallelism: false): comparten la base y la
 * limpieza diaria (cron) toca pedidos de toda la tabla.
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export default defineConfig({
  resolve: { alias: sharedAlias },
  test: {
    name: 'integration',
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/integration/global-setup.ts'],
    setupFiles: ['tests/integration/setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    env: {
      ...storeTestEnv,
      // El cliente de Prisma de la app (src/lib/prisma.ts) lee DATABASE_URL.
      ...(testDatabaseUrl ? { DATABASE_URL: testDatabaseUrl, DIRECT_URL: testDatabaseUrl } : {}),
    },
  },
});

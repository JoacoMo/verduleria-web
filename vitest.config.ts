import { defineConfig } from 'vitest/config';
import { sharedAlias, storeTestEnv } from './tests/vitest.shared';

/**
 * Tests UNITARIOS (`npm test`): lógica pura de src/lib y de los componentes,
 * sin base ni red. Tienen que ser deterministas: la hora se fija con
 * vi.useFakeTimers / fechas explícitas, nunca con el reloj real.
 *
 * Los de integración (route handlers contra Postgres) van aparte:
 * vitest.integration.config.ts (`npm run test:integration`).
 */
export default defineConfig({
  resolve: { alias: sharedAlias },
  test: {
    name: 'unit',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**', 'tests/integration/**'],
    env: storeTestEnv,
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});

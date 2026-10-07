import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

/**
 * ESLint 9 (flat config) con las reglas de Next: core-web-vitals + typescript.
 * eslint-config-next 15 todavía se publica en formato "eslintrc", así que se
 * carga con FlatCompat.
 *
 * El estilo (comillas, punto y coma, sangría) no se controla acá: el repo no
 * usa Prettier y el lint se queda con errores reales (hooks, imports, tipos).
 */
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'scripts/precios/**',
      'next-env.d.ts',
      'tsconfig.tsbuildinfo',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Misma severidad que trae next/typescript (warn), pero sin avisar por las
      // variables descartadas a propósito con "_" (ej. `{ createdAt: _createdAt, ...rest }`
      // en src/app/api/products/route.ts).
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
  {
    // Scripts de Node sueltos en CommonJS (prisma/seed.js, scripts/*.js): usan
    // require() y next/typescript lo marca como error. Se baja a warning (no se
    // apaga) para que siga a la vista; pasarlos a ESM es una tarea aparte.
    files: ['scripts/**/*.js', 'prisma/**/*.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'warn',
    },
  },
];

export default eslintConfig;

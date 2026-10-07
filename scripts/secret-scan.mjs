/**
 * Búsqueda de datos de servidor en lo que se le manda al navegador. La usan
 * scripts/check-client-bundle.mjs (los .js del build) y
 * scripts/check-rendered-pages.mjs (HTML, payload RSC y respuestas de la API).
 *
 * Nunca devuelve ni imprime los valores encontrados: solo qué variable o qué
 * patrón apareció.
 */

/** Variables que solo existen en el servidor: su nombre no puede aparecer en el navegador. */
export const SERVER_ONLY_VARS = [
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

/** Más corto daría falsos positivos ("admin", "1"). */
const MIN_SECRET_LENGTH = 8;

/** Patrones que no deberían aparecer nunca, sea cual sea el valor de las variables. */
const FORBIDDEN_PATTERNS = [
  { what: 'una URL de Postgres con usuario y contraseña', pattern: /postgres(?:ql)?:\/\/[^\s"'`/:@]+:[^\s"'`@]+@/i },
  // Un token de sesión, una service role key o una anon key vieja de Supabase.
  { what: 'un JWT (token firmado)', pattern: /\beyJ[\w-]{8,}\.eyJ[\w-]{8,}\.[\w-]{10,}/ },
  { what: 'una clave secreta de Supabase (sb_secret_)', pattern: /\bsb_secret_[\w-]{10,}/ },
];

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Formas en las que un string puede quedar escrito dentro de un .js, un HTML o un JSON. */
function encodedForms(value) {
  const jsonEscaped = JSON.stringify(value).slice(1, -1);
  return [...new Set([value, jsonEscaped, encodeURIComponent(value)])];
}

/** Valores sensibles del entorno actual (los de prueba en CI), con sus formas codificadas. */
export function secretValues(env = process.env) {
  return [...SERVER_ONLY_VARS, ...EXTRA_SECRET_VALUE_VARS].flatMap((name) => {
    const value = env[name];
    if (!value || value.length < MIN_SECRET_LENGTH) return [];
    return [{ name, forms: encodedForms(value) }];
  });
}

/**
 * Arma un buscador para el entorno actual. `scan(texto)` devuelve la lista de
 * problemas encontrados en ese texto (vacía si está limpio).
 */
export function createSecretScanner({ checkNames = true, env = process.env } = {}) {
  const namePatterns = SERVER_ONLY_VARS.map((name) => ({ name, pattern: new RegExp(`\\b${escapeRegExp(name)}\\b`) }));
  const values = secretValues(env);
  return {
    valueNames: values.map((value) => value.name),
    scan(content) {
      const found = [];
      if (checkNames) {
        for (const { name, pattern } of namePatterns) {
          if (pattern.test(content)) found.push(`aparece el nombre de la variable de servidor ${name}`);
        }
      }
      for (const { name, forms } of values) {
        if (forms.some((form) => content.includes(form))) found.push(`aparece el VALOR de ${name}`);
      }
      for (const { what, pattern } of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) found.push(`aparece ${what}`);
      }
      return found;
    },
  };
}

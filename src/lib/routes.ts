/**
 * Rutas de la parte privada, en un solo lugar.
 *
 * Se renombraron de `/login` y `/panel` a algo no adivinable. Ojo con qué
 * espera esto de seguridad: NO es una medida de protección real, cualquiera que
 * mire el JavaScript del sitio las encuentra. Lo que sí hace, y por eso vale la
 * pena, es sacar al sitio del radar de los bots que barren `/admin`, `/login` y
 * `/wp-admin` a ciegas. Lo que realmente protege el panel sigue siendo el JWT,
 * el rate limiting y la contraseña.
 *
 * Justamente por eso estas rutas NO van en robots.txt: ese archivo es público y
 * listarlas ahí sería publicar exactamente lo que queremos que no se sepa. Se
 * bloquea la indexación con la metadata `noindex` de cada página.
 */

export const ADMIN_ROUTES = {
  /** Pantalla de ingreso. */
  login: '/trastienda',
  /** Panel de administración. */
  panel: '/trastienda/gestion',
} as const;

/** Prefijo de la API privada (antes `/api/admin`). */
export const ADMIN_API = '/api/gestion';

/** Rutas que nunca deben quedar cacheadas ni indexadas. */
export const PRIVATE_PATH_PREFIXES = [ADMIN_ROUTES.login, ADMIN_API];

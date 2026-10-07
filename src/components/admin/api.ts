/**
 * Cliente de la API del panel.
 *
 * La sesión viaja sola en la cookie httpOnly (same-origin), así que acá no hay
 * token ni header Authorization. Lo que sí centraliza este cliente:
 * - Cualquier 401 manda al login (sesión vencida o revocada), desde un solo lugar.
 * - Las respuestas se leen con tolerancia (un 204 sin cuerpo, un HTML de error
 *   de Vercel) y siempre devuelven un mensaje en castellano para mostrar inline.
 * - Nunca tira excepciones: un corte de red vuelve como un error más.
 */

export type ApiSuccess<T> = { ok: true; status: number; data: T };
export type ApiFailure = { ok: false; status: number; error: string; data: unknown };
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export const NETWORK_ERROR_MESSAGE = 'No se pudo conectar con el servidor. Revisá la conexión y probá de nuevo.';
const SESSION_EXPIRED_MESSAGE = 'Tu sesión venció. Volvé a iniciar sesión.';

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** El `error` que mandan los handlers, o el mensaje por defecto. */
export function errorFromBody(body: unknown, fallback: string) {
  if (body !== null && typeof body === 'object' && 'error' in body) {
    const { error } = body as { error?: unknown };
    if (typeof error === 'string' && error.trim()) return error;
  }
  return fallback;
}

/** Segundos de Retry-After de un 429, si vinieron. */
export function retryAfterSeconds(response: Response) {
  const value = Number(response.headers.get('Retry-After'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export type AdminClient = {
  get<T>(url: string, fallbackError: string): Promise<ApiResult<T>>;
  /** `body` puede ser un objeto (va como JSON) o un FormData (subida de imágenes). */
  send<T>(url: string, method: Exclude<Method, 'GET'>, body: unknown, fallbackError: string): Promise<ApiResult<T>>;
};

export function createAdminClient(onUnauthorized: () => void): AdminClient {
  async function request<T>(url: string, method: Method, body: unknown, fallbackError: string): Promise<ApiResult<T>> {
    const init: RequestInit = {
      method,
      // El panel siempre quiere el dato de este momento (pedidos que entran,
      // stock que cambia): nada de respuestas cacheadas por el navegador.
      cache: 'no-store',
      credentials: 'same-origin',
    };
    if (body instanceof FormData) {
      init.body = body;
    } else if (body !== undefined) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch {
      return { ok: false, status: 0, error: NETWORK_ERROR_MESSAGE, data: null };
    }

    const data = await readBody(response);

    if (response.status === 401) {
      onUnauthorized();
      return { ok: false, status: 401, error: errorFromBody(data, SESSION_EXPIRED_MESSAGE), data };
    }
    if (!response.ok) {
      return { ok: false, status: response.status, error: errorFromBody(data, fallbackError), data };
    }
    return { ok: true, status: response.status, data: data as T };
  }

  return {
    get: (url, fallbackError) => request(url, 'GET', undefined, fallbackError),
    send: (url, method, body, fallbackError) => request(url, method, body, fallbackError),
  };
}

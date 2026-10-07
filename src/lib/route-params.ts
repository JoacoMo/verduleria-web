import { sanitizeId } from './sanitize';

/**
 * Id de una ruta dinámica (/api/gestion/products/[id]).
 *
 * Antes se hacía `Number(id)`: con un id no numérico Prisma recibía NaN, y
 * "0x16" o "1e1" se convertían en otro id válido. Ahora solo se aceptan dígitos,
 * dentro del rango de un Int de Postgres (un id enorme también daba 500).
 */
export function parseNumericId(rawId: string) {
  return /^\d{1,10}$/.test(rawId) ? sanitizeId(rawId) : null;
}

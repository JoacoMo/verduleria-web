/**
 * Los handlers de rutas dinámicas hacían `Number(id)` sin validar: con un id no
 * numérico Prisma recibía NaN, explotaba y devolvíamos un 500 genérico. Esto lo
 * convierte en un 400 claro.
 */
export function parseNumericId(rawId: string) {
  const id = Number(rawId);

  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return id;
}

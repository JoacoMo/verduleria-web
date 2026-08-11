/**
 * Formato de precios en pesos argentinos: separador de miles con punto y sin
 * decimales cuando el monto es redondo (ej: $20.000 en vez de $20000.00).
 *
 * Se usa para los montos "de comunicación" (umbral de envío gratis, mínimos).
 * Los precios de cada producto siguen mostrándose con toFixed(2) en la grilla.
 */
const formatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatArs(amount: number) {
  return formatter.format(amount);
}

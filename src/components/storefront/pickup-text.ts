import { OPENING_WINDOWS, formatMinutes, pickupCutoffMinutes } from '@/lib/store-hours';

const DAY_PLURALS = ['los domingos', 'los lunes', 'los martes', 'los miércoles', 'los jueves', 'los viernes', 'los sábados'];

/** ["a", "b", "c"] → "a, b y c". */
function joinList(items: string[]) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

/**
 * La regla del corte de los retiros para los textos fijos (los que arma el
 * servidor o se ven antes de montar, cuando todavía no se sabe la hora):
 * "antes de las 19:00 (los domingos, antes de las 14:00)".
 *
 * Sale de store-hours (pickupCutoffMinutes), así nunca contradice el horario:
 * el domingo el local cierra a las 14 y un "antes de las 19:00" a secas mandaba
 * a la gente a buscar el pedido con el local cerrado. Los días sin horario no
 * se nombran.
 */
export function describePickupCutoffRule(): string {
  const daysByCutoff = new Map<number, number[]>();
  for (let day = 1; day <= 7; day += 1) {
    const dayIndex = day % 7; // lunes primero, domingo al final
    if ((OPENING_WINDOWS[dayIndex] ?? []).length === 0) continue;
    const cutoff = pickupCutoffMinutes(dayIndex);
    daysByCutoff.set(cutoff, [...(daysByCutoff.get(cutoff) ?? []), dayIndex]);
  }

  // El corte de la mayoría de los días va primero; los demás, entre paréntesis.
  const groups = [...daysByCutoff.entries()].sort((a, b) => b[1].length - a[1].length);
  if (groups.length === 0) return '';
  const [[mainCutoff], ...exceptions] = groups;
  const main = `antes de las ${formatMinutes(mainCutoff)}`;
  if (exceptions.length === 0) return main;

  const detail = exceptions
    .map(([cutoff, days]) => `${joinList(days.map((dayIndex) => DAY_PLURALS[dayIndex]))}, antes de las ${formatMinutes(cutoff)}`)
    .join('; ');
  return `${main} (${detail})`;
}

/** "antes de las 19:00 (los domingos, antes de las 14:00)" con los horarios actuales. */
export const PICKUP_CUTOFF_RULE = describePickupCutoffRule();

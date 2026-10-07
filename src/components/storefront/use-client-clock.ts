import { useEffect, useState } from 'react';

/**
 * Si el reloj del navegador difiere de la hora del servidor en más que esto, se
 * corrige. Por debajo es la demora normal entre el render del servidor y el
 * montaje (bajar el HTML y el JS en un celular con mala señal): no hay que
 * "corregirla".
 */
export const CLOCK_SKEW_TOLERANCE_MS = 2 * 60_000;

/**
 * Cuánto hay que sumarle a Date.now() para tener la hora del servidor: la
 * diferencia entre `renderedAt` (la hora con la que el servidor armó la página)
 * y la del navegador al montar, o 0 si están cerca (o si no hay renderedAt).
 */
export function computeClockOffset(
  renderedAt: number | undefined,
  clientTime: number,
  tolerance = CLOCK_SKEW_TOLERANCE_MS,
): number {
  if (renderedAt === undefined || !Number.isFinite(renderedAt) || !Number.isFinite(clientTime)) return 0;
  const skew = renderedAt - clientTime;
  return Math.abs(skew) > tolerance ? skew : 0;
}

/**
 * Corrección del reloj para este documento. Se calcula UNA vez, con la primera
 * página de la tienda que se monta, y se reusa en las navegaciones del lado del
 * cliente: al volver atrás, Next puede reusar el payload guardado de esa página
 * (con un renderedAt de hace un rato) y recalcular con eso correría el reloj.
 */
let documentClockOffset: number | null = null;

function calibrate(renderedAt: number | undefined) {
  if (documentClockOffset === null && renderedAt !== undefined) {
    documentClockOffset = computeClockOffset(renderedAt, Date.now());
  }
}

/**
 * La hora "buena" para usar fuera del render (en un handler): la del navegador
 * más la corrección, si hizo falta.
 */
export function correctedNow(): Date {
  return new Date(Date.now() + (documentClockOffset ?? 0));
}

/**
 * Hora del navegador (corregida con la del servidor si el reloj del celular está
 * corrido), actualizada cada minuto. Devuelve null hasta que el componente se
 * monta.
 *
 * Lo que depende de la hora exacta (turnos de entrega, "Abierto ahora") se
 * calcula SOLO en el cliente: si se calculara también en el servidor, el HTML y
 * el primer render del navegador podrían no coincidir y React rompe la
 * hidratación. El primer render usa la hora del servidor (renderedAt) y recién
 * después de montar pasa a esta.
 *
 * Con el reloj del celular corrido (horas o días), sin la corrección la tienda
 * ofrecía turnos que el servidor rechaza y, pasado el rato en que se usa la lista
 * del servidor, los volvía a ofrecer.
 *
 * Además se actualiza al volver a la pestaña: en el celular la página queda
 * horas en segundo plano y los intervalos se congelan, así que sin esto el
 * cliente volvería a ver turnos que ya pasaron.
 */
export function useClientClock(renderedAt?: number, intervalMs = 60_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    calibrate(renderedAt);
    const tick = () => setNow(correctedNow());
    tick();
    const interval = window.setInterval(tick, intervalMs);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [renderedAt, intervalMs]);

  return now;
}

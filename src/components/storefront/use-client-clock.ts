import { useEffect, useState } from 'react';

/**
 * Hora del navegador, actualizada cada minuto. Devuelve null hasta que el
 * componente se monta.
 *
 * Lo que depende de la hora exacta (turnos de entrega, "Abierto ahora") se
 * calcula SOLO en el cliente: si se calculara también en el servidor, el HTML y
 * el primer render del navegador podrían no coincidir y React rompe la
 * hidratación.
 *
 * Además se actualiza al volver a la pestaña: en el celular la página queda
 * horas en segundo plano y los intervalos se congelan, así que sin esto el
 * cliente volvería a ver turnos que ya pasaron.
 */
export function useClientClock(intervalMs = 60_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
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
  }, [intervalMs]);

  return now;
}

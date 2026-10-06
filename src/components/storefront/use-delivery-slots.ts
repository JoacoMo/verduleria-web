import { useCallback, useEffect, useMemo, useState } from 'react';
import { getUpcomingSlots, type DeliverySlot } from '@/lib/delivery-slots';
import { correctedNow } from './use-client-clock';

/** Cuántos turnos se le ofrecen al cliente. */
const SLOTS_TO_SHOW = 4;

/**
 * Si el servidor rechazó un turno, manda la lista que él considera válida. Se usa
 * esa durante un rato y después se vuelve a calcular en el navegador. Como el
 * reloj ya viene corregido con la hora del servidor (useClientClock), la lista
 * recalculada coincide con la del servidor aunque el celular tenga la hora mal.
 */
const SERVER_SLOTS_TTL_MS = 10 * 60_000;

/**
 * Turnos de entrega a domicilio.
 *
 * Se calculan solo en el cliente (clientNow es null en el servidor y en el primer
 * render) y se recalculan cada minuto: un turno de "Hoy de 13 a 14 h" deja de
 * ofrecerse una hora antes. Si el turno elegido desaparece de la lista, se
 * deselecciona y se avisa, para que nadie pida para un turno que ya pasó.
 */
export function useDeliverySlots(clientNow: Date | null) {
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [serverSlots, setServerSlots] = useState<{ slots: DeliverySlot[]; receivedAt: number } | null>(null);
  const [selectionExpired, setSelectionExpired] = useState(false);

  const computedSlots = useMemo(
    () => (clientNow ? getUpcomingSlots(clientNow, SLOTS_TO_SHOW) : null),
    [clientNow],
  );

  const serverListIsFresh = serverSlots !== null
    && clientNow !== null
    && clientNow.getTime() - serverSlots.receivedAt < SERVER_SLOTS_TTL_MS;
  const slots = serverListIsFresh ? serverSlots.slots : computedSlots;

  const selectedSlot = useMemo(
    () => (selectedSlotId && slots ? slots.find((slot) => slot.id === selectedSlotId) ?? null : null),
    [slots, selectedSlotId],
  );

  useEffect(() => {
    if (selectedSlotId && slots && !selectedSlot) {
      setSelectedSlotId(null);
      setSelectionExpired(true);
    }
  }, [slots, selectedSlotId, selectedSlot]);

  const selectSlot = useCallback((slotId: string) => {
    setSelectedSlotId(slotId);
    setSelectionExpired(false);
  }, []);

  /** Respuesta TURNO_NO_DISPONIBLE: se muestra la lista del servidor y se pide elegir de nuevo. */
  const replaceWithServerSlots = useCallback((availableSlots: DeliverySlot[]) => {
    // Con el mismo reloj que clientNow (corregido): con Date.now() a secas, un
    // celular atrasado horas daba la lista del servidor por vencida al instante.
    setServerSlots({ slots: availableSlots.slice(0, SLOTS_TO_SHOW), receivedAt: correctedNow().getTime() });
    setSelectedSlotId(null);
    setSelectionExpired(false);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedSlotId(null);
    setSelectionExpired(false);
  }, []);

  return {
    /** null mientras no se calcularon (antes de montar). */
    slots,
    selectedSlot,
    selectionExpired,
    /** Primer turno disponible, para "Próxima entrega". */
    nextSlot: slots?.[0] ?? null,
    selectSlot,
    replaceWithServerSlots,
    clearSelection,
  };
}

export type DeliverySlotsState = ReturnType<typeof useDeliverySlots>;

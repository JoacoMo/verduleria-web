import type { SyntheticEvent } from 'react';
import { getArgentinaParts } from '@/lib/store-hours';

export const PLACEHOLDER_IMAGE = '/product-placeholder.svg';

/** Si la foto de un producto no carga, se muestra el dibujo genérico (una sola vez). */
export function handleImageError(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget;
  if (!image.src.endsWith(PLACEHOLDER_IMAGE)) {
    image.src = PLACEHOLDER_IMAGE;
  }
}

export function pluralize(count: number, singular: string, plural: string) {
  return count === 1 ? singular : plural;
}

/**
 * Número de WhatsApp para mostrar: sin el 549 del formato internacional, que a
 * un cliente de acá le confunde ("351 765-6500" en vez de "5493517656500").
 */
export function formatPhoneForDisplay(whatsappNumber: string) {
  const local = whatsappNumber.replace(/\D/g, '').replace(/^549?/, '');
  if (local.length !== 10) return local;
  // Buenos Aires tiene característica de 2 dígitos; Córdoba y casi todo el
  // interior, de 3.
  return local.startsWith('11')
    ? `11 ${local.slice(2, 6)}-${local.slice(6)}`
    : `${local.slice(0, 3)} ${local.slice(3, 6)}-${local.slice(6)}`;
}

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/**
 * "Hasta el martes 6/10" para una oferta que vence.
 *
 * Se calcula siempre en hora argentina, así el servidor (que corre en UTC) y el
 * navegador escriben exactamente lo mismo y no se rompe la hidratación. Se le
 * resta un minuto al vencimiento porque "vence el 6/10" se guarda como el final
 * de ese día, y según cómo se guarde puede caer justo en las 00:00 del 7.
 */
export function formatOfferEnds(offerEndsAt: string | null): string | null {
  if (!offerEndsAt) return null;
  const endsAt = new Date(offerEndsAt);
  if (Number.isNaN(endsAt.getTime())) return null;
  const parts = getArgentinaParts(new Date(endsAt.getTime() - 60_000));
  const [, month, day] = parts.date.split('-').map(Number);
  return `Hasta el ${DAY_NAMES[parts.dayIndex] ?? ''} ${day}/${month}`;
}

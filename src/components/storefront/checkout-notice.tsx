'use client';

import { CalendarClock, CircleAlert, RefreshCw, X } from 'lucide-react';
import { WhatsAppIcon } from '@/components/brand-icons';
import { formatArs } from '@/lib/format-price';
import type { CartItem, CheckoutNotice } from './types';

type UnavailableItemsNoticeProps = {
  items: CartItem[];
  /** true si recién lo avisó el servidor al intentar confirmar. */
  justHappened: boolean;
  onRemove: (productId: number) => void;
};

/**
 * Productos del carrito que no se pueden pedir (sin stock o borrados), cada uno
 * con su botón para sacarlo ahí mismo, sin tener que volver al carrito.
 */
export function UnavailableItemsNotice({ items, justHappened, onRemove }: UnavailableItemsNoticeProps) {
  if (items.length === 0) return null;
  return (
    <div className="checkout-notice checkout-notice-warning" role="alert">
      <p className="checkout-notice-title">
        <CircleAlert size={18} aria-hidden="true" />
        {justHappened ? 'Se quedaron sin stock recién' : 'Hay productos sin stock'}
      </p>
      <ul className="checkout-notice-actions">
        {items.map((item) => (
          <li key={item.id}>
            <span>{item.name}</span>
            <button type="button" onClick={() => onRemove(item.id)} aria-label={`Sacar ${item.name} del carrito`}>
              <X size={16} aria-hidden="true" /> Sacar
            </button>
          </li>
        ))}
      </ul>
      <p>Sacalos del carrito para poder hacer el pedido.</p>
    </div>
  );
}

/**
 * Lo que pasó cuando el servidor no pudo registrar el pedido, en lenguaje claro y
 * con lo que hay que hacer. Va con role="alert" para que el lector de pantalla
 * lo lea apenas aparece. (Los productos sin stock los muestra UnavailableItemsNotice.)
 */
export default function CheckoutNoticeBox({ notice }: { notice: CheckoutNotice }) {
  if (notice.kind === 'unavailable') return null;

  if (notice.kind === 'price-changed') {
    return (
      <div className="checkout-notice" role="alert">
        <p className="checkout-notice-title">
          <RefreshCw size={18} aria-hidden="true" /> Cambiaron algunos precios mientras armabas el pedido
        </p>
        <ul>
          {notice.changes.map((change) => (
            <li key={change.id}>
              {change.name}: antes {formatArs(change.previousPrice)}, ahora <strong>{formatArs(change.currentPrice)}</strong>
            </li>
          ))}
        </ul>
        {/* Neutro a propósito: si con los precios nuevos el envío dejó de llegar
            al mínimo, el resumen ya lo marca y no hay que mandarlo a confirmar. */}
        <p>No registramos nada todavía: ya actualizamos el total, revisalo antes de confirmar.</p>
      </div>
    );
  }

  if (notice.kind === 'slot') {
    return (
      <div className="checkout-notice checkout-notice-warning" role="alert">
        <p className="checkout-notice-title">
          <CalendarClock size={18} aria-hidden="true" /> Ese turno ya no está disponible
        </p>
        <p>Actualizamos la lista de turnos: elegí otro y confirmá de nuevo.</p>
      </div>
    );
  }

  return (
    <div className="checkout-notice checkout-notice-warning" role="alert">
      <p className="checkout-notice-title">
        <CircleAlert size={18} aria-hidden="true" /> No pudimos registrar el pedido
      </p>
      <p>{notice.message}</p>
      {notice.contactUrl ? (
        <p>
          <a className="checkout-notice-link" href={notice.contactUrl} target="_blank" rel="noopener noreferrer">
            <WhatsAppIcon size={16} /> Escribinos por WhatsApp
          </a>
        </p>
      ) : null}
    </div>
  );
}

'use client';

import { CircleAlert, PartyPopper, Store, Truck, Weight } from 'lucide-react';
import { formatArs } from '@/lib/format-price';
import type { DeliveryMethod } from '@/lib/order-options';
import type { OrderTotals } from '@/lib/pricing';
import type { StoreInfo } from '@/lib/types';

type DeliveryMethodPickerProps = {
  name: string;
  value: DeliveryMethod;
  onChange: (method: DeliveryMethod) => void;
  storeInfo: StoreInfo;
  /** Versión chica para el pie del carrito, donde el espacio es oro en el celular. */
  compact?: boolean;
};

/**
 * "¿Cómo lo recibís?". Son radios de verdad (no botones sueltos) para que se
 * puedan elegir con el teclado y el lector de pantalla diga cuál está marcado.
 */
export function DeliveryMethodPicker({ name, value, onChange, storeInfo, compact = false }: DeliveryMethodPickerProps) {
  return (
    <fieldset className={`choice-group ${compact ? 'is-compact' : ''}`}>
      <legend>¿Cómo lo recibís?</legend>
      <div className="choice-options">
        <label className={`choice-card ${value === 'pickup' ? 'is-selected' : ''}`}>
          <input
            type="radio"
            name={name}
            value="pickup"
            checked={value === 'pickup'}
            onChange={() => onChange('pickup')}
          />
          <Store size={22} aria-hidden="true" />
          <span>
            <strong>Retiro en el local</strong>
            <small>Gratis, sin turno</small>
          </span>
        </label>
        <label className={`choice-card ${value === 'delivery' ? 'is-selected' : ''}`}>
          <input
            type="radio"
            name={name}
            value="delivery"
            checked={value === 'delivery'}
            onChange={() => onChange('delivery')}
          />
          <Truck size={22} aria-hidden="true" />
          <span>
            <strong>Envío a domicilio</strong>
            <small>
              {formatArs(storeInfo.deliveryFee)}, gratis desde {formatArs(storeInfo.deliveryFreeThreshold)}
            </small>
          </span>
        </label>
      </div>
    </fieldset>
  );
}

type DeliveryNoticesProps = {
  isDelivery: boolean;
  totals: OrderTotals;
  totalWeightKg: number;
  storeInfo: StoreInfo;
  /** En el paso de datos se muestra solo lo que bloquea (el mínimo), no la barra. */
  compact?: boolean;
};

/** Mínimo de envío, progreso hacia el envío gratis y aviso de peso. */
export function DeliveryNotices({ isDelivery, totals, totalWeightKg, storeInfo, compact = false }: DeliveryNoticesProps) {
  if (!isDelivery) return null;

  const missingForMinimum = Math.max(0, storeInfo.deliveryMinPurchase - totals.subtotal);
  const progress = storeInfo.deliveryFreeThreshold > 0
    ? Math.min(100, Math.round((totals.subtotal / storeInfo.deliveryFreeThreshold) * 100))
    : 100;
  const showWeight = totalWeightKg > storeInfo.deliveryMaxWeightKg;

  return (
    <>
      {totals.belowDeliveryMinimum ? (
        <div className="delivery-notice delivery-notice-warning">
          <CircleAlert size={18} aria-hidden="true" />
          <span>
            Para envío el pedido mínimo es {formatArs(storeInfo.deliveryMinPurchase)} en productos: te faltan{' '}
            <strong>{formatArs(missingForMinimum)}</strong>. Sumá algo más o elegí retiro en el local.
          </span>
        </div>
      ) : null}

      {!compact && !totals.belowDeliveryMinimum ? (
        <div className={`free-shipping ${totals.missingForFreeShipping === 0 ? 'is-free' : ''}`}>
          <p>
            {totals.missingForFreeShipping === 0 ? (
              <>
                <PartyPopper size={18} aria-hidden="true" /> ¡Tenés <strong>envío gratis</strong>!
              </>
            ) : (
              <>
                <Truck size={18} aria-hidden="true" /> Te faltan <strong>{formatArs(totals.missingForFreeShipping)}</strong> para el envío gratis
              </>
            )}
          </p>
          <div className="free-shipping-bar" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : null}

      {!compact && showWeight ? (
        <div className="delivery-notice">
          <Weight size={18} aria-hidden="true" />
          <span>
            Tu pedido pesa unos {totalWeightKg.toLocaleString('es-AR', { maximumFractionDigits: 1 })} kg. Es bastante para
            un solo envío: si hace falta te escribimos para coordinar la entrega.
          </span>
        </div>
      ) : null}
    </>
  );
}

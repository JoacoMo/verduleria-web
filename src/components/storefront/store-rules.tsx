import { Clock, ShoppingBag, Store, Truck, Wallet } from 'lucide-react';
import { DELIVERY_WINDOWS_TEXT, type DeliverySlot } from '@/lib/delivery-slots';
import { formatArs } from '@/lib/format-price';
import type { StoreInfo } from '@/lib/types';

const ICON_SIZE = 22;

type StoreRulesProps = {
  storeInfo: StoreInfo;
  /** Primer turno disponible; null antes de montar (se calcula solo en el cliente). */
  nextSlot: DeliverySlot | null;
};

/**
 * Las "reglas del juego" a la vista antes de armar el carrito: cuánto sale el
 * envío, desde cuánto es gratis, en qué horarios se entrega y cómo se paga. Es lo
 * primero que pregunta un cliente nuevo por WhatsApp.
 */
export default function StoreRules({ storeInfo, nextSlot }: StoreRulesProps) {
  return (
    <ul className="store-rules" aria-label="Condiciones de compra">
      <li>
        <Store size={ICON_SIZE} aria-hidden="true" />
        <span><strong>Retiro gratis</strong> en el local, sin turno</span>
      </li>
      <li>
        <Truck size={ICON_SIZE} aria-hidden="true" />
        <span>
          Envío <strong>{formatArs(storeInfo.deliveryFee)}</strong> · <strong>gratis</strong> desde {formatArs(storeInfo.deliveryFreeThreshold)}
        </span>
      </li>
      <li>
        <ShoppingBag size={ICON_SIZE} aria-hidden="true" />
        <span>Pedido mínimo para envío: <strong>{formatArs(storeInfo.deliveryMinPurchase)}</strong></span>
      </li>
      <li>
        <Clock size={ICON_SIZE} aria-hidden="true" />
        <span>
          Entregas de <strong>{DELIVERY_WINDOWS_TEXT}</strong>
          {nextSlot ? (
            <span className="store-rule-extra">Próxima entrega: <strong>{nextSlot.label}</strong></span>
          ) : null}
        </span>
      </li>
      <li>
        <Wallet size={ICON_SIZE} aria-hidden="true" />
        <span>Pagás por <strong>transferencia</strong> o en <strong>efectivo</strong></span>
      </li>
    </ul>
  );
}

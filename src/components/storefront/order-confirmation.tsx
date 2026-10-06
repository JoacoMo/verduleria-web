'use client';

import type { Ref } from 'react';
import { Banknote, CalendarClock, CircleCheckBig, Clock, Landmark, MapPin, Scale, Star, Store, TrendingDown } from 'lucide-react';
import { WhatsAppIcon } from '@/components/brand-icons';
import { describeSlot } from '@/lib/delivery-slots';
import { formatArs } from '@/lib/format-price';
import type { PriceChange } from '@/lib/pricing';
import { PRODUCT_UNIT_LABELS } from '@/lib/product-units';
import type { OrderItem, StoreInfo } from '@/lib/types';
import CopyButton from './copy-button';
import OrderSummary from './order-summary';
import type { OrderConfirmationData } from './types';

/** ["a", "b", "c"] → "a, b y c". */
function joinNames(names: string[]) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/**
 * "¡Bajó el precio de Tomate!": algo bajó entre que armó el carrito y confirmó.
 * El pedido ya quedó con el precio menor (el servidor no lo frena por eso).
 */
function PriceDropsNote({ drops, items }: { drops: PriceChange[]; items: OrderItem[] }) {
  if (drops.length === 0) return null;
  const units = new Map(items.map((item) => [item.id, item.unit]));
  return (
    <div className="confirmation-good-news">
      <p className="confirmation-good-news-title">
        <TrendingDown size={18} aria-hidden="true" />
        <strong>¡Bajó el precio de {joinNames(drops.map((drop) => drop.name))}!</strong>
      </p>
      <ul>
        {drops.map((drop) => {
          const unit = units.get(drop.id);
          const per = unit ? ` / ${PRODUCT_UNIT_LABELS[unit]}` : '';
          return (
            <li key={drop.id}>
              {drop.name}: antes {formatArs(drop.previousPrice)}{per}, ahora <strong>{formatArs(drop.currentPrice)}{per}</strong>
            </li>
          );
        })}
      </ul>
      <p>Ya te lo cobramos al precio nuevo.</p>
    </div>
  );
}

type OrderConfirmationProps = {
  confirmation: OrderConfirmationData;
  storeInfo: StoreInfo;
  imagesById: Map<number, string>;
  headingRef?: Ref<HTMLHeadingElement>;
  onContinue: () => void;
};

/** Pantalla final: número de pedido, cómo sigue, cómo se paga y el botón de WhatsApp. */
export default function OrderConfirmation({ confirmation, storeInfo, imagesById, headingRef, onContinue }: OrderConfirmationProps) {
  const { order, whatsappUrl, hasWeightItems, customerAddress, pickupReady } = confirmation;
  const isDelivery = order.deliveryMethod === 'delivery';
  const isTransfer = order.paymentMethod === 'transfer';
  const alias = order.transferAlias || storeInfo.transferAlias;
  const cbu = order.transferCbu || storeInfo.transferCbu;

  return (
    <div className="order-confirmation">
      <h3 ref={headingRef} tabIndex={-1}>
        <CircleCheckBig size={26} aria-hidden="true" /> ¡Pedido #{order.orderId} registrado!
      </h3>
      {order.yaExistia ? (
        <p className="confirmation-note">Este pedido ya estaba registrado, no se duplicó.</p>
      ) : null}

      <PriceDropsNote drops={order.priceDrops} items={order.items} />

      <p>
        Te abrimos WhatsApp con el detalle del pedido para que nos lo mandes. Si no se abrió, tocá el botón:
      </p>
      <a className="whatsapp-btn" href={whatsappUrl} target="_blank" rel="noopener noreferrer">
        <WhatsAppIcon size={22} /> Enviar pedido por WhatsApp
      </a>

      <div className="confirmation-block">
        <h4>{isDelivery ? 'Envío a domicilio' : 'Retiro en el local'}</h4>
        {isDelivery ? (
          <>
            <p><MapPin size={18} aria-hidden="true" /> <span>{customerAddress || 'Dirección a coordinar'}</span></p>
            {order.deliverySlot ? (
              <p><CalendarClock size={18} aria-hidden="true" /> <span>Turno: <strong>{describeSlot(order.deliverySlot.id) ?? order.deliverySlot.label}</strong></span></p>
            ) : null}
          </>
        ) : (
          <>
            <p>
              <Store size={18} aria-hidden="true" />
              <span>
                Pasá a buscarlo por {storeInfo.storeAddress}
                {pickupReady ? <>: lo tenés listo <strong>{pickupReady}</strong>.</> : '.'}
              </span>
            </p>
            <p>
              <Clock size={18} aria-hidden="true" />
              <span>{storeInfo.storeHours.weekday}. {storeInfo.storeHours.sunday}.</span>
            </p>
          </>
        )}
      </div>

      <div className="confirmation-block">
        <h4>Pago: {isTransfer ? 'transferencia' : 'efectivo'}</h4>
        {hasWeightItems ? (
          <p>
            <Scale size={18} aria-hidden="true" />
            <span>
              Hay productos por peso, así que cuando armemos tu pedido te mandamos el <strong>total exacto por WhatsApp</strong>
              {isTransfer ? '. Recién ahí transferís ese total final a:' : `. Lo pagás en efectivo ${isDelivery ? 'al recibirlo' : 'al retirarlo'}.`}
            </span>
          </p>
        ) : isTransfer ? (
          <p>
            <Landmark size={18} aria-hidden="true" />
            <span>Transferí <strong>{formatArs(order.total)}</strong> a esta cuenta y mandanos el comprobante por WhatsApp:</span>
          </p>
        ) : (
          <p>
            <Banknote size={18} aria-hidden="true" />
            <span>Pagás <strong>{formatArs(order.total)}</strong> en efectivo {isDelivery ? 'al recibirlo' : 'al retirarlo'}.</span>
          </p>
        )}

        {isTransfer ? (
          <ul className="transfer-details">
            <li>
              <span><strong>Alias:</strong> {alias}</span>
              <CopyButton value={alias} label="alias" />
            </li>
            {cbu ? (
              <li>
                <span><strong>CBU:</strong> {cbu}</span>
                <CopyButton value={cbu} label="CBU" />
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>

      <OrderSummary
        title="Tu pedido"
        lines={order.items.map((item) => ({ ...item, image: imagesById.get(item.id) }))}
        subtotal={order.subtotal}
        shippingCost={order.shippingCost}
        total={order.total}
        isDelivery={isDelivery}
        approximate={hasWeightItems}
      />

      {storeInfo.googleReviewUrl ? (
        <p className="review-ask">
          <Star size={18} aria-hidden="true" />
          <span>
            ¿Te gustó cómo te atendimos?{' '}
            <a href={storeInfo.googleReviewUrl} target="_blank" rel="noopener noreferrer">Dejanos una reseña en Google</a>
            {' '}— nos ayuda un montón a que nos encuentren otros vecinos.
          </span>
        </p>
      ) : null}

      <button type="button" className="continue-shopping-btn" onClick={onContinue}>
        Seguir comprando
      </button>
    </div>
  );
}

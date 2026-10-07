'use client';

import { useEffect, useState } from 'react';
import {
  Ban,
  Banknote,
  CalendarClock,
  Check,
  Clock,
  Landmark,
  MapPin,
  MessageSquareText,
  RefreshCw,
  Scale,
  Star,
  Store,
  Trash2,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { WhatsAppIcon } from '@/components/brand-icons';
import type { OrderRecord, StoreInfo } from '@/lib/types';
import {
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  REPLACEMENT_POLICY_LABELS,
  isReplacementPolicy,
} from '@/lib/order-options';
import { describeSlot } from '@/lib/delivery-slots';
import { formatProductQuantity, isWeightUnit } from '@/lib/product-units';
import { formatArs } from '@/lib/format-price';
import { lineTotal } from '@/lib/pricing';
import { buildWhatsappUrl } from '@/lib/whatsapp';
import { buildFinalTotalMessage, buildReviewRequestMessage } from './order-messages';
import { OrderAdjustEditor } from './order-adjust-editor';
import { InlineAlert } from './notices';
import type { AdjustedItem } from './order-adjust-model';
import { clearAdjustDraft, readAdjustDraft } from './adjust-drafts';
import { hasWeightItems, isAwaitingWeights, isOpenOrder, isPickupForNextDay, isShippingChargedApart, orderWeightKg, totalLabel } from './orders-model';
import { describeDate, formatTime, mapsSearchUrl, toArgentinaDate } from './format';

/** Guarda un ajuste de pesos sobre la versión `expectedUpdatedAt`. Devuelve el error a mostrar, o null si se guardó. */
export type AdjustOrderHandler = (order: OrderRecord, items: AdjustedItem[], expectedUpdatedAt: string | null) => Promise<string | null>;

type OrderCardProps = {
  order: OrderRecord;
  /** Día que se está mirando (en "Pendientes de días anteriores", hoy). */
  selectedDate: string;
  storeInfo: StoreInfo | null;
  /** Hay una acción en curso sobre este pedido (confirmar, cancelar, borrar). */
  busy: boolean;
  onConfirm: (order: OrderRecord) => void;
  onCancel: (order: OrderRecord) => void;
  onDelete: (order: OrderRecord) => void;
  onAdjust: AdjustOrderHandler;
};

/** Ícono + nombre del dato (el nombre solo para lectores de pantalla: el ícono ya lo dice). */
function MetaLabel({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <dt>
      <Icon size={16} aria-hidden="true" />
      <span className="adm-visually-hidden">{label}</span>
    </dt>
  );
}

function deliveryText(order: OrderRecord) {
  if (order.deliveryMethod !== 'delivery') return 'Retiro en el local';
  const slot = describeSlot(order.deliverySlot);
  return slot ? `Envío · ${slot}` : 'Envío (sin turno elegido)';
}

export function OrderCard({ order, selectedDate, storeInfo, busy, onConfirm, onCancel, onDelete, onAdjust }: OrderCardProps) {
  const open = isOpenOrder(order);
  // Si quedaron pesos tipeados sin guardar (la sesión venció con el editor
  // abierto), el editor se abre solo con lo que había cargado. Si el pedido ya
  // se cerró mientras tanto, arranca igual en true para mostrar el aviso de
  // abajo (el efecto descarta el borrador después de leerlo acá).
  const [adjusting, setAdjusting] = useState(() => readAdjustDraft(order.id) !== null);
  // Con el editor abierto, el pedido se confirmó o se canceló desde otro lado
  // (lo trajo el refresco, o la recarga después de un 409): ya no se puede
  // ajustar y lo tipeado no sirve, pero se avisa en vez de cerrar en silencio.
  const closedWhileAdjusting = adjusting && !open;

  // Un pedido cerrado ya no se ajusta: si quedó un borrador suyo, se descarta.
  useEffect(() => {
    if (!open) clearAdjustDraft(order.id);
  }, [open, order.id]);

  const isDelivery = order.deliveryMethod === 'delivery';
  const weighed = hasWeightItems(order);
  const awaitingWeights = isAwaitingWeights(order);
  const nextDayPickup = isPickupForNextDay(order, selectedDate);
  const time = formatTime(order.createdAt);
  const createdDate = order.createdAt ? toArgentinaDate(order.createdAt) : null;
  const phone = order.customerPhone?.trim() || null;
  const address = order.customerAddress?.trim() || null;
  const weightKg = isDelivery ? orderWeightKg(order) : 0;
  const tooHeavy = storeInfo !== null && weightKg > storeInfo.deliveryMaxWeightKg;
  const paymentLabel = order.paymentMethod ? PAYMENT_METHOD_LABELS[order.paymentMethod] : 'Sin especificar (transferencia)';
  const PaymentIcon = order.paymentMethod === 'cash' ? Banknote : Landmark;

  // "Avisar total final" solo con el total real: con productos por peso sin
  // pesar, el cliente transferiría el estimado (de más o de menos).
  const canNotifyTotal = open && phone !== null && storeInfo !== null;
  const finalTotalUrl = canNotifyTotal && !awaitingWeights ? buildWhatsappUrl(phone, buildFinalTotalMessage(order, storeInfo)) : null;
  const reviewMessage = phone && storeInfo ? buildReviewRequestMessage(order, storeInfo) : null;
  const reviewUrl = phone && reviewMessage ? buildWhatsappUrl(phone, reviewMessage) : null;
  const weightsNoteId = `order-${order.id}-weights-note`;

  async function handleAdjust(items: AdjustedItem[], expectedUpdatedAt: string | null) {
    const error = await onAdjust(order, items, expectedUpdatedAt);
    if (!error) setAdjusting(false);
    return error;
  }

  return (
    <article className={`adm-order adm-order--${order.status}`} aria-labelledby={`order-${order.id}-title`}>
      <header className="adm-order__head">
        <div>
          <h4 className="adm-order__id" id={`order-${order.id}-title`}>Pedido #{order.id}</h4>
          {time ? (
            <p className="adm-order__time">
              <Clock size={14} aria-hidden="true" /> {time} h
              {createdDate && createdDate !== selectedDate ? ` · pedido el ${describeDate(createdDate)}` : ''}
            </p>
          ) : null}
        </div>
        <span className={`adm-status adm-status--${order.status}`}>{ORDER_STATUS_LABELS[order.status] ?? order.status}</span>
      </header>

      <div className="adm-order__customer">
        <p className="adm-order__name">{order.customerName?.trim() || 'Sin nombre'}</p>
        {phone ? (
          <a className="adm-link adm-link--whatsapp" href={buildWhatsappUrl(phone)} target="_blank" rel="noopener noreferrer">
            <WhatsAppIcon size={16} /> {phone}
          </a>
        ) : null}
        {address ? (
          <a className="adm-link" href={mapsSearchUrl(address)} target="_blank" rel="noopener noreferrer">
            <MapPin size={16} aria-hidden="true" /> {address}
          </a>
        ) : null}
      </div>

      <dl className="adm-order__meta">
        <div>
          <MetaLabel icon={isDelivery ? Truck : Store} label="Entrega" />
          <dd>
            {deliveryText(order)}
            {nextDayPickup ? (
              <>
                {' '}
                <span className="adm-badge adm-badge--next-day" title="Entró después del horario de armado: aparece en la lista de mañana">
                  <CalendarClock size={12} aria-hidden="true" /> Se arma mañana
                </span>
              </>
            ) : null}
          </dd>
        </div>
        <div>
          <MetaLabel icon={PaymentIcon} label="Pago" />
          <dd>{paymentLabel}</dd>
        </div>
        {order.replacementPolicy && isReplacementPolicy(order.replacementPolicy) ? (
          <div>
            <MetaLabel icon={RefreshCw} label="Reemplazos" />
            <dd>Si falta algo: {REPLACEMENT_POLICY_LABELS[order.replacementPolicy]}</dd>
          </div>
        ) : null}
        {order.notes?.trim() ? (
          <div className="adm-order__notes">
            <MetaLabel icon={MessageSquareText} label="Aclaraciones" />
            <dd>{order.notes}</dd>
          </div>
        ) : null}
        {weightKg > 0 ? (
          <div className={tooHeavy ? 'adm-order__heavy' : undefined}>
            <MetaLabel icon={Scale} label="Peso" />
            <dd>
              Peso aprox. {formatProductQuantity(weightKg, 'kg')}
              {tooHeavy && storeInfo ? ` · más de ${storeInfo.deliveryMaxWeightKg} kg, puede necesitar dos viajes` : ''}
            </dd>
          </div>
        ) : null}
      </dl>

      {adjusting && open ? (
        <OrderAdjustEditor order={order} onSave={handleAdjust} onCancel={() => setAdjusting(false)} />
      ) : (
        <>
          {closedWhileAdjusting ? (
            <InlineAlert
              kind="info"
              action={(
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--small" onClick={() => setAdjusting(false)}>
                  Entendido
                </button>
              )}
            >
              Mientras ajustabas los pesos, el pedido pasó a &quot;{ORDER_STATUS_LABELS[order.status] ?? order.status}&quot; desde otro lado.
              Lo que habías cargado no se guardó.
            </InlineAlert>
          ) : null}
          <ul className="adm-order__items">
            {order.items.map((item) => (
              <li key={item.id}>
                <span>
                  <strong>{formatProductQuantity(item.quantity, item.unit)}</strong> de {item.name}
                </span>
                <span className="adm-money">
                  {isWeightUnit(item.unit) && !order.adjustedAt ? '≈ ' : ''}{formatArs(lineTotal(item))}
                </span>
              </li>
            ))}
          </ul>

          <dl className="adm-totals">
            {isDelivery ? (
              <>
                <div><dt>Subtotal</dt><dd className="adm-money">{formatArs(order.subtotal)}</dd></div>
                <div>
                  <dt>Envío</dt>
                  <dd className="adm-money">
                    {order.shippingCost > 0 ? formatArs(order.shippingCost) : isShippingChargedApart(order) ? 'Aparte' : 'Gratis'}
                  </dd>
                </div>
              </>
            ) : null}
            <div className="adm-totals__total">
              <dt>{totalLabel(order)}</dt>
              <dd className="adm-money">{formatArs(order.total)}</dd>
            </div>
          </dl>
          {order.adjustedAt ? (
            <p className="adm-order__note">Pesos reales cargados a las {formatTime(order.adjustedAt)} h.</p>
          ) : awaitingWeights && open ? (
            <p className="adm-order__note adm-order__note--warn" id={weightsNoteId}>
              Tiene productos por peso y el total es estimado: cargá los pesos reales con &quot;Ajustar pesos&quot;
              {canNotifyTotal ? ' y recién ahí se habilita "Avisar total final".' : ' antes de avisar el total.'}
            </p>
          ) : null}

          <div className="adm-order__actions">
            {open ? (
              <button type="button" className="adm-btn adm-btn--secondary adm-btn--small" onClick={() => setAdjusting(true)} disabled={busy}>
                <Scale size={16} aria-hidden="true" /> {weighed ? 'Ajustar pesos' : 'Ajustar pedido'}
              </button>
            ) : null}
            {finalTotalUrl ? (
              <a className="adm-btn adm-btn--whatsapp adm-btn--small" href={finalTotalUrl} target="_blank" rel="noopener noreferrer">
                <WhatsAppIcon size={16} /> Avisar total final
              </a>
            ) : canNotifyTotal && awaitingWeights ? (
              <button
                type="button"
                className="adm-btn adm-btn--whatsapp adm-btn--small"
                disabled
                aria-describedby={weightsNoteId}
                title="Primero cargá los pesos reales"
              >
                <WhatsAppIcon size={16} /> Avisar total final
              </button>
            ) : null}
            {open ? (
              <button type="button" className="adm-btn adm-btn--primary adm-btn--small" onClick={() => onConfirm(order)} disabled={busy}>
                <Check size={16} aria-hidden="true" /> Confirmar pago
              </button>
            ) : null}
            {open ? (
              <button type="button" className="adm-btn adm-btn--secondary adm-btn--small" onClick={() => onCancel(order)} disabled={busy}>
                <Ban size={16} aria-hidden="true" /> Cancelar
              </button>
            ) : null}
            {reviewUrl ? (
              <a className="adm-btn adm-btn--whatsapp-outline adm-btn--small" href={reviewUrl} target="_blank" rel="noopener noreferrer">
                <Star size={16} aria-hidden="true" /> Pedir reseña
              </a>
            ) : null}
            <button
              type="button"
              className="adm-btn adm-btn--danger-ghost adm-btn--small adm-btn--icon adm-order__delete"
              onClick={() => onDelete(order)}
              disabled={busy}
              aria-label={`Eliminar el pedido ${order.id}`}
              title="Eliminar pedido"
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        </>
      )}
    </article>
  );
}

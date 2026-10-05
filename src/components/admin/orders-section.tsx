'use client';

import { useMemo, useState } from 'react';
import { Ban, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, RefreshCw, Store, Truck, type LucideIcon } from 'lucide-react';
import type { OrderRecord, StoreInfo } from '@/lib/types';
import { formatArs } from '@/lib/format-price';
import { MAX_ORDERS_PER_DAY } from '@/lib/order-options';
import { InlineAlert } from './notices';
import { Spinner } from './fields';
import { OrderCard } from './order-card';
import type { AdjustedItem } from './order-adjust-editor';
import { groupOrdersByDelivery, hasWeightItems, isOpenOrder, summarizeDay, type OrderGroupKind } from './orders-model';
import { describeDate, describeDateRelative, formatTime, shiftDate } from './format';

/**
 * Hasta cuántos días para adelante se puede mirar: los turnos se ofrecen hasta
 * 7 días antes (src/lib/delivery-slots.ts), y un pedido para el sábado aparece
 * en el sábado, que es cuando se arma.
 */
const MAX_DAYS_AHEAD = 7;

type View = 'reparto' | 'llegada';

const GROUP_ICONS: Record<OrderGroupKind, LucideIcon> = {
  slot: Truck,
  'no-slot': Truck,
  pickup: Store,
  'other-day': CalendarDays,
  cancelled: Ban,
};

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

type OrdersSectionProps = {
  orders: OrderRecord[];
  status: 'loading' | 'ready' | 'error';
  error: string;
  selectedDate: string;
  today: string;
  refreshing: boolean;
  lastUpdated: Date | null;
  storeInfo: StoreInfo | null;
  busyOrderIds: ReadonlySet<number>;
  onChangeDate: (date: string) => void;
  onRefresh: () => void;
  onConfirm: (order: OrderRecord) => void;
  onCancel: (order: OrderRecord) => void;
  onDelete: (order: OrderRecord) => void;
  onAdjust: (order: OrderRecord, items: AdjustedItem[]) => Promise<string | null>;
};

export function OrdersSection({
  orders,
  status,
  error,
  selectedDate,
  today,
  refreshing,
  lastUpdated,
  storeInfo,
  busyOrderIds,
  onChangeDate,
  onRefresh,
  onConfirm,
  onCancel,
  onDelete,
  onAdjust,
}: OrdersSectionProps) {
  const [view, setView] = useState<View>('reparto');
  const maxDate = shiftDate(today, MAX_DAYS_AHEAD);

  const summary = useMemo(() => summarizeDay(orders, selectedDate), [orders, selectedDate]);
  const groups = useMemo(() => groupOrdersByDelivery(orders, selectedDate), [orders, selectedDate]);
  const byArrival = useMemo(
    () => [...orders].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.id - a.id),
    [orders],
  );
  const hasEstimatedDue = orders.some((order) => isOpenOrder(order) && !order.adjustedAt && hasWeightItems(order));

  const relative = describeDateRelative(selectedDate, today);
  const dayLabel = ['Hoy', 'Ayer', 'Mañana'].includes(relative) ? `${relative}, ${describeDate(selectedDate)}` : relative;

  function renderCard(order: OrderRecord) {
    return (
      <OrderCard
        key={order.id}
        order={order}
        selectedDate={selectedDate}
        storeInfo={storeInfo}
        busy={busyOrderIds.has(order.id)}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onDelete={onDelete}
        onAdjust={onAdjust}
      />
    );
  }

  return (
    <section className="adm-section" aria-labelledby="adm-orders-title">
      <div className="adm-section__head">
        <h2 id="adm-orders-title">Pedidos del día</h2>
        <p className="adm-section__lead">
          Confirmá el pago recién cuando veas el comprobante de la transferencia o cobres el efectivo.
        </p>
      </div>

      <div className="adm-date-nav">
        <button
          type="button"
          className="adm-btn adm-btn--secondary adm-btn--icon"
          onClick={() => onChangeDate(shiftDate(selectedDate, -1))}
          aria-label="Día anterior"
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <label className="adm-date-nav__picker">
          <span className="adm-date-nav__label">{dayLabel}</span>
          <input
            className="adm-input adm-date-nav__input"
            type="date"
            value={selectedDate}
            max={maxDate}
            onChange={(event) => {
              if (event.target.value) onChangeDate(event.target.value);
            }}
            aria-label="Elegir el día"
          />
        </label>
        <button
          type="button"
          className="adm-btn adm-btn--secondary adm-btn--icon"
          onClick={() => onChangeDate(shiftDate(selectedDate, 1))}
          disabled={selectedDate >= maxDate}
          aria-label="Día siguiente"
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
        {selectedDate !== today ? (
          <button type="button" className="adm-btn adm-btn--ghost adm-btn--small" onClick={() => onChangeDate(today)}>
            Volver a hoy
          </button>
        ) : null}
        <button
          type="button"
          className="adm-btn adm-btn--ghost adm-btn--icon adm-date-nav__refresh"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Actualizar pedidos"
          title="Actualizar pedidos"
        >
          <RefreshCw size={18} aria-hidden="true" className={refreshing ? 'adm-spin' : undefined} />
        </button>
      </div>
      {lastUpdated ? (
        <p className="adm-muted adm-updated">
          Actualizado a las {formatTime(lastUpdated)} h. Se actualiza solo cada minuto.
        </p>
      ) : null}

      {status === 'error' ? (
        <InlineAlert
          action={(
            <button type="button" className="adm-btn adm-btn--secondary adm-btn--small" onClick={onRefresh}>
              <RefreshCw size={16} aria-hidden="true" /> Reintentar
            </button>
          )}
        >
          {error}
        </InlineAlert>
      ) : null}

      {status === 'loading' && orders.length === 0 ? (
        <p className="adm-empty"><Spinner /> Cargando pedidos…</p>
      ) : orders.length === 0 ? (
        status === 'ready' ? (
          <p className="adm-empty">
            No hay pedidos para {['Hoy', 'Ayer', 'Mañana'].includes(relative) ? relative.toLowerCase() : `el ${describeDate(selectedDate)}`}.
          </p>
        ) : null
      ) : (
        <>
          {orders.length >= MAX_ORDERS_PER_DAY ? (
            <InlineAlert kind="error">
              Hay más de {MAX_ORDERS_PER_DAY} pedidos este día y solo se muestran los últimos {MAX_ORDERS_PER_DAY}.
              Si no esperabas tantos, puede ser un ataque de pedidos falsos: avisale a quien mantiene el sitio.
            </InlineAlert>
          ) : null}
          <div className="adm-summary" aria-label="Resumen del día">
            <div className="adm-stat adm-stat--paid">
              <span className="adm-stat__label">Cobrado</span>
              <strong className="adm-stat__value adm-money">{formatArs(summary.paidTotal)}</strong>
              <span className="adm-stat__meta">{plural(summary.paidCount, 'pedido', 'pedidos')}</span>
            </div>
            <div className="adm-stat adm-stat--due">
              <span className="adm-stat__label">Por cobrar</span>
              <strong className="adm-stat__value adm-money">{formatArs(summary.toCollectTotal)}</strong>
              <span className="adm-stat__meta">
                {plural(summary.toCollectCount, 'pedido', 'pedidos')}
                {hasEstimatedDue ? ' · con totales estimados' : ''}
              </span>
            </div>
            <div className="adm-stat">
              <span className="adm-stat__label">Pedidos</span>
              <strong className="adm-stat__value">{summary.orderCount}</strong>
              <span className="adm-stat__meta">
                {summary.cancelledCount ? plural(summary.cancelledCount, 'cancelado', 'cancelados') : 'Sin cancelados'}
              </span>
            </div>
            <div className="adm-stat adm-stat--wide">
              <span className="adm-stat__label">Reparto</span>
              <ul className="adm-stat__list">
                {summary.deliveriesBySlot.map((slot) => (
                  <li key={slot.key}>
                    <Truck size={14} aria-hidden="true" /> Envíos {slot.label}: <strong>{slot.count}</strong>
                  </li>
                ))}
                <li><Store size={14} aria-hidden="true" /> Retiros: <strong>{summary.pickupCount}</strong></li>
                {summary.otherDeliveries ? (
                  <li><CalendarDays size={14} aria-hidden="true" /> Envíos sin turno u otro día: <strong>{summary.otherDeliveries}</strong></li>
                ) : null}
              </ul>
            </div>
          </div>

          <div className="adm-segmented" role="group" aria-label="Cómo ordenar los pedidos">
            <button type="button" className="adm-segmented__btn" aria-pressed={view === 'reparto'} onClick={() => setView('reparto')}>
              Por turno de entrega
            </button>
            <button type="button" className="adm-segmented__btn" aria-pressed={view === 'llegada'} onClick={() => setView('llegada')}>
              Por hora de llegada
            </button>
          </div>

          {view === 'llegada' ? (
            <div className="adm-group__list">{byArrival.map(renderCard)}</div>
          ) : (
            groups.map((group) => {
              const Icon = GROUP_ICONS[group.kind];
              const title = (
                <>
                  <Icon size={18} aria-hidden="true" /> {group.title}
                  <span className="adm-count">{group.orders.length}</span>
                </>
              );

              if (group.kind === 'cancelled') {
                return (
                  <details key={group.key} className="adm-group adm-group--cancelled">
                    <summary className="adm-group__title">
                      {title}
                      <ChevronDown size={18} aria-hidden="true" className="adm-group__chevron" />
                    </summary>
                    <div className="adm-group__list">{group.orders.map(renderCard)}</div>
                  </details>
                );
              }
              return (
                <section key={group.key} className={`adm-group adm-group--${group.kind}`}>
                  <h3 className="adm-group__title">{title}</h3>
                  <div className="adm-group__list">{group.orders.map(renderCard)}</div>
                </section>
              );
            })
          )}
        </>
      )}
    </section>
  );
}

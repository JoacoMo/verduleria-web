'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  Ban,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  History,
  RefreshCw,
  Store,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import type { OrderRecord, StoreInfo } from '@/lib/types';
import { formatArs } from '@/lib/format-price';
import { MAX_ORDERS_PER_DAY } from '@/lib/order-options';
import { InlineAlert } from './notices';
import { Spinner } from './fields';
import { OrderCard, type AdjustOrderHandler } from './order-card';
import {
  groupOrdersByDelivery,
  isAwaitingWeights,
  isOpenOrder,
  summarizeDay,
  summarizeOverdue,
  visibleOverdueOrders,
  type OrderGroupKind,
  type OverdueSummary,
} from './orders-model';
import { readAdjustDraft } from './adjust-drafts';
import { describeDate, describeDateRelative, formatTime, shiftDate } from './format';

/**
 * Hasta cuántos días para adelante se puede mirar: los turnos se ofrecen hasta
 * 7 días antes (src/lib/delivery-slots.ts), y un pedido para el sábado aparece
 * en el sábado, que es cuando se arma.
 */
const MAX_DAYS_AHEAD = 7;

/** Tope de "Pendientes de días anteriores": el mismo MAX_OVERDUE_ORDERS de la API (order-lifecycle.ts). */
const MAX_OVERDUE_SHOWN = 100;

type View = 'reparto' | 'llegada';
type LoadStatus = 'loading' | 'ready' | 'error';

const GROUP_ICONS: Record<OrderGroupKind, LucideIcon> = {
  slot: Truck,
  'no-slot': Truck,
  'pickup-carry': CalendarClock,
  pickup: Store,
  'other-day': CalendarDays,
  cancelled: Ban,
};

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

type OrdersSectionProps = {
  orders: OrderRecord[];
  status: LoadStatus;
  error: string;
  /** Pendientes de días anteriores (GET /api/gestion/orders/atrasados), del más viejo al más nuevo. */
  overdue: OrderRecord[];
  overdueStatus: LoadStatus;
  overdueError: string;
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
  onAdjust: AdjustOrderHandler;
};

export function OrdersSection({
  orders,
  status,
  error,
  overdue,
  overdueStatus,
  overdueError,
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
  const hasEstimatedDue = orders.some((order) => isOpenOrder(order) && isAwaitingWeights(order));

  // "Días anteriores" es respecto de hoy: el bloque va solo en la vista de hoy.
  const isToday = selectedDate === today;
  const overdueShown = useMemo(() => (isToday ? visibleOverdueOrders(overdue, orders) : []), [isToday, overdue, orders]);
  const overdueSummary = useMemo(() => summarizeOverdue(overdueShown), [overdueShown]);

  const relative = describeDateRelative(selectedDate, today);
  const dayLabel = ['Hoy', 'Ayer', 'Mañana'].includes(relative) ? `${relative}, ${describeDate(selectedDate)}` : relative;

  function renderCard(order: OrderRecord, cardDate = selectedDate) {
    return (
      <OrderCard
        key={order.id}
        order={order}
        selectedDate={cardDate}
        storeInfo={storeInfo}
        busy={busyOrderIds.has(order.id)}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onDelete={onDelete}
        onAdjust={onAdjust}
      />
    );
  }

  function renderOverdue() {
    if (!isToday) return null;
    if (overdueStatus === 'error' && overdueShown.length === 0) {
      return (
        <InlineAlert
          action={(
            <button type="button" className="adm-btn adm-btn--secondary adm-btn--small" onClick={onRefresh}>
              <RefreshCw size={16} aria-hidden="true" /> Reintentar
            </button>
          )}
        >
          {overdueError}
        </InlineAlert>
      );
    }
    if (overdueShown.length === 0) return null;
    return (
      <OverdueBlock
        orders={overdueShown}
        summary={overdueSummary}
        error={overdueStatus === 'error' ? overdueError : ''}
        truncated={overdue.length >= MAX_OVERDUE_SHOWN}
        renderCard={(order) => renderCard(order, today)}
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

      {renderOverdue()}

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
                {summary.nextDayPickupCount ? (
                  <li><CalendarClock size={14} aria-hidden="true" /> Retiros que se arman mañana: <strong>{summary.nextDayPickupCount}</strong></li>
                ) : null}
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
            <div className="adm-group__list">{byArrival.map((order) => renderCard(order))}</div>
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
                    <div className="adm-group__list">{group.orders.map((order) => renderCard(order))}</div>
                  </details>
                );
              }
              return (
                <section key={group.key} className={`adm-group adm-group--${group.kind}`}>
                  <h3 className="adm-group__title">{title}</h3>
                  {group.hint ? <p className="adm-group__hint">{group.hint}</p> : null}
                  <div className="adm-group__list">{group.orders.map((order) => renderCard(order))}</div>
                </section>
              );
            })
          )}
        </>
      )}
    </section>
  );
}

type OverdueBlockProps = {
  orders: OrderRecord[];
  summary: OverdueSummary;
  error: string;
  /** La API corta en MAX_OVERDUE_SHOWN: puede haber más. */
  truncated: boolean;
  renderCard: (order: OrderRecord) => ReactNode;
};

/**
 * "Pendientes de días anteriores": plegado, para no empujar hacia abajo los
 * pedidos del día. Se abre solo si alguno tiene pesos tipeados sin guardar
 * (la sesión venció con el editor abierto): si no, el editor recuperado
 * quedaría escondido.
 */
function OverdueBlock({ orders, summary, error, truncated, renderCard }: OverdueBlockProps) {
  const [startOpen] = useState(() => orders.some((order) => readAdjustDraft(order.id) !== null));
  return (
    <details className="adm-overdue" open={startOpen || undefined}>
      <summary className="adm-overdue__summary">
        <History size={18} aria-hidden="true" />
        <span className="adm-overdue__title">Pendientes de días anteriores</span>
        <span className="adm-count">{summary.count}</span>
        <span className="adm-overdue__meta adm-money">
          {formatArs(summary.toCollectTotal)} por cobrar{summary.hasEstimated ? ' (con estimados)' : ''}
        </span>
        <ChevronDown size={18} aria-hidden="true" className="adm-group__chevron" />
      </summary>
      <p className="adm-overdue__lead">
        Pedidos de otros días que siguen sin cobrar. Si ya los entregaste y cobraste, tocá &quot;Confirmar pago&quot;;
        si no se van a entregar, cancelalos. Del más viejo al más nuevo.
      </p>
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      <div className="adm-group__list">{orders.map(renderCard)}</div>
      {truncated ? (
        <p className="adm-muted adm-overdue__more">
          Se muestran los {MAX_OVERDUE_SHOWN} más viejos: a medida que los resuelvas aparecen los que siguen.
        </p>
      ) : null}
    </details>
  );
}

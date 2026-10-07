'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { Minus, Plus, Save, Trash2, Undo2 } from 'lucide-react';
import type { OrderItem, OrderRecord } from '@/lib/types';
import { PRODUCT_UNIT_LABELS, formatProductQuantity, isWeightUnit, type ProductUnit } from '@/lib/product-units';
import { formatArs } from '@/lib/format-price';
import { lineTotal } from '@/lib/pricing';
import { InlineAlert } from './notices';
import { Spinner } from './fields';
import { formatQuantityInput, parseQuantityInput } from './format';
import {
  ADJUST_STEP,
  adjustmentItems,
  buildAdjustLines,
  describeItemChange,
  diffOrderItems,
  initialDrafts,
  isDraftDirty,
  rebaseDrafts,
  stepAdjustQuantity,
  summarizeAdjustLines,
  type AdjustDraft,
  type AdjustDrafts,
  type AdjustedItem,
} from './order-adjust-model';
import { clearAdjustDraft, readAdjustDraft, writeAdjustDraft } from './adjust-drafts';
import { shippingLabel } from './orders-model';

export type { AdjustedItem };

type OrderAdjustEditorProps = {
  order: OrderRecord;
  /** Para decir "Gratis" o "Aparte" igual que la tarjeta (null mientras carga). */
  freeShippingThreshold: number | null;
  /**
   * Guarda el ajuste. `expectedUpdatedAt` es la versión del pedido sobre la que
   * se cargaron los pesos: si en el servidor ya es otra, responde 409 y no pisa
   * nada. Devuelve el mensaje de error, o null si se guardó.
   */
  onSave: (items: AdjustedItem[], expectedUpdatedAt: string | null) => Promise<string | null>;
  onCancel: () => void;
};

/** Versión del pedido sobre la que se está tipeando. */
type Base = { updatedAt: string | null; items: OrderItem[] };

/** Un error vale para la versión del pedido en la que ocurrió (ver más abajo). */
type EditorError = { message: string; version: string | null };

/**
 * Editor de los pesos reales de un pedido.
 *
 * Versiones: el editor recuerda la versión del pedido (updatedAt) que tenía al
 * abrirse y es la que manda al guardar. Si el pedido cambia mientras está
 * abierto (lo trae el refresco de cada minuto, o la recarga después de un 409
 * porque otro celular guardó antes), avisa qué cambió y no deja guardar hasta
 * que el dueño elija: seguir con lo que cargó o tomar lo guardado. Lo tipeado
 * nunca se pierde.
 *
 * Borradores: cada cambio se guarda en sessionStorage (adjust-drafts.ts). Si la
 * sesión vence y hay que volver a entrar, el editor se abre solo con lo cargado.
 */
export function OrderAdjustEditor({ order, freeShippingThreshold, onSave, onCancel }: OrderAdjustEditorProps) {
  const baseId = useId();
  const [start] = useState(() => {
    const stored = readAdjustDraft(order.id);
    if (stored) {
      return { base: { updatedAt: stored.baseUpdatedAt, items: stored.baseItems }, drafts: stored.drafts, restored: true };
    }
    return { base: { updatedAt: order.updatedAt ?? null, items: order.items }, drafts: initialDrafts(order.items), restored: false };
  });
  const [base, setBase] = useState<Base>(start.base);
  const [drafts, setDrafts] = useState<AdjustDrafts>(start.drafts);
  const [restored, setRestored] = useState(start.restored);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<EditorError | null>(null);

  const currentVersion = order.updatedAt ?? null;
  const changed = currentVersion !== base.updatedAt && !saving && !closing;
  const changes = changed ? diffOrderItems(base.items, order.items) : [];
  const baseById = new Map(base.items.map((item) => [item.id, item]));
  // Un error es de la versión en la que ocurrió: el 409 "el pedido cambió" se
  // deja de mostrar cuando llega la versión nueva, y ahí lo reemplaza el aviso
  // de qué cambió (que es más útil que "recargá").
  const visibleError = error && error.version === currentVersion ? error.message : null;

  const lines = buildAdjustLines(order.items, drafts);
  const totals = summarizeAdjustLines(lines, order.shippingCost);
  const isDelivery = order.deliveryMethod === 'delivery';
  const quantityWord = order.adjustedAt ? 'guardado' : 'pidió';

  useEffect(() => {
    if (isDraftDirty(drafts, base.items)) {
      writeAdjustDraft({ orderId: order.id, baseUpdatedAt: base.updatedAt, baseItems: base.items, drafts });
    } else {
      clearAdjustDraft(order.id);
    }
  }, [order.id, drafts, base]);

  function setDraft(id: number, patch: Partial<AdjustDraft>) {
    setDrafts((current) => {
      const item = order.items.find((entry) => entry.id === id);
      const previous = current[id] ?? { text: item ? formatQuantityInput(item.quantity, item.unit) : '', removed: false };
      return { ...current, [id]: { ...previous, ...patch } };
    });
    setError(null);
    setRestored(false);
  }

  function stepQuantity(id: number, unit: ProductUnit, direction: 1 | -1, current: number) {
    setDraft(id, { text: formatQuantityInput(stepAdjustQuantity(current, unit, direction), unit), removed: false });
  }

  /** Sigue con lo que tocó el dueño, ahora sobre la versión nueva del pedido (el resto, como quedó guardado). */
  function keepMine() {
    setBase({ updatedAt: currentVersion, items: order.items });
    setDrafts((current) => rebaseDrafts(current, base.items, order.items));
    setError(null);
    setRestored(false);
  }

  /** Descarta lo tipeado y arranca de lo que quedó guardado. */
  function takeSaved() {
    setBase({ updatedAt: currentVersion, items: order.items });
    setDrafts(initialDrafts(order.items));
    setError(null);
    setRestored(false);
  }

  function handleCancel() {
    clearAdjustDraft(order.id);
    onCancel();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (changed) {
      setError({ message: 'El pedido cambió: elegí arriba con qué seguir antes de guardar.', version: currentVersion });
      return;
    }
    if (totals.hasProblems) {
      setError({ message: 'Revisá las cantidades marcadas.', version: currentVersion });
      return;
    }
    if (totals.allRemoved) {
      setError({ message: 'El pedido tiene que quedar con al menos un producto. Si no se lleva nada, cancelalo.', version: currentVersion });
      return;
    }

    setSaving(true);
    setError(null);
    const message = await onSave(adjustmentItems(lines), base.updatedAt);
    if (message) {
      setSaving(false);
      setError({ message, version: currentVersion });
      return;
    }
    // Guardado: el pedido se cierra (OrderCard) y el borrador ya no hace falta.
    clearAdjustDraft(order.id);
    setClosing(true);
    setSaving(false);
  }

  return (
    <form className="adm-adjust" onSubmit={handleSubmit} noValidate aria-label={`Ajustar pesos del pedido ${order.id}`}>
      <p className="adm-adjust__intro">
        {order.items.some((item) => isWeightUnit(item.unit))
          ? 'Cargá lo que marcó la balanza (se guarda de a 5 g). '
          : 'Cargá lo que realmente se lleva. '}
        Se cobra al precio del pedido, aunque después hayas cambiado el catálogo.
      </p>

      {changed ? (
        <InlineAlert kind="error">
          <p className="adm-alert__title">El pedido cambió, revisalo.</p>
          <p>
            {restored ? 'Recuperamos los pesos que habías cargado, pero desde entonces ' : 'Mientras lo editabas, '}
            el pedido se modificó desde otro lado (por ejemplo, otro celular cargó los pesos).
            {changes.length ? ' Lo que quedó guardado:' : ' Los productos y las cantidades siguen iguales.'}
          </p>
          {changes.length ? (
            <ul className="adm-alert__list">
              {changes.map((change) => <li key={`${change.kind}-${change.id}`}>{describeItemChange(change)}</li>)}
            </ul>
          ) : null}
          <p>
            Abajo sigue lo que cargaste vos. &quot;Seguir con lo que cargué&quot; deja lo que tocaste y toma lo guardado en el resto;
            &quot;Usar lo guardado&quot; descarta lo tuyo.
          </p>
          <div className="adm-alert__buttons">
            <button type="button" className="adm-btn adm-btn--secondary adm-btn--small" onClick={keepMine}>
              Seguir con lo que cargué
            </button>
            <button type="button" className="adm-btn adm-btn--ghost adm-btn--small" onClick={takeSaved}>
              Usar lo guardado
            </button>
          </div>
        </InlineAlert>
      ) : restored ? (
        <InlineAlert kind="info">
          Recuperamos los pesos que habías cargado y todavía no se guardaron (por ejemplo, porque venció la sesión).
          Revisalos y tocá &quot;Guardar pesos reales&quot;.
        </InlineAlert>
      ) : null}

      <ul className="adm-adjust__list">
        {lines.map(({ item, draft, problem, removed, quantity, rounded }) => {
          const inputId = `${baseId}-${item.id}`;
          const current = parseQuantityInput(draft.text, item.unit);
          const stepFrom = current !== null && !Number.isNaN(current) ? current : item.quantity;
          const before = baseById.get(item.id);
          const savedElsewhere = changed && (!before || Math.abs(before.quantity - item.quantity) > 1e-9);
          return (
            <li key={item.id} className={`adm-adjust__row${removed ? ' is-removed' : ''}${problem ? ' is-invalid' : ''}`}>
              <div className="adm-adjust__name">
                <label htmlFor={inputId}><strong>{item.name}</strong></label>
                <span className="adm-muted">
                  {formatArs(item.price)} / {PRODUCT_UNIT_LABELS[item.unit]} · {quantityWord} {formatProductQuantity(item.quantity, item.unit)}
                </span>
                {savedElsewhere ? (
                  <span className="adm-adjust__changed">
                    Guardado ahora: {formatProductQuantity(item.quantity, item.unit)}
                    {before ? ` (antes ${formatProductQuantity(before.quantity, before.unit)})` : ''}
                  </span>
                ) : null}
              </div>

              {draft.removed ? (
                <div className="adm-adjust__removed">
                  <span>Se saca del pedido</span>
                  <button type="button" className="adm-btn adm-btn--ghost adm-btn--small" onClick={() => setDraft(item.id, { removed: false })}>
                    <Undo2 size={16} aria-hidden="true" /> Volver a agregar
                  </button>
                </div>
              ) : (
                <div className="adm-adjust__controls">
                  <div className="adm-stepper">
                    <button
                      type="button"
                      className="adm-stepper__btn"
                      onClick={() => stepQuantity(item.id, item.unit, -1, stepFrom)}
                      aria-label={`Restar ${formatProductQuantity(ADJUST_STEP[item.unit], item.unit)} de ${item.name}`}
                    >
                      <Minus size={16} aria-hidden="true" />
                    </button>
                    <input
                      id={inputId}
                      className="adm-input adm-stepper__input"
                      type="text"
                      inputMode={item.unit === 'kg' ? 'decimal' : 'numeric'}
                      autoComplete="off"
                      value={draft.text}
                      onChange={(event) => setDraft(item.id, { text: event.target.value })}
                      aria-invalid={problem ? true : undefined}
                      aria-describedby={problem ? `${inputId}-error` : undefined}
                    />
                    <span className="adm-stepper__unit">{PRODUCT_UNIT_LABELS[item.unit]}</span>
                    <button
                      type="button"
                      className="adm-stepper__btn"
                      onClick={() => stepQuantity(item.id, item.unit, 1, stepFrom)}
                      aria-label={`Sumar ${formatProductQuantity(ADJUST_STEP[item.unit], item.unit)} de ${item.name}`}
                    >
                      <Plus size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <button
                    type="button"
                    className="adm-btn adm-btn--danger-ghost adm-btn--small adm-btn--icon"
                    onClick={() => setDraft(item.id, { removed: true })}
                    aria-label={`Sacar ${item.name} del pedido`}
                    title="Sacar del pedido"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              )}

              <div className="adm-adjust__line-total">
                {problem ? (
                  <span className="adm-field-error" id={`${inputId}-error`}>{problem}</span>
                ) : removed ? (
                  <span className="adm-muted">{draft.removed ? '' : 'Con 0 se saca del pedido'}</span>
                ) : (
                  <>
                    {rounded ? <span className="adm-muted">Se guarda como {formatProductQuantity(quantity, item.unit)} · </span> : null}
                    <strong className="adm-money">{formatArs(lineTotal({ price: item.price, quantity }))}</strong>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <dl className="adm-totals adm-totals--adjust">
        <div><dt>Subtotal</dt><dd className="adm-money">{formatArs(totals.subtotal)} <span className="adm-muted">(antes {formatArs(order.subtotal)})</span></dd></div>
        {isDelivery ? (
          <div>
            <dt>Envío</dt>
            <dd className="adm-money">{shippingLabel(order, freeShippingThreshold, formatArs)} <span className="adm-muted">(no cambia)</span></dd>
          </div>
        ) : null}
        <div className="adm-totals__total"><dt>Total final</dt><dd className="adm-money">{formatArs(totals.total)}</dd></div>
      </dl>

      {visibleError ? <InlineAlert>{visibleError}</InlineAlert> : null}

      <div className="adm-form-actions">
        <button type="submit" className="adm-btn adm-btn--primary" disabled={saving || changed}>
          {saving ? <Spinner /> : <Save size={18} aria-hidden="true" />} Guardar pesos reales
        </button>
        <button type="button" className="adm-btn adm-btn--secondary" onClick={handleCancel} disabled={saving}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

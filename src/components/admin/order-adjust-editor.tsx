'use client';

import { useId, useState, type FormEvent } from 'react';
import { Minus, Plus, Save, Trash2, Undo2 } from 'lucide-react';
import type { OrderRecord } from '@/lib/types';
import {
  PRODUCT_MAX_CART_QUANTITY,
  PRODUCT_UNIT_LABELS,
  formatProductQuantity,
  isWeightUnit,
  normalizeProductQuantity,
  type ProductUnit,
} from '@/lib/product-units';
import { formatArs } from '@/lib/format-price';
import { lineTotal, roundMoney, sumLines } from '@/lib/pricing';
import { InlineAlert } from './notices';
import { Spinner } from './fields';
import { formatQuantityInput, parseQuantityInput } from './format';

/**
 * Paso de los botones -/+ al cargar el peso real: la balanza mide de a 50 g
 * (es la misma precisión con la que el servidor normaliza), y lo que va por
 * cantidad es siempre entero.
 */
const ADJUST_STEP: Record<ProductUnit, number> = {
  kg: 0.05,
  g: 50,
  unidad: 1,
  atado: 1,
  bandeja: 1,
};

type Draft = { text: string; removed: boolean };

export type AdjustedItem = { id: number; quantity: number };

type OrderAdjustEditorProps = {
  order: OrderRecord;
  /** Devuelve el mensaje de error del servidor, o null si se guardó. */
  onSave: (items: AdjustedItem[]) => Promise<string | null>;
  onCancel: () => void;
};

function roundStep(value: number, unit: ProductUnit) {
  return unit === 'kg' ? Number(value.toFixed(2)) : Math.round(value);
}

export function OrderAdjustEditor({ order, onSave, onCancel }: OrderAdjustEditorProps) {
  const baseId = useId();
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() => Object.fromEntries(
    order.items.map((item) => [item.id, { text: formatQuantityInput(item.quantity, item.unit), removed: false }]),
  ));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const lines = order.items.map((item) => {
    const draft = drafts[item.id] ?? { text: '', removed: false };
    const parsed = parseQuantityInput(draft.text);
    const max = PRODUCT_MAX_CART_QUANTITY[item.unit];

    let problem: string | null = null;
    if (!draft.removed) {
      if (parsed === null) problem = 'Poné la cantidad (o sacalo del pedido).';
      else if (Number.isNaN(parsed)) problem = 'Escribí un número.';
      else if (parsed > max) problem = `Es demasiado: máximo ${formatProductQuantity(max, item.unit)}.`;
    }

    // Un 0 es lo mismo que sacarlo (así lo toma el servidor).
    const removed = draft.removed || parsed === 0;
    const quantity = removed || problem || parsed === null ? 0 : normalizeProductQuantity(parsed, item.unit);
    const rounded = !removed && !problem && parsed !== null && Math.abs(quantity - parsed) > 1e-9;
    return { item, draft, problem, removed, quantity, rounded };
  });

  const kept = lines.filter((line) => !line.removed && !line.problem);
  const subtotal = sumLines(kept.map((line) => ({ price: line.item.price, quantity: line.quantity })));
  const total = roundMoney(subtotal + order.shippingCost);
  const allRemoved = lines.every((line) => line.removed);
  const hasProblems = lines.some((line) => line.problem);
  const isDelivery = order.deliveryMethod === 'delivery';

  function setDraft(id: number, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [id]: { ...(current[id] ?? { text: '', removed: false }), ...patch } }));
    setError('');
  }

  function stepQuantity(id: number, unit: ProductUnit, direction: 1 | -1, current: number) {
    const next = Math.max(0, roundStep(current + direction * ADJUST_STEP[unit], unit));
    setDraft(id, { text: formatQuantityInput(next, unit), removed: false });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (hasProblems) {
      setError('Revisá las cantidades marcadas.');
      return;
    }
    if (allRemoved) {
      setError('El pedido tiene que quedar con al menos un producto. Si no se lleva nada, cancelalo.');
      return;
    }

    setSaving(true);
    setError('');
    const message = await onSave(lines.map((line) => ({ id: line.item.id, quantity: line.removed ? 0 : line.quantity })));
    setSaving(false);
    if (message) setError(message);
  }

  return (
    <form className="adm-adjust" onSubmit={handleSubmit} noValidate aria-label={`Ajustar pesos del pedido ${order.id}`}>
      <p className="adm-adjust__intro">
        {order.items.some((item) => isWeightUnit(item.unit))
          ? 'Cargá lo que marcó la balanza. '
          : 'Cargá lo que realmente se lleva. '}
        Se cobra al precio del pedido, aunque después hayas cambiado el catálogo.
      </p>

      <ul className="adm-adjust__list">
        {lines.map(({ item, draft, problem, removed, quantity, rounded }) => {
          const inputId = `${baseId}-${item.id}`;
          const current = parseQuantityInput(draft.text);
          const base = current !== null && !Number.isNaN(current) ? current : item.quantity;
          return (
            <li key={item.id} className={`adm-adjust__row${removed ? ' is-removed' : ''}${problem ? ' is-invalid' : ''}`}>
              <div className="adm-adjust__name">
                <label htmlFor={inputId}><strong>{item.name}</strong></label>
                <span className="adm-muted">
                  {formatArs(item.price)} / {PRODUCT_UNIT_LABELS[item.unit]} · pidió {formatProductQuantity(item.quantity, item.unit)}
                </span>
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
                      onClick={() => stepQuantity(item.id, item.unit, -1, base)}
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
                      onClick={() => stepQuantity(item.id, item.unit, 1, base)}
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
        <div><dt>Subtotal</dt><dd className="adm-money">{formatArs(subtotal)} <span className="adm-muted">(antes {formatArs(order.subtotal)})</span></dd></div>
        {isDelivery ? (
          <div>
            <dt>Envío</dt>
            <dd className="adm-money">{order.shippingCost > 0 ? formatArs(order.shippingCost) : 'Gratis'} <span className="adm-muted">(no cambia)</span></dd>
          </div>
        ) : null}
        <div className="adm-totals__total"><dt>Total final</dt><dd className="adm-money">{formatArs(total)}</dd></div>
      </dl>

      {error ? <InlineAlert>{error}</InlineAlert> : null}

      <div className="adm-form-actions">
        <button type="submit" className="adm-btn adm-btn--primary" disabled={saving}>
          {saving ? <Spinner /> : <Save size={18} aria-hidden="true" />} Guardar pesos reales
        </button>
        <button type="button" className="adm-btn adm-btn--secondary" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

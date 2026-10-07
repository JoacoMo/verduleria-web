'use client';

import { useId, useState, type FormEvent } from 'react';
import { Save, X } from 'lucide-react';
import type { Product } from '@/lib/types';
import { PRODUCT_UNIT_LABELS } from '@/lib/product-units';
import { formatArs } from '@/lib/format-price';
import { isOfferActive } from '@/lib/pricing';
import { getArgentinaParts } from '@/lib/store-hours';
import { ADMIN_API } from '@/lib/routes';
import type { AdminClient } from './api';
import { InlineAlert } from './notices';
import { Field, Spinner, fieldAria } from './fields';
import { describeDate, formatMoneyInput, parseMoneyInput, shiftDate, toArgentinaDate } from './format';
import { discountPercent, discountedPrice, maxOfferDate, validateOffer } from './product-form-model';

const DISCOUNT_PRESETS = [10, 15, 20, 30];

type OfferEditorProps = {
  product: Product;
  client: AdminClient;
  onSaved: (product: Product, message: string) => void;
  onClose: () => void;
};

/**
 * Carga rápida de una oferta desde la lista, sin abrir el formulario completo:
 * es lo que el dueño hace a la mañana cuando ve qué fruta hay que mover.
 * Manda solo offerPrice/offerEndsAt (edición parcial): el servidor compara la
 * oferta contra el precio guardado.
 */
export function OfferEditor({ product, client, onSaved, onClose }: OfferEditorProps) {
  const baseId = useId();
  const now = new Date();
  const { date: today, dayIndex } = getArgentinaParts(now);
  const active = isOfferActive(product, now);

  const [offerText, setOfferText] = useState(active ? formatMoneyInput(product.offerPrice) : '');
  const [dateText, setDateText] = useState(active && product.offerEndsAt ? toArgentinaDate(product.offerEndsAt) : '');
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState<'save' | 'remove' | null>(null);
  const [serverError, setServerError] = useState('');

  const validation = validateOffer(product.price, offerText, dateText, today);
  const missingOffer = parseMoneyInput(offerText) === null;
  const offerError = validation.errors.offerPrice ?? (attempted && missingOffer ? 'Poné el precio de oferta.' : undefined);
  const dateError = validation.errors.offerEndsAt;
  const percent = discountPercent(product.price, validation.offerPrice);
  const unitLabel = PRODUCT_UNIT_LABELS[product.unit];
  // Domingo de esta semana (si hoy es domingo, hoy).
  const sunday = shiftDate(today, (7 - dayIndex) % 7);

  async function save(body: { offerPrice: number | null; offerEndsAt?: string | null }, mode: 'save' | 'remove') {
    setSaving(mode);
    setServerError('');
    const result = await client.send<Product>(`${ADMIN_API}/products/${product.id}`, 'PUT', body, 'No se pudo guardar la oferta.');
    setSaving(null);
    if (!result.ok) {
      if (result.status !== 401) setServerError(result.error);
      return;
    }
    onSaved(
      result.data,
      mode === 'remove' ? `Se sacó la oferta de ${product.name}.` : `Oferta de ${product.name} guardada: ${formatArs(body.offerPrice ?? 0)}.`,
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    if (saving || missingOffer || validation.offerPrice === null || offerError || dateError) return;
    void save({ offerPrice: validation.offerPrice, offerEndsAt: validation.offerEndsAt }, 'save');
  }

  const offerHint = `Precio normal: ${formatArs(product.price)} / ${unitLabel}`;
  const dateHint = dateText && !dateError ? `Vence al terminar el ${describeDate(dateText)}.` : 'Vacío = sin vencimiento.';

  return (
    <form className="adm-offer-editor" onSubmit={handleSubmit} noValidate aria-label={`Oferta de ${product.name}`}>
      <div className="adm-chip-row" role="group" aria-label="Descuentos rápidos">
        {DISCOUNT_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className="adm-chip"
            onClick={() => setOfferText(formatMoneyInput(discountedPrice(product.price, preset)))}
          >
            -{preset}%
          </button>
        ))}
      </div>

      <div className="adm-form-grid">
        <Field id={`${baseId}-offer`} label={`Precio de oferta (por ${unitLabel})`} hint={offerHint} error={offerError}>
          <input
            {...fieldAria(`${baseId}-offer`, { hint: offerHint, error: offerError })}
            className="adm-input adm-input--money"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={offerText}
            onChange={(event) => {
              setOfferText(event.target.value);
              setServerError('');
            }}
          />
        </Field>

        <Field id={`${baseId}-date`} label="Hasta (opcional)" hint={dateHint} error={dateError}>
          <input
            {...fieldAria(`${baseId}-date`, { hint: dateHint, error: dateError })}
            className="adm-input"
            type="date"
            min={today}
            max={maxOfferDate(today)}
            value={dateText}
            onChange={(event) => {
              setDateText(event.target.value);
              setServerError('');
            }}
          />
        </Field>
      </div>

      <div className="adm-chip-row" role="group" aria-label="Vencimientos rápidos">
        <button type="button" className={`adm-chip${dateText === today ? ' is-active' : ''}`} onClick={() => setDateText(today)}>Solo hoy</button>
        {sunday !== today ? (
          <button type="button" className={`adm-chip${dateText === sunday ? ' is-active' : ''}`} onClick={() => setDateText(sunday)}>Hasta el domingo</button>
        ) : null}
        <button type="button" className={`adm-chip${dateText === '' ? ' is-active' : ''}`} onClick={() => setDateText('')}>Sin vencimiento</button>
      </div>

      {percent > 0 && validation.offerPrice !== null ? (
        <p className="adm-offer-preview">
          En la tienda: <s>{formatArs(product.price)}</s> <strong>{formatArs(validation.offerPrice)}</strong> / {unitLabel}
          <span className="adm-badge adm-badge--offer">-{percent}%</span>
        </p>
      ) : null}

      {serverError ? <InlineAlert>{serverError}</InlineAlert> : null}

      <div className="adm-form-actions">
        <button type="submit" className="adm-btn adm-btn--primary adm-btn--small" disabled={saving !== null}>
          {saving === 'save' ? <Spinner size={16} /> : <Save size={16} aria-hidden="true" />}
          {active ? 'Guardar oferta' : 'Poner oferta'}
        </button>
        {product.offerPrice !== null ? (
          <button
            type="button"
            className="adm-btn adm-btn--secondary adm-btn--small"
            disabled={saving !== null}
            onClick={() => void save({ offerPrice: null }, 'remove')}
          >
            {saving === 'remove' ? <Spinner size={16} /> : <X size={16} aria-hidden="true" />}
            Sacar oferta
          </button>
        ) : null}
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--small" onClick={onClose} disabled={saving !== null}>
          Cerrar
        </button>
      </div>
    </form>
  );
}

'use client';

import type { FormEvent, ReactNode, Ref } from 'react';
import { Banknote, CalendarClock, Landmark, Scale } from 'lucide-react';
import { formatArs } from '@/lib/format-price';
import {
  REPLACEMENT_POLICIES,
  REPLACEMENT_POLICY_LABELS,
  isReplacementPolicy,
  type PaymentMethod,
} from '@/lib/order-options';
import type { StoreInfo } from '@/lib/types';
import { DeliveryMethodPicker } from './delivery-options';
import { CHECKOUT_FIELD_IDS, type CheckoutField, type CheckoutFormState } from './use-checkout-form';
import type { DeliverySlotsState } from './use-delivery-slots';

export const CHECKOUT_FORM_ID = 'checkout-form';

/** Lleva el foco (y el scroll) al campo con error. */
export function focusCheckoutField(field: CheckoutField) {
  const element = field === 'deliverySlot'
    ? document.querySelector<HTMLElement>(`#${CHECKOUT_FIELD_IDS.deliverySlot} input`)
    : document.getElementById(CHECKOUT_FIELD_IDS[field]);
  if (!element) return;
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

type FieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
};

function Field({ id, label, hint, error, children }: FieldProps) {
  return (
    <div className={`form-group ${error ? 'has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {hint ? <p className="field-hint" id={`${id}-hint`}>{hint}</p> : null}
      {children}
      {error ? (
        <p className="field-error" id={`${id}-error`} role="alert">{error}</p>
      ) : null}
    </div>
  );
}

type PaymentExplanationProps = {
  paymentMethod: PaymentMethod;
  hasWeightItems: boolean;
  isDelivery: boolean;
  total: number;
  storeInfo: StoreInfo;
};

/**
 * Cómo y cuándo se paga. Lo que va por peso tiene total estimado: el local pesa,
 * ajusta el pedido y manda el total final por WhatsApp; recién ahí se transfiere.
 */
export function PaymentExplanation({ paymentMethod, hasWeightItems, isDelivery, total, storeInfo }: PaymentExplanationProps) {
  const moment = isDelivery ? 'al recibirlo' : 'al retirarlo';

  if (hasWeightItems) {
    return (
      <p className="payment-explanation">
        <Scale size={18} aria-hidden="true" />
        <span>
          Cuando armemos tu pedido te mandamos el <strong>total exacto por WhatsApp</strong>.{' '}
          {paymentMethod === 'transfer'
            ? <>Ahí nos transferís ese total al alias <strong>{storeInfo.transferAlias}</strong>.</>
            : <>Lo pagás en efectivo {moment}.</>}
        </span>
      </p>
    );
  }

  return (
    <p className="payment-explanation">
      {paymentMethod === 'transfer' ? <Landmark size={18} aria-hidden="true" /> : <Banknote size={18} aria-hidden="true" />}
      <span>
        {paymentMethod === 'transfer'
          ? <>El total es exacto: transferís <strong>{formatArs(total)}</strong> al alias <strong>{storeInfo.transferAlias}</strong> y nos mandás el comprobante por WhatsApp.</>
          : <>El total es exacto: pagás <strong>{formatArs(total)}</strong> en efectivo {moment}.</>}
      </span>
    </p>
  );
}

type CheckoutFormProps = {
  form: CheckoutFormState;
  slots: DeliverySlotsState;
  storeInfo: StoreInfo;
  hasWeightItems: boolean;
  total: number;
  headingRef?: Ref<HTMLHeadingElement>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

/** Paso "Tus datos": contacto, entrega (con turno) y pago. */
export default function CheckoutForm({ form, slots, storeInfo, hasWeightItems, total, headingRef, onSubmit }: CheckoutFormProps) {
  const { values, visibleErrors, isDelivery, paymentMethod } = form;
  const slotErrorId = `${CHECKOUT_FIELD_IDS.deliverySlot}-error`;

  return (
    <form className="checkout-form" id={CHECKOUT_FORM_ID} onSubmit={onSubmit} noValidate>
      <h3 ref={headingRef} tabIndex={-1}>Tus datos</h3>
      <p className="checkout-form-hint">Los usamos solo para coordinar este pedido. No hace falta crear una cuenta.</p>

      <Field id={CHECKOUT_FIELD_IDS.customerName} label="Nombre" error={visibleErrors.customerName}>
        <input
          type="text"
          autoComplete="name"
          autoCapitalize="words"
          maxLength={80}
          required
          {...form.getFieldProps('customerName')}
        />
      </Field>

      <Field
        id={CHECKOUT_FIELD_IDS.customerPhone}
        label="Teléfono / WhatsApp"
        hint="Con código de área, sin el 0 ni el 15. Ej: 351 1234567"
        error={visibleErrors.customerPhone}
      >
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="351 1234567"
          maxLength={40}
          required
          {...form.getFieldProps('customerPhone', { hintId: `${CHECKOUT_FIELD_IDS.customerPhone}-hint` })}
        />
      </Field>

      <DeliveryMethodPicker
        name="checkout-delivery-method"
        value={form.deliveryMethod}
        onChange={form.setDeliveryMethod}
        storeInfo={storeInfo}
      />

      {isDelivery ? (
        <>
          <Field id={CHECKOUT_FIELD_IDS.customerAddress} label="Dirección de entrega" error={visibleErrors.customerAddress}>
            <input
              type="text"
              autoComplete="street-address"
              placeholder="Calle, número, depto y barrio"
              maxLength={200}
              required
              {...form.getFieldProps('customerAddress')}
            />
          </Field>

          <fieldset
            className={`choice-group slot-picker ${visibleErrors.deliverySlot ? 'has-error' : ''}`}
            id={CHECKOUT_FIELD_IDS.deliverySlot}
            aria-describedby={visibleErrors.deliverySlot ? slotErrorId : undefined}
          >
            <legend>
              <CalendarClock size={18} aria-hidden="true" /> ¿En qué turno te lo llevamos?
            </legend>
            {slots.selectionExpired ? (
              <p className="field-hint">El turno que habías elegido ya cerró. Elegí otro.</p>
            ) : null}
            {slots.slots === null ? (
              <p className="field-hint">Buscando los próximos turnos…</p>
            ) : slots.slots.length === 0 ? (
              <p className="field-hint">
                No quedan turnos en los próximos días. Escribinos por WhatsApp y lo coordinamos.
              </p>
            ) : (
              <div className="choice-options slot-options">
                {slots.slots.map((slot) => (
                  <label key={slot.id} className={`choice-card ${slots.selectedSlot?.id === slot.id ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="checkout-delivery-slot"
                      value={slot.id}
                      checked={slots.selectedSlot?.id === slot.id}
                      onChange={() => {
                        slots.selectSlot(slot.id);
                        form.markTouched('deliverySlot');
                      }}
                    />
                    <span><strong>{slot.label}</strong></span>
                  </label>
                ))}
              </div>
            )}
            {visibleErrors.deliverySlot ? (
              <p className="field-error" id={slotErrorId} role="alert">{visibleErrors.deliverySlot}</p>
            ) : null}
          </fieldset>
        </>
      ) : null}

      <fieldset className="choice-group">
        <legend>¿Cómo pagás?</legend>
        <div className="choice-options">
          <label className={`choice-card ${paymentMethod === 'transfer' ? 'is-selected' : ''}`}>
            <input
              type="radio"
              name="checkout-payment-method"
              value="transfer"
              checked={paymentMethod === 'transfer'}
              onChange={() => form.setPaymentMethod('transfer')}
            />
            <Landmark size={22} aria-hidden="true" />
            <span><strong>Transferencia</strong></span>
          </label>
          <label className={`choice-card ${paymentMethod === 'cash' ? 'is-selected' : ''}`}>
            <input
              type="radio"
              name="checkout-payment-method"
              value="cash"
              checked={paymentMethod === 'cash'}
              onChange={() => form.setPaymentMethod('cash')}
            />
            <Banknote size={22} aria-hidden="true" />
            <span><strong>Efectivo</strong></span>
          </label>
        </div>
        <PaymentExplanation
          paymentMethod={paymentMethod}
          hasWeightItems={hasWeightItems}
          isDelivery={isDelivery}
          total={total}
          storeInfo={storeInfo}
        />
      </fieldset>

      <Field id={CHECKOUT_FIELD_IDS.replacementPolicy} label="Si algo falta o no está lindo">
        <select
          id={CHECKOUT_FIELD_IDS.replacementPolicy}
          value={values.replacementPolicy}
          onChange={(event) => {
            if (isReplacementPolicy(event.target.value)) form.setField('replacementPolicy', event.target.value);
          }}
        >
          {REPLACEMENT_POLICIES.map((policy) => (
            <option key={policy} value={policy}>{REPLACEMENT_POLICY_LABELS[policy]}</option>
          ))}
        </select>
      </Field>

      <Field id={CHECKOUT_FIELD_IDS.notes} label="Aclaraciones (opcional)">
        <textarea
          rows={3}
          maxLength={500}
          placeholder="Ej: tomates para ensalada, no muy maduros. Timbre 2B."
          {...form.getFieldProps('notes')}
        />
      </Field>
    </form>
  );
}

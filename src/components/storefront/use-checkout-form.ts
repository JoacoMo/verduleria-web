import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  isPaymentMethod,
  isReplacementPolicy,
  type DeliveryMethod,
  type PaymentMethod,
} from '@/lib/order-options';
import { STORAGE_KEYS, readStorage, writeStorage } from './storage';
import type { CustomerForm } from './types';

/** Campos que se validan (los demás no pueden estar mal). */
export type CheckoutField = 'customerName' | 'customerPhone' | 'customerAddress' | 'deliverySlot';

export type CheckoutErrors = Partial<Record<CheckoutField, string>>;

type TextField = 'customerName' | 'customerPhone' | 'customerAddress' | 'notes';

const EMPTY_CUSTOMER: CustomerForm = {
  customerName: '',
  customerPhone: '',
  customerAddress: '',
  notes: '',
  replacementPolicy: 'replace',
};

/** ids de los campos en el DOM (también los usa el formulario para el foco). */
export const CHECKOUT_FIELD_IDS: Record<CheckoutField | 'notes' | 'replacementPolicy', string> = {
  customerName: 'checkout-name',
  customerPhone: 'checkout-phone',
  customerAddress: 'checkout-address',
  deliverySlot: 'checkout-slot',
  notes: 'checkout-notes',
  replacementPolicy: 'checkout-replacement',
};

/** Orden en el que aparecen en pantalla: el foco va al primero que tenga error. */
const FIELD_ORDER: CheckoutField[] = ['customerName', 'customerPhone', 'customerAddress', 'deliverySlot'];

type StoredCustomer = Partial<CustomerForm> & { paymentMethod?: unknown; deliveryMethod?: unknown };

/**
 * Validación del paso de datos. Es la misma regla que aplica el servidor
 * (src/lib/validation.ts), repetida acá solo para avisar al instante: el que
 * decide sigue siendo el servidor.
 */
export function validateCheckout(
  values: CustomerForm,
  context: { isDelivery: boolean; hasSelectedSlot: boolean },
): CheckoutErrors {
  const errors: CheckoutErrors = {};

  const name = values.customerName.trim();
  if (!name) errors.customerName = 'Ingresá tu nombre.';
  else if (name.length < 2) errors.customerName = 'El nombre es muy corto.';

  const phoneDigits = values.customerPhone.replace(/\D/g, '');
  if (!phoneDigits) {
    errors.customerPhone = 'Ingresá un teléfono para coordinar el pedido.';
  } else if (phoneDigits.length < 8) {
    errors.customerPhone = 'Faltan números: poné el código de área (ej. 351 1234567).';
  } else if (phoneDigits.length > 15) {
    errors.customerPhone = 'El teléfono tiene demasiados números.';
  }

  if (context.isDelivery) {
    const address = values.customerAddress.trim();
    if (!address) errors.customerAddress = 'Ingresá la dirección de entrega.';
    else if (address.length < 5) errors.customerAddress = 'Completá la dirección: calle, número y barrio.';

    if (!context.hasSelectedSlot) errors.deliverySlot = 'Elegí un turno de entrega.';
  }

  return errors;
}

/**
 * Formulario de datos del cliente, con validación en tiempo real hecha a mano.
 *
 * Los errores se calculan siempre a partir de los valores, pero se muestran
 * recién cuando el cliente sale del campo (o cuando intenta confirmar): nadie
 * quiere ver "Ingresá tu nombre" en rojo antes de empezar a escribir. Una vez
 * visible, el error se actualiza mientras escribe y desaparece apenas el dato
 * queda bien.
 *
 * Nombre, teléfono, dirección y preferencias de entrega/pago se recuerdan en
 * localStorage para el próximo pedido.
 */
export function useCheckoutForm({ hasSelectedSlot }: { hasSelectedSlot: boolean }) {
  const [values, setValues] = useState<CustomerForm>(EMPTY_CUSTOMER);
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('pickup');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('transfer');
  const [touched, setTouched] = useState<Partial<Record<CheckoutField, boolean>>>({});

  useEffect(() => {
    const stored = readStorage<StoredCustomer>(STORAGE_KEYS.customer);
    if (!stored || typeof stored !== 'object') return;
    setValues((current) => ({
      ...current,
      customerName: typeof stored.customerName === 'string' ? stored.customerName : '',
      customerPhone: typeof stored.customerPhone === 'string' ? stored.customerPhone : '',
      customerAddress: typeof stored.customerAddress === 'string' ? stored.customerAddress : '',
      replacementPolicy: isReplacementPolicy(stored.replacementPolicy) ? stored.replacementPolicy : current.replacementPolicy,
    }));
    if (isPaymentMethod(stored.paymentMethod)) setPaymentMethod(stored.paymentMethod);
    if (stored.deliveryMethod === 'delivery' || stored.deliveryMethod === 'pickup') {
      setDeliveryMethod(stored.deliveryMethod);
    }
  }, []);

  const isDelivery = deliveryMethod === 'delivery';

  const errors = useMemo(
    () => validateCheckout(values, { isDelivery, hasSelectedSlot }),
    [values, isDelivery, hasSelectedSlot],
  );

  const visibleErrors = useMemo(() => {
    const visible: CheckoutErrors = {};
    for (const field of FIELD_ORDER) {
      if (touched[field] && errors[field]) visible[field] = errors[field];
    }
    return visible;
  }, [errors, touched]);

  const setField = useCallback(<K extends keyof CustomerForm>(field: K, value: CustomerForm[K]) => {
    setValues((current) => (current[field] === value ? current : { ...current, [field]: value }));
  }, []);

  const markTouched = useCallback((field: CheckoutField) => {
    setTouched((current) => (current[field] ? current : { ...current, [field]: true }));
  }, []);

  /**
   * Al tocar "Confirmar": muestra todos los errores y devuelve el primer campo
   * con problemas (para llevarle el foco), o null si está todo bien.
   */
  const validateAll = useCallback((): CheckoutField | null => {
    setTouched({ customerName: true, customerPhone: true, customerAddress: true, deliverySlot: true });
    return FIELD_ORDER.find((field) => errors[field]) ?? null;
  }, [errors]);

  /** Props de un campo de texto: valor, eventos y atributos de accesibilidad. */
  const getFieldProps = useCallback((field: TextField, options: { hintId?: string } = {}) => {
    const validated = field !== 'notes';
    const error = validated ? visibleErrors[field as CheckoutField] : undefined;
    const describedBy = [options.hintId, error ? `${CHECKOUT_FIELD_IDS[field]}-error` : null]
      .filter(Boolean)
      .join(' ');
    return {
      id: CHECKOUT_FIELD_IDS[field],
      name: field,
      value: values[field],
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setField(field, event.target.value),
      onBlur: validated ? () => markTouched(field as CheckoutField) : undefined,
      'aria-invalid': error ? (true as const) : undefined,
      'aria-describedby': describedBy || undefined,
    };
  }, [values, visibleErrors, setField, markTouched]);

  /** Después de un pedido exitoso: se recuerdan los datos y se limpian las aclaraciones. */
  const rememberAndReset = useCallback(() => {
    writeStorage(STORAGE_KEYS.customer, {
      customerName: values.customerName.trim(),
      customerPhone: values.customerPhone.trim(),
      customerAddress: values.customerAddress.trim(),
      replacementPolicy: values.replacementPolicy,
      paymentMethod,
      deliveryMethod,
    });
    setValues((current) => ({ ...current, notes: '' }));
    setTouched({});
  }, [values, paymentMethod, deliveryMethod]);

  return {
    values,
    deliveryMethod,
    paymentMethod,
    isDelivery,
    errors,
    visibleErrors,
    setField,
    setDeliveryMethod,
    setPaymentMethod,
    markTouched,
    validateAll,
    getFieldProps,
    rememberAndReset,
  };
}

export type CheckoutFormState = ReturnType<typeof useCheckoutForm>;

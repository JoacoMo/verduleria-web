/**
 * Opciones del pedido que elige el cliente en el checkout.
 */

/**
 * Qué hacer si al armar el pedido falta algo (o no está lindo).
 *
 * Es lo que preguntan todas las verdulerías online serias: el stock de fruta y
 * verdura cambia en el día y el cliente tiene que decidir de antemano, si no el
 * dueño termina llamando a cada uno.
 */
export const REPLACEMENT_POLICIES = ['replace', 'skip', 'call'] as const;

export type ReplacementPolicy = (typeof REPLACEMENT_POLICIES)[number];

export const REPLACEMENT_POLICY_LABELS: Record<ReplacementPolicy, string> = {
  replace: 'Reemplazar por uno similar',
  skip: 'No reemplazar, sacarlo del pedido',
  call: 'Llamarme o escribirme antes',
};

export function isReplacementPolicy(value: unknown): value is ReplacementPolicy {
  return typeof value === 'string' && (REPLACEMENT_POLICIES as readonly string[]).includes(value);
}

/**
 * Medios de pago. No hay cobro online: se paga por transferencia (cuando el
 * local confirma el total final, después de pesar) o en efectivo al recibir o
 * retirar.
 */
export const PAYMENT_METHODS = ['transfer', 'cash'] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  transfer: 'Transferencia',
  cash: 'Efectivo',
};

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value);
}

export const DELIVERY_METHODS = ['pickup', 'delivery'] as const;

export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

export const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = {
  pickup: 'Retiro en el local',
  delivery: 'Envío a domicilio',
};

export const ORDER_STATUSES = ['pending', 'paid', 'cancelled', 'failed'] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pendiente',
  paid: 'Pagado',
  cancelled: 'Cancelado',
  failed: 'Con problema',
};

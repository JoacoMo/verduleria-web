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

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  paid: 'Pagado',
  cancelled: 'Cancelado',
  failed: 'Pago rechazado',
};

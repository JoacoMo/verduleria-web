/**
 * Links de WhatsApp (wa.me).
 *
 * WhatsApp interpreta *texto* como negrita y _texto_ como cursiva, y respeta los
 * saltos de línea: los mensajes se arman como texto plano con esas marcas.
 */

/**
 * Número en formato internacional sin "+" para wa.me. Los teléfonos se guardan
 * solo con dígitos; si no traen el 54 del país se asume celular argentino
 * (549 + número sin el 0 inicial ni el 15).
 */
export function toWhatsappNumber(phone: string) {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('54')) return digits;
  return `549${digits.replace(/^0/, '')}`;
}

export function buildWhatsappUrl(phone: string, text?: string) {
  const base = `https://wa.me/${toWhatsappNumber(phone)}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/**
 * Links de WhatsApp (wa.me).
 *
 * WhatsApp interpreta *texto* como negrita y _texto_ como cursiva, y respeta los
 * saltos de línea: los mensajes se arman como texto plano con esas marcas.
 */

/**
 * Número en formato internacional sin "+" para wa.me.
 *
 * Los teléfonos se guardan solo con dígitos, escritos como los escribió el
 * cliente. Para un celular argentino, wa.me necesita 54 + 9 + código de área
 * (sin el 0) + número (sin el 15): 10 dígitos después del 549. Se cubren las
 * formas habituales: "351 612-3456", "0351 15 612-3456", "+54 351 6123456",
 * "+54 9 351 612-3456". Si el número no encaja en ninguna, se deja como vino.
 */
export function toWhatsappNumber(phone: string) {
  let digits = phone.replace(/\D/g, '');

  if (digits.startsWith('549')) {
    digits = digits.slice(3);
  } else if (digits.startsWith('54') && digits.length >= 12) {
    digits = digits.slice(2);
  }
  digits = digits.replace(/^0/, '');

  // Con el 15 de los celulares quedan 12 dígitos: el código de área tiene entre
  // 2 y 4 dígitos (11, 351, 3543), así que el 15 está en la posición 2, 3 o 4.
  if (digits.length === 12) {
    for (const areaLength of [4, 3, 2]) {
      if (digits.slice(areaLength, areaLength + 2) === '15') {
        digits = digits.slice(0, areaLength) + digits.slice(areaLength + 2);
        break;
      }
    }
  }

  return digits.length === 10 ? `549${digits}` : phone.replace(/\D/g, '');
}

export function buildWhatsappUrl(phone: string, text?: string) {
  const base = `https://wa.me/${toWhatsappNumber(phone)}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

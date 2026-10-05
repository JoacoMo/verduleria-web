import { describe, expect, it } from 'vitest';
import { buildWhatsappUrl, toWhatsappNumber } from './whatsapp';

describe('toWhatsappNumber', () => {
  it.each([
    ['3511234567', '5493511234567'],
    ['0351 123-4567', '5493511234567'],
    ['(0351) 1234567', '5493511234567'],
    ['5493511234567', '5493511234567'],
    ['+54 9 351 123 4567', '5493511234567'],
    ['11 2345-6789', '5491123456789'],
  ])('%s → %s', (phone, expected) => {
    expect(toWhatsappNumber(phone)).toBe(expected);
  });

  // BUG (severidad media): el comentario dice "549 + número sin el 0 inicial ni
  // el 15", pero solo se saca el 0. El checkout acepta "0351 15 612-3456"
  // (13 dígitos, entra en el rango 8-15) y el botón de WhatsApp del panel arma
  // wa.me/549351156123456, que no es el celular del cliente. Según las reglas de
  // WhatsApp para Argentina hay que sacar el 15 y poner 9 después del 54.
  it.fails('BUG: no saca el 15 de un celular escrito a la vieja usanza', () => {
    expect(toWhatsappNumber('0351 15 612-3456')).toBe('5493516123456');
  });

  // BUG (severidad media): "+54 351 612-3456" (sin el 9) se deja tal cual
  // ("543516123456"); wa.me necesita el 9 para los celulares argentinos.
  it.fails('BUG: con +54 pero sin el 9 no agrega el 9 de celular', () => {
    expect(toWhatsappNumber('+54 351 612-3456')).toBe('5493516123456');
  });
});

describe('buildWhatsappUrl', () => {
  it('sin texto, solo el número', () => {
    expect(buildWhatsappUrl('3511234567')).toBe('https://wa.me/5493511234567');
    expect(buildWhatsappUrl('3511234567', '')).toBe('https://wa.me/5493511234567');
  });

  it('el texto va codificado (saltos, *negritas*, &, ?, # y emojis)', () => {
    const text = '*Hola!* ¿Todo bien?\nTotal: $ 1.000 & envío #1 🥬';
    const url = buildWhatsappUrl('5493511234567', text);
    expect(url.startsWith('https://wa.me/5493511234567?text=')).toBe(true);
    const query = url.split('?text=')[1];
    expect(query).not.toMatch(/[\s&?#]/);
    expect(decodeURIComponent(query)).toBe(text);
    expect(new URL(url).searchParams.get('text')).toBe(text);
  });
});

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

  // Eran bugs: no se sacaba el 15 ni se agregaba el 9, y el botón del panel
  // armaba un wa.me a un número que no era el del cliente.
  it.each([
    ['0351 15 612-3456', '5493516123456'],
    ['+54 351 612-3456', '5493516123456'],
    ['+54 9 351 15 612-3456', '5493516123456'],
    ['011 15 5555-1234', '5491155551234'],
    ['03543 15 41-2345', '5493543412345'],
  ])('celular argentino escrito a la vieja usanza: %s → %s', (phone, expected) => {
    expect(toWhatsappNumber(phone)).toBe(expected);
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

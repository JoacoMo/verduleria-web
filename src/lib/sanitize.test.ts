import { describe, expect, it } from 'vitest';
import { sanitizeId, sanitizeNumber, sanitizeText, MAX_DB_INT } from './sanitize';

const code = (n: number) => String.fromCharCode(n);

describe('sanitizeText', () => {
  it('null si no es string (no lanza)', () => {
    for (const value of [undefined, null, 1, true, {}, ['a']]) {
      expect(sanitizeText(value, { maxLength: 10 })).toBeNull();
    }
  });

  it('recorta espacios y deja vacío como ""', () => {
    expect(sanitizeText('  hola  ', { maxLength: 10 })).toBe('hola');
    expect(sanitizeText('   ', { maxLength: 10 })).toBe('');
    expect(sanitizeText('', { maxLength: 10 })).toBe('');
  });

  it('saca caracteres de control (C0/C1, NUL, DEL) pero deja tab y saltos', () => {
    const dirty = `a${code(0)}b${code(7)}c${code(0x1b)}d${code(0x7f)}e${code(0x85)}f${code(0x9f)}g\th\ni\rj`;
    expect(sanitizeText(dirty, { maxLength: 100 })).toBe('abcdefg\th\ni\rj');
  });

  it('saca invisibles: zero-width, overrides de dirección y BOM', () => {
    const dirty = `${code(0xfeff)}To${code(0x200b)}ma${code(0x202e)}te${code(0x2060)}`;
    expect(sanitizeText(dirty, { maxLength: 100 })).toBe('Tomate');
  });

  it('singleLine colapsa cualquier espacio en blanco (saltos, tabs) a uno solo', () => {
    expect(sanitizeText(' Av.\n\tColón   123 \r\n', { maxLength: 100, singleLine: true })).toBe('Av. Colón 123');
  });

  it('normaliza a NFC (é compuesta y descompuesta quedan iguales)', () => {
    const decomposed = 'José';
    expect(decomposed.length).toBe(5);
    expect(sanitizeText(decomposed, { maxLength: 10 })).toBe('José');
    expect(sanitizeText(decomposed, { maxLength: 10 })?.length).toBe(4);
  });

  it('corta al largo máximo y vuelve a recortar espacios', () => {
    expect(sanitizeText('abcdef', { maxLength: 3 })).toBe('abc');
    expect(sanitizeText('ab   cdef', { maxLength: 4 })).toBe('ab');
  });

  it('el largo se mide después de limpiar', () => {
    expect(sanitizeText(`${code(0x200b).repeat(50)}abc`, { maxLength: 3 })).toBe('abc');
  });

  // Era un bug: el corte por largo usaba slice() sobre unidades UTF-16 y dejaba
  // medio emoji suelto; Prisma no lo puede guardar y el checkout daba 500.
  it('cortar en medio de un emoji no deja un surrogate suelto', () => {
    const result = sanitizeText(`${'a'.repeat(9)}🍅`, { maxLength: 10 }) ?? '';
    expect(result.isWellFormed()).toBe(true);
    expect(result).toBe('a'.repeat(9));
  });

  it('saca surrogates sueltos que vengan en el JSON y deja los emojis enteros', () => {
    expect(sanitizeText('hola \ud83d chau 🍅', { maxLength: 50 })).toBe('hola  chau 🍅');
  });

  it('saca aislamientos bidi (Trojan Source), rellenos Hangul, soft hyphen y tags Unicode', () => {
    expect(sanitizeText(`${code(0x2066)}a${code(0x2069)}${code(0x3164)}b${code(0xad)}c\u{E0041}`, { maxLength: 50 })).toBe('abc');
  });
});

describe('sanitizeNumber', () => {
  const range = { min: 0, max: 100 };

  it('números y strings numéricos dentro del rango (bordes inclusivos)', () => {
    expect(sanitizeNumber(0, range)).toBe(0);
    expect(sanitizeNumber(100, range)).toBe(100);
    expect(sanitizeNumber('42', range)).toBe(42);
    expect(sanitizeNumber(' 42 ', range)).toBe(42);
    expect(sanitizeNumber('4.5', range)).toBe(4.5);
  });

  it('fuera de rango → null', () => {
    expect(sanitizeNumber(-0.01, range)).toBeNull();
    expect(sanitizeNumber(100.01, range)).toBeNull();
    expect(sanitizeNumber('-1', range)).toBeNull();
  });

  it('NaN, Infinity, vacíos y tipos que no son número/string → null', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '', '   ', 'abc', '1,5', 'Infinity', 'NaN', null, undefined, true, false, {}, [], [5]]) {
      expect(sanitizeNumber(value, range), JSON.stringify(value)).toBeNull();
    }
  });

  it('redondea a los decimales pedidos', () => {
    expect(sanitizeNumber(12.3456, { ...range, decimals: 2 })).toBe(12.35);
    expect(sanitizeNumber('12.3', { ...range, decimals: 0 })).toBe(12);
  });

  it('en strings solo decimales comunes: nada de hexadecimal, binario ni exponentes', () => {
    // Number() los aceptaba: "0x10" como precio se guardaba como 16 sin dar error.
    for (const value of ['1e2', '0x10', '0b11', '0o7', 'Infinity', '1_000']) {
      expect(sanitizeNumber(value, range), value).toBeNull();
    }
    // Un número JSON 1e2 sigue entrando: es el número 100.
    expect(sanitizeNumber(1e2, range)).toBe(100);
    expect(sanitizeNumber(' .5 ', range)).toBe(0.5);
  });
});

describe('sanitizeId', () => {
  it('enteros positivos, también como string', () => {
    expect(sanitizeId(1)).toBe(1);
    expect(sanitizeId('42')).toBe(42);
    expect(sanitizeId(MAX_DB_INT)).toBe(MAX_DB_INT);
  });

  it('fuera del rango de un Int de Postgres → null (antes daba 500 en Prisma)', () => {
    expect(sanitizeId(MAX_DB_INT + 1)).toBeNull();
    expect(sanitizeId('3000000000')).toBeNull();
    expect(sanitizeId(Number.MAX_SAFE_INTEGER)).toBeNull();
  });

  it('cero, negativos, decimales, no numéricos y vacíos → null', () => {
    for (const value of [0, -1, 1.5, '1.5', 'abc', '', ' ', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, {}]) {
      expect(sanitizeId(value), String(value)).toBeNull();
    }
  });

  // Era un bug: Number() convertía true → 1 y [5] → 5, y {"id": true} pegaba en
  // el producto 1. Ahora un id es un número o un string de dígitos.
  it('rechaza booleanos, arrays y strings con hexadecimal o exponente', () => {
    for (const value of [true, false, [5], '0x16', '1e1', '+5']) {
      expect(sanitizeId(value), String(value)).toBeNull();
    }
  });
});

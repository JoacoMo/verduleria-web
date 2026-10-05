import { describe, expect, it } from 'vitest';
import { sanitizeId, sanitizeNumber, sanitizeText } from './sanitize';

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

  // BUG (severidad baja/media): el corte por largo usa slice() sobre unidades
  // UTF-16. Si en el borde cae un emoji (dos unidades), queda un "surrogate"
  // suelto: un string mal formado que después se guarda en la base y se manda
  // en el mensaje de WhatsApp como "�". Ver el test de integración del checkout
  // con notas de 500 caracteres.
  it.fails('BUG: cortar en medio de un emoji deja un surrogate suelto', () => {
    const result = sanitizeText(`${'a'.repeat(9)}🍅`, { maxLength: 10 }) ?? '';
    expect(result.isWellFormed()).toBe(true);
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

  it('comportamiento heredado de Number(): notación científica y hexadecimal se aceptan', () => {
    // No es un riesgo (el rango igual se aplica), pero conviene saberlo: "0x10"
    // como precio se guarda como 16.
    expect(sanitizeNumber('1e2', range)).toBe(100);
    expect(sanitizeNumber('0x10', range)).toBe(16);
  });
});

describe('sanitizeId', () => {
  it('enteros positivos, también como string', () => {
    expect(sanitizeId(1)).toBe(1);
    expect(sanitizeId('42')).toBe(42);
    expect(sanitizeId(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('cero, negativos, decimales, no numéricos y vacíos → null', () => {
    for (const value of [0, -1, 1.5, '1.5', 'abc', '', ' ', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, {}]) {
      expect(sanitizeId(value), String(value)).toBeNull();
    }
  });

  // BUG (severidad baja): Number() convierte true → 1 y [5] → 5, así que un
  // body como {"id": true} o {"id": [5]} se toma como el producto 1 o 5 (bulk,
  // ajuste de pedidos). Un id tendría que ser número o string de dígitos.
  it.fails('BUG: acepta booleanos y arrays como id (true → 1, [5] → 5)', () => {
    expect(sanitizeId(true)).toBeNull();
    expect(sanitizeId([5])).toBeNull();
  });
});

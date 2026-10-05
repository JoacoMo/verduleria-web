import { describe, expect, it } from 'vitest';
import { formatArs } from './format-price';
import {
  ItemValidationError,
  MAX_BULK_UPDATES,
  MAX_CART_LINES,
  ValidationError,
  assertOfferConsistency,
  checkDeliverySlot,
  detectImageType,
  endOfArgentinaDay,
  isValidCalendarDate,
  parseBulkProductUpdates,
  parseCheckoutCart,
  parseCustomerPayload,
  parseDeliveryMethod,
  parseIdempotencyKey,
  parseOfferEndsAt,
  parseOfferPrice,
  parseOrderAdjustment,
  parsePaymentMethod,
  parseProductPayload,
  resolveBulkUpdates,
  touchesPricing,
  type PricingState,
} from './validation';

// Lunes 5/10/2026, 12:00 en Córdoba.
const NOW = new Date('2026-10-05T15:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

/** Atrapa el error para mirar su clase y mensaje. */
function errorOf(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('Se esperaba que lanzara y no lanzó.');
}

describe('errores', () => {
  it('ItemValidationError es un ValidationError con posición', () => {
    const error = new ItemValidationError('mal', 3);
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ItemValidationError');
    expect(error.index).toBe(3);
    expect(new ValidationError('x').name).toBe('ValidationError');
  });
});

describe('fechas', () => {
  it('isValidCalendarDate: solo fechas que existen, con formato exacto', () => {
    for (const date of ['2026-10-05', '2026-02-28', '2028-02-29', '2000-02-29', '2026-12-31', '2026-01-01']) {
      expect(isValidCalendarDate(date), date).toBe(true);
    }
    for (const value of ['2026-02-29', '1900-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-10-00', '2026-1-1', ' 2026-01-01', '2026-01-01T00:00', '05/10/2026', '', 20261005, null, undefined, new Date()]) {
      expect(isValidCalendarDate(value), String(value)).toBe(false);
    }
  });

  it('endOfArgentinaDay: último milisegundo del día en Córdoba', () => {
    expect(endOfArgentinaDay('2026-10-05').toISOString()).toBe('2026-10-06T02:59:59.999Z');
    expect(endOfArgentinaDay('2026-12-31').toISOString()).toBe('2027-01-01T02:59:59.999Z');
  });
});

describe('parseOfferPrice', () => {
  it('undefined = no tocar; null o "" = sin oferta', () => {
    expect(parseOfferPrice(undefined)).toBeUndefined();
    expect(parseOfferPrice(null)).toBeNull();
    expect(parseOfferPrice('')).toBeNull();
  });

  it('números y strings numéricos, a centavos', () => {
    expect(parseOfferPrice(800)).toBe(800);
    expect(parseOfferPrice('800')).toBe(800);
    expect(parseOfferPrice(800.456)).toBe(800.46);
  });

  // Una oferta de $ 0 es un error de carga (pedidos gratis), no un regalo.
  it.each([0, 0.001, -0, -1, 'abc', '0x10', '1e3', Number.NaN, Number.POSITIVE_INFINITY, 10_000_001, true, '   ', {}, []])('rechaza %s', (value) => {
    const error = errorOf(() => parseOfferPrice(value));
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toBe(`El precio de oferta debe ser mayor a 0 y hasta ${formatArs(10_000_000)}. Para sacar la oferta, dejalo vacío.`);
  });
});

describe('parseOfferEndsAt', () => {
  it('undefined = no tocar; null o "" = sin vencimiento', () => {
    expect(parseOfferEndsAt(undefined, NOW)).toBeUndefined();
    expect(parseOfferEndsAt(null, NOW)).toBeNull();
    expect(parseOfferEndsAt('', NOW)).toBeNull();
  });

  it('vence al terminar ese día en Córdoba (hoy incluido)', () => {
    expect(parseOfferEndsAt('2026-10-05', NOW)?.toISOString()).toBe('2026-10-06T02:59:59.999Z');
    expect(parseOfferEndsAt(' 2026-10-11 ', NOW)?.toISOString()).toBe('2026-10-12T02:59:59.999Z');
  });

  it('hoy a las 23:59 de Córdoba todavía se puede poner "hasta hoy"', () => {
    expect(parseOfferEndsAt('2026-10-05', new Date('2026-10-06T02:59:00Z'))).toBeInstanceOf(Date);
  });

  it('fecha pasada', () => {
    expect(errorOf(() => parseOfferEndsAt('2026-10-04', NOW)).message).toBe('La fecha de vencimiento de la oferta ya pasó.');
  });

  it('fecha inexistente', () => {
    expect(errorOf(() => parseOfferEndsAt('2026-02-30', NOW)).message).toBe('La fecha de vencimiento de la oferta no existe. Revisala.');
    expect(errorOf(() => parseOfferEndsAt('2026-11-31', NOW)).message).toMatch(/no existe/);
  });

  it.each(['05/10/2026', '2026-10-5', '2026-10-05T10:00', 20261010, true, {}])('formato inválido: %s', (value) => {
    expect(errorOf(() => parseOfferEndsAt(value, NOW)).message).toBe('La fecha de vencimiento de la oferta tiene que tener el formato AAAA-MM-DD.');
  });

  it('hasta 366 días para adelante', () => {
    expect(parseOfferEndsAt('2027-10-05', NOW)).toBeInstanceOf(Date);
    expect(errorOf(() => parseOfferEndsAt('2027-10-06', NOW)).message).toMatch(/no puede durar más de un año/);
    expect(errorOf(() => parseOfferEndsAt('2062-10-06', NOW)).message).toMatch(/no puede durar más de un año/);
  });
});

describe('parseProductPayload (crear)', () => {
  const base = { name: 'Tomate perita', price: 1500, unit: 'kg', category: 'Verduras' };

  it('normaliza un producto completo con los defaults', () => {
    expect(parseProductPayload(base, { now: NOW })).toEqual({
      name: 'Tomate perita',
      price: 1500,
      image: '',
      unit: 'kg',
      category: 'Verduras',
      description: null,
      offerPrice: null,
      offerEndsAt: null,
      available: true,
    });
  });

  it('ignora campos extra (id, createdAt, etc.)', () => {
    const data = parseProductPayload({ ...base, id: 99, createdAt: 'ayer', updatedAt: 1, isAdmin: true }, { now: NOW });
    expect(Object.keys(data).sort()).toEqual(['available', 'category', 'description', 'image', 'name', 'offerEndsAt', 'offerPrice', 'price', 'unit']);
  });

  it('body que no es objeto se trata como vacío', () => {
    for (const body of [null, undefined, 'texto', 42, true]) {
      expect(errorOf(() => parseProductPayload(body, { now: NOW })).message).toBe('El nombre del producto es obligatorio.');
    }
  });

  it('nombre: obligatorio, limpio, en una línea y hasta 120 caracteres', () => {
    expect(errorOf(() => parseProductPayload({ ...base, name: '   ' })).message).toBe('El nombre del producto es obligatorio.');
    expect(errorOf(() => parseProductPayload({ ...base, name: 123 })).message).toBe('El nombre del producto es obligatorio.');
    expect(parseProductPayload({ ...base, name: ' Papa\n\tnegra​ ' }).name).toBe('Papa negra');
    expect(parseProductPayload({ ...base, name: 'x'.repeat(200) }).name).toHaveLength(120);
  });

  it('precio: string numérico ok, redondeo a centavos', () => {
    expect(parseProductPayload({ ...base, price: '1500' }).price).toBe(1500);
    expect(parseProductPayload({ ...base, price: 999.999 }).price).toBe(1000);
  });

  // $ 0 (o algo que redondea a 0) es siempre un error de tipeo; hex y exponentes
  // en strings tampoco: Number() los aceptaba y guardaba otro precio.
  it.each([undefined, null, '', 'mil', 0, 0.001, -0, -1, '0x10', '1e3', Number.NaN, Number.POSITIVE_INFINITY, 10_000_001, true, [1500]])('precio inválido: %s', (price) => {
    expect(errorOf(() => parseProductPayload({ ...base, price })).message).toBe(`El precio debe ser un número mayor a 0 y hasta ${formatArs(10_000_000)}.`);
  });

  it('nombre: tiene que tener letras o números (no solo invisibles o símbolos)', () => {
    expect(errorOf(() => parseProductPayload({ ...base, name: '\u2066\u2069' })).message).toBe('El nombre del producto es obligatorio.');
    expect(errorOf(() => parseProductPayload({ ...base, name: '\u3164\u3164' })).message).toBe('El nombre del producto es obligatorio.');
    expect(errorOf(() => parseProductPayload({ ...base, name: '***' })).message).toBe('El nombre del producto es obligatorio.');
    expect(parseProductPayload({ ...base, name: 'Ñandú 2' }).name).toBe('Ñandú 2');
  });

  it('unidad y categoría de las listas', () => {
    expect(errorOf(() => parseProductPayload({ ...base, unit: 'litro' })).message).toBe('La unidad debe ser kg, g, unidad, atado o bandeja.');
    expect(errorOf(() => parseProductPayload({ ...base, unit: undefined })).message).toMatch(/La unidad debe ser/);
    expect(errorOf(() => parseProductPayload({ ...base, category: 'Carnes' })).message).toBe('La categoría debe ser Bolsones, Frutas, Verduras, Almacén u Ofertas.');
  });

  it('imagen: http(s) o ruta propia; nada de javascript:, data: ni //otro-dominio', () => {
    expect(parseProductPayload({ ...base, image: '/product-placeholder.svg' }).image).toBe('/product-placeholder.svg');
    expect(parseProductPayload({ ...base, image: 'HTTPS://Ejemplo.com/a b.png' }).image).toBe('https://ejemplo.com/a%20b.png');
    expect(parseProductPayload({ ...base, image: '  ' }).image).toBe('');
    expect(parseProductPayload({ ...base, image: 42 }).image).toBe('');
    expect(errorOf(() => parseProductPayload({ ...base, image: 'javascript:alert(1)' })).message).toBe('La imagen solo puede ser una URL http o https.');
    expect(errorOf(() => parseProductPayload({ ...base, image: 'data:text/html,<script>alert(1)</script>' })).message).toMatch(/solo puede ser una URL http o https/);
    expect(errorOf(() => parseProductPayload({ ...base, image: '//evil.example/x.png' })).message).toMatch(/archivo del propio sitio/);
    // El navegador convierte "/\\host" en "//host": tampoco es una ruta propia.
    expect(errorOf(() => parseProductPayload({ ...base, image: '/\\evil.example/x.png' })).message).toMatch(/archivo del propio sitio/);
    expect(parseProductPayload({ ...base, image: '/fotos/../product-placeholder.svg' }).image).toBe('/product-placeholder.svg');
    expect(errorOf(() => parseProductPayload({ ...base, image: 'foto.png' })).message).toMatch(/URL válida/);
  });

  it('descripción: saltos normalizados, sin más de una línea en blanco, hasta 500', () => {
    expect(parseProductPayload({ ...base, description: 'Papa  \r\nCebolla\r\n\r\n\r\n\r\nZanahoria' }).description).toBe('Papa\nCebolla\n\nZanahoria');
    expect(parseProductPayload({ ...base, description: '   ' }).description).toBeNull();
    expect(parseProductPayload({ ...base, description: null }).description).toBeNull();
    expect(parseProductPayload({ ...base, description: 'x'.repeat(500) }).description).toHaveLength(500);
    expect(errorOf(() => parseProductPayload({ ...base, description: 'x'.repeat(501) })).message).toBe('La descripción puede tener hasta 500 caracteres (tiene 501).');
    expect(errorOf(() => parseProductPayload({ ...base, description: 5 })).message).toBe('La descripción tiene que ser texto.');
  });

  it('disponibilidad: boolean estricto, por defecto true', () => {
    expect(parseProductPayload({ ...base, available: false }).available).toBe(false);
    expect(errorOf(() => parseProductPayload({ ...base, available: 'false' })).message).toBe('La disponibilidad debe ser verdadero o falso.');
    expect(errorOf(() => parseProductPayload({ ...base, available: 0 })).message).toMatch(/disponibilidad/);
  });

  it('oferta: menor al precio, con vencimiento opcional', () => {
    const data = parseProductPayload({ ...base, offerPrice: 1200, offerEndsAt: '2026-10-11' }, { now: NOW });
    expect(data.offerPrice).toBe(1200);
    expect(data.offerEndsAt?.toISOString()).toBe('2026-10-12T02:59:59.999Z');
  });

  it('oferta igual o mayor al precio → 400', () => {
    expect(errorOf(() => parseProductPayload({ ...base, offerPrice: 1500 }, { now: NOW })).message).toBe(
      `El precio de oferta (${formatArs(1500)}) tiene que ser menor que el precio normal (${formatArs(1500)}).`,
    );
    expect(errorOf(() => parseProductPayload({ ...base, offerPrice: '2000' }, { now: NOW }))).toBeInstanceOf(ValidationError);
  });

  it('sin precio de oferta, el vencimiento se descarta (aunque sea una fecha pasada)', () => {
    const data = parseProductPayload({ ...base, offerPrice: null, offerEndsAt: '2020-01-01' }, { now: NOW });
    expect(data.offerPrice).toBeNull();
    expect(data.offerEndsAt).toBeNull();
  });
});

describe('parseProductPayload (editar, parcial)', () => {
  it('solo devuelve lo que vino', () => {
    expect(parseProductPayload({}, { partial: true, now: NOW })).toEqual({});
    expect(parseProductPayload({ price: '850' }, { partial: true, now: NOW })).toEqual({ price: 850 });
    expect(parseProductPayload({ available: false }, { partial: true, now: NOW })).toEqual({ available: false });
  });

  it('offerPrice null saca también el vencimiento', () => {
    expect(parseProductPayload({ offerPrice: null }, { partial: true, now: NOW })).toEqual({ offerPrice: null, offerEndsAt: null });
  });

  it('puede venir solo el vencimiento (la regla contra lo guardado la aplica el handler)', () => {
    const data = parseProductPayload({ offerEndsAt: '2026-10-10' }, { partial: true, now: NOW });
    expect(Object.keys(data)).toEqual(['offerEndsAt']);
  });

  it('no compara oferta contra precio: eso se hace con assertOfferConsistency', () => {
    expect(parseProductPayload({ price: 100, offerPrice: 500 }, { partial: true, now: NOW })).toEqual({ price: 100, offerPrice: 500 });
  });

  it('un campo presente se valida igual que al crear', () => {
    expect(errorOf(() => parseProductPayload({ name: '' }, { partial: true }))).toBeInstanceOf(ValidationError);
    expect(errorOf(() => parseProductPayload({ unit: 'litro' }, { partial: true }))).toBeInstanceOf(ValidationError);
    expect(errorOf(() => parseProductPayload({ available: 'si' }, { partial: true }))).toBeInstanceOf(ValidationError);
    expect(errorOf(() => parseProductPayload({ price: null }, { partial: true }))).toBeInstanceOf(ValidationError);
  });
});

describe('touchesPricing / assertOfferConsistency', () => {
  const saved = (overrides: Partial<PricingState> = {}): PricingState => ({ price: 1000, offerPrice: null, offerEndsAt: null, ...overrides });

  it('touchesPricing', () => {
    expect(touchesPricing({})).toBe(false);
    expect(touchesPricing({ price: 1 })).toBe(true);
    expect(touchesPricing({ offerPrice: null })).toBe(true);
    expect(touchesPricing({ offerEndsAt: null })).toBe(true);
  });

  it('solo la oferta: se compara con el precio guardado', () => {
    expect(() => assertOfferConsistency({ offerPrice: 900 }, saved(), NOW)).not.toThrow();
    expect(errorOf(() => assertOfferConsistency({ offerPrice: 1000 }, saved(), NOW)).message).toMatch(/tiene que ser menor que el precio normal/);
  });

  it('solo el precio: choca con una oferta vigente', () => {
    const current = saved({ offerPrice: 800, offerEndsAt: new Date(NOW.getTime() + DAY) });
    expect(errorOf(() => assertOfferConsistency({ price: 800 }, current, NOW)).message).toBe(
      `El precio nuevo (${formatArs(800)}) tiene que ser mayor que el de la oferta vigente (${formatArs(800)}). Cambiá o sacá la oferta.`,
    );
    expect(() => assertOfferConsistency({ price: 801 }, current, NOW)).not.toThrow();
  });

  it('solo el precio: una oferta vencida no frena el cambio', () => {
    const current = saved({ offerPrice: 800, offerEndsAt: new Date(NOW.getTime() - 1) });
    expect(() => assertOfferConsistency({ price: 500 }, current, NOW)).not.toThrow();
  });

  it('oferta sin vencimiento cuenta como vigente', () => {
    expect(() => assertOfferConsistency({ price: 700 }, saved({ offerPrice: 800 }), NOW)).toThrow(ValidationError);
  });

  it('precio y oferta juntos: se comparan entre sí', () => {
    expect(() => assertOfferConsistency({ price: 2000, offerPrice: 1500 }, saved({ offerPrice: 800 }), NOW)).not.toThrow();
    expect(() => assertOfferConsistency({ price: 1000, offerPrice: 1500 }, saved(), NOW)).toThrow(ValidationError);
  });

  it('vencimiento sin precio de oferta (ni nuevo ni guardado)', () => {
    expect(errorOf(() => assertOfferConsistency({ offerEndsAt: new Date(NOW.getTime() + DAY) }, saved(), NOW)).message).toBe(
      'Para ponerle vencimiento a la oferta, cargá también el precio de oferta.',
    );
  });

  it('sacar la oferta siempre se puede', () => {
    expect(() => assertOfferConsistency({ offerPrice: null, offerEndsAt: null }, saved({ offerPrice: 800 }), NOW)).not.toThrow();
  });

  it('sin precio en ningún lado es un error de programación (no de validación)', () => {
    const error = errorOf(() => assertOfferConsistency({ offerPrice: 1 }, null, NOW));
    expect(error).not.toBeInstanceOf(ValidationError);
  });
});

describe('parseBulkProductUpdates', () => {
  it('forma general', () => {
    for (const payload of [null, {}, { updates: [] }, { updates: 'x' }, []]) {
      expect(errorOf(() => parseBulkProductUpdates(payload, NOW)).message).toBe('Mandá "updates" con al menos una actualización.');
    }
    const tooMany = { updates: Array.from({ length: MAX_BULK_UPDATES + 1 }, (_, i) => ({ id: i + 1, price: 1 })) };
    expect(errorOf(() => parseBulkProductUpdates(tooMany, NOW)).message).toBe(
      `Se pueden actualizar hasta ${MAX_BULK_UPDATES} productos por vez (vinieron ${MAX_BULK_UPDATES + 1}).`,
    );
  });

  it('normaliza cada ítem', () => {
    const updates = parseBulkProductUpdates(
      {
        updates: [
          { id: 1, price: '1200.555' },
          { id: '2', available: false },
          { id: 3, offerPrice: null, offerEndsAt: '2020-01-01' },
          { id: 4, offerPrice: 500, offerEndsAt: '2026-10-10' },
        ],
      },
      NOW,
    );
    expect(updates).toEqual([
      { id: 1, data: { price: 1200.56 } },
      { id: 2, data: { available: false } },
      { id: 3, data: { offerPrice: null, offerEndsAt: null } },
      { id: 4, data: { offerPrice: 500, offerEndsAt: new Date('2026-10-11T02:59:59.999Z') } },
    ]);
  });

  it.each([
    [[{ id: 1, price: 1 }, 'x'], 1, 'Ítem 2: Cada actualización tiene que ser un objeto con "id".'],
    [[[1, 2]], 0, 'Ítem 1: Cada actualización tiene que ser un objeto con "id".'],
    [[{ price: 1 }], 0, 'Ítem 1: Falta el id del producto o no es un número entero positivo.'],
    [[{ id: -4, price: 1 }], 0, 'Ítem 1: Falta el id del producto o no es un número entero positivo.'],
    [[{ id: 1 }], 0, 'Ítem 1 (producto 1): No trae ningún cambio (price, available, offerPrice u offerEndsAt).'],
    [[{ id: 1, nombre: 'x' }], 0, 'Ítem 1 (producto 1): No trae ningún cambio (price, available, offerPrice u offerEndsAt).'],
    [[{ id: 7, price: 'caro' }], 0, `Ítem 1 (producto 7): El precio debe ser un número mayor a 0 y hasta ${formatArs(10_000_000)}.`],
    [[{ id: 7, available: 'no' }], 0, 'Ítem 1 (producto 7): La disponibilidad debe ser verdadero o falso.'],
    [[{ id: 7, offerEndsAt: '2026-02-30' }], 0, 'Ítem 1 (producto 7): La fecha de vencimiento de la oferta no existe. Revisala.'],
    [[{ id: 5, price: 1 }, { id: 6, price: 1 }, { id: 5, price: 2 }], 2, 'Ítem 3 (producto 5): El mismo producto viene dos veces.'],
  ])('ítem inválido %#: corta todo e informa la posición', (updates, index, message) => {
    const error = errorOf(() => parseBulkProductUpdates({ updates }, NOW));
    expect(error).toBeInstanceOf(ItemValidationError);
    expect((error as ItemValidationError).index).toBe(index);
    expect(error.message).toBe(message);
  });
});

describe('resolveBulkUpdates', () => {
  const current = new Map<number, PricingState>([
    [1, { price: 1000, offerPrice: null, offerEndsAt: null }],
    [2, { price: 2000, offerPrice: 1500, offerEndsAt: null }],
  ]);

  it('separa los que no existen y deja escribir el resto', () => {
    const updates = parseBulkProductUpdates({ updates: [{ id: 1, price: 1100 }, { id: 99, price: 1 }, { id: 2, price: 1600 }] }, NOW);
    const resolved = resolveBulkUpdates(updates, current, NOW);
    expect(resolved.notFound).toEqual([99]);
    expect(resolved.writes.map((write) => write.id)).toEqual([1, 2]);
  });

  it('un precio que queda por debajo de la oferta vigente frena todo, con la posición', () => {
    const updates = parseBulkProductUpdates({ updates: [{ id: 1, price: 1100 }, { id: 2, price: 1500 }] }, NOW);
    const error = errorOf(() => resolveBulkUpdates(updates, current, NOW));
    expect(error).toBeInstanceOf(ItemValidationError);
    expect((error as ItemValidationError).index).toBe(1);
    expect(error.message).toMatch(/^Ítem 2 \(producto 2\): El precio nuevo/);
  });

  it('oferta >= precio guardado', () => {
    const updates = parseBulkProductUpdates({ updates: [{ id: 1, offerPrice: 1000 }] }, NOW);
    expect(errorOf(() => resolveBulkUpdates(updates, current, NOW)).message).toMatch(/^Ítem 1 \(producto 1\): El precio de oferta/);
  });
});

describe('parseCustomerPayload', () => {
  const valid = { customerName: ' Ana  Pérez ', customerPhone: '(0351) 156-123456', customerAddress: ' Av. Colón 123 ', notes: ' Timbre 2B ', replacementPolicy: 'skip' };

  it('retiro: limpia y no guarda dirección', () => {
    expect(parseCustomerPayload(valid, { isDelivery: false })).toEqual({
      customerName: 'Ana Pérez',
      customerPhone: '0351156123456',
      customerAddress: null,
      notes: 'Timbre 2B',
      replacementPolicy: 'skip',
    });
  });

  it('envío: la dirección es obligatoria (mínimo 5 caracteres)', () => {
    expect(parseCustomerPayload(valid, { isDelivery: true }).customerAddress).toBe('Av. Colón 123');
    for (const customerAddress of [undefined, null, '', '   ', 'Av 1', 123]) {
      expect(errorOf(() => parseCustomerPayload({ ...valid, customerAddress }, { isDelivery: true })).message).toBe(
        'Para el envío necesitamos la dirección (calle, número y barrio).',
      );
    }
  });

  it('nombre obligatorio de al menos 2 caracteres', () => {
    for (const customerName of [undefined, null, '', ' ', 'A', 42]) {
      expect(errorOf(() => parseCustomerPayload({ ...valid, customerName }, { isDelivery: false })).message).toBe(
        'Ingresá tu nombre para saber de quién es el pedido.',
      );
    }
    expect(parseCustomerPayload({ ...valid, customerName: 'x'.repeat(200) }, { isDelivery: false }).customerName).toHaveLength(80);
  });

  it('teléfono: solo dígitos, entre 8 y 15', () => {
    expect(parseCustomerPayload({ ...valid, customerPhone: '+54 9 351 123-4567' }, { isDelivery: false }).customerPhone).toBe('5493511234567');
    expect(parseCustomerPayload({ ...valid, customerPhone: '12345678' }, { isDelivery: false }).customerPhone).toBe('12345678');
    for (const customerPhone of ['1234567', '1234567890123456', 'sin teléfono', '', undefined, 3511234567]) {
      expect(errorOf(() => parseCustomerPayload({ ...valid, customerPhone }, { isDelivery: false })).message).toBe(
        'Ingresá un teléfono válido (con código de área, sin el 15).',
      );
    }
  });

  it('notas opcionales (recortadas a 500) y política de reemplazo por defecto', () => {
    const data = parseCustomerPayload({ ...valid, notes: '   ', replacementPolicy: 'cualquiera' }, { isDelivery: false });
    expect(data.notes).toBeNull();
    expect(data.replacementPolicy).toBe('replace');
    expect(parseCustomerPayload({ ...valid, notes: 'n'.repeat(900) }, { isDelivery: false }).notes).toHaveLength(500);
  });

  it('payload que no es objeto', () => {
    expect(errorOf(() => parseCustomerPayload(null, { isDelivery: false })).message).toMatch(/Ingresá tu nombre/);
    expect(errorOf(() => parseCustomerPayload('Ana', { isDelivery: false })).message).toMatch(/Ingresá tu nombre/);
  });
});

describe('parseDeliveryMethod / parsePaymentMethod / parseIdempotencyKey', () => {
  it('método de entrega, con compatibilidad para pestañas viejas (isDelivery)', () => {
    expect(parseDeliveryMethod({ deliveryMethod: 'pickup' })).toBe('pickup');
    expect(parseDeliveryMethod({ deliveryMethod: 'delivery' })).toBe('delivery');
    expect(parseDeliveryMethod({})).toBe('pickup');
    expect(parseDeliveryMethod({ deliveryMethod: null, isDelivery: true })).toBe('delivery');
    expect(parseDeliveryMethod({ isDelivery: 'true' })).toBe('pickup');
    expect(parseDeliveryMethod({ deliveryMethod: 'pickup', isDelivery: true })).toBe('pickup');
    for (const deliveryMethod of ['envio', '', 1, true, 'DELIVERY']) {
      expect(errorOf(() => parseDeliveryMethod({ deliveryMethod })).message).toBe('Elegí si retirás en el local o te lo enviamos.');
    }
  });

  it('medio de pago: transferencia por defecto, el resto se rechaza', () => {
    expect(parsePaymentMethod(undefined)).toBe('transfer');
    expect(parsePaymentMethod(null)).toBe('transfer');
    expect(parsePaymentMethod('cash')).toBe('cash');
    for (const value of ['mercadopago', 'card', '', 'TRANSFER', 1]) {
      expect(errorOf(() => parsePaymentMethod(value)).message).toBe('Elegí cómo vas a pagar: transferencia o efectivo.');
    }
  });

  it('clave de idempotencia: 16 a 100 caracteres seguros', () => {
    expect(parseIdempotencyKey('3f2b8c1e-9d4a-4f6b-8e2a-1c5d7e9f0a1b')).toBe('3f2b8c1e-9d4a-4f6b-8e2a-1c5d7e9f0a1b');
    expect(parseIdempotencyKey('  abcdefghijklmnop  ')).toBe('abcdefghijklmnop');
    expect(parseIdempotencyKey('a'.repeat(100))).toHaveLength(100);
    for (const value of ['1234', 'a'.repeat(15), 'a'.repeat(101), 'abcdefgh ijklmnop', 'abcdefghijklmnop;', 'ñandú-ñandú-ñandú', undefined, null, 1234567890123456789]) {
      expect(errorOf(() => parseIdempotencyKey(value)).message).toBe('No pudimos identificar el pedido. Recargá la página y probá de nuevo.');
    }
  });
});

describe('checkDeliverySlot', () => {
  it('retiro: no hay turno, se ignora lo que venga', () => {
    expect(checkDeliverySlot('cualquier cosa', 'pickup', NOW)).toEqual({ ok: true, slot: null });
  });

  it('envío con turno vigente', () => {
    const result = checkDeliverySlot('2026-10-05T13', 'delivery', NOW);
    expect(result).toMatchObject({ ok: true, slot: { id: '2026-10-05T13', label: 'Hoy de 13 a 14 h' } });
  });

  it('envío sin turno o con uno que ya pasó: mensaje y turnos que quedan', () => {
    const missing = checkDeliverySlot(undefined, 'delivery', NOW);
    expect(missing).toMatchObject({ ok: false, message: 'Elegí un turno de entrega.' });
    const past = checkDeliverySlot('2026-10-04T19', 'delivery', NOW);
    expect(past).toMatchObject({ ok: false, message: 'El turno que elegiste ya no está disponible. Elegí otro.' });
    if (!past.ok) expect(past.availableSlots.map((slot) => slot.id)).toEqual(['2026-10-05T13', '2026-10-05T19', '2026-10-06T13', '2026-10-06T19']);
    expect(checkDeliverySlot('', 'delivery', NOW)).toMatchObject({ ok: false, message: 'Elegí un turno de entrega.' });
  });
});

describe('parseCheckoutCart', () => {
  it('vacío o que no es lista', () => {
    for (const value of [undefined, null, {}, 'x', []]) {
      expect(errorOf(() => parseCheckoutCart(value)).message).toBe('El carrito está vacío.');
    }
  });

  it(`hasta ${MAX_CART_LINES} líneas`, () => {
    expect(parseCheckoutCart(Array.from({ length: MAX_CART_LINES }, (_, i) => ({ id: i + 1, quantity: 1 })))).toHaveLength(MAX_CART_LINES);
    expect(errorOf(() => parseCheckoutCart(Array.from({ length: MAX_CART_LINES + 1 }, () => ({})))).message).toBe('El carrito tiene demasiados productos.');
  });

  it('descarta lo que no es objeto', () => {
    expect(parseCheckoutCart([null, 1, 'a', [1], { id: 1, quantity: 2 }])).toEqual([{ id: 1, quantity: 2 }]);
  });
});

describe('parseOrderAdjustment', () => {
  it('lista de { id, quantity }', () => {
    expect(parseOrderAdjustment({ items: [{ id: 1, quantity: 1.35 }, { id: '2', quantity: '0' }] })).toEqual([
      { id: 1, quantity: 1.35 },
      { id: 2, quantity: 0 },
    ]);
    expect(parseOrderAdjustment({ items: [] })).toEqual([]);
  });

  it('errores de forma', () => {
    for (const payload of [null, {}, { items: 'x' }]) {
      expect(errorOf(() => parseOrderAdjustment(payload)).message).toBe('Mandá la lista de productos del pedido con sus cantidades.');
    }
    expect(errorOf(() => parseOrderAdjustment({ items: Array.from({ length: 101 }, (_, i) => ({ id: i + 1, quantity: 1 })) })).message).toBe('El pedido tiene demasiados productos.');
    expect(errorOf(() => parseOrderAdjustment({ items: [null] })).message).toBe('Hay un producto sin id válido.');
    expect(errorOf(() => parseOrderAdjustment({ items: [{ id: 1.5, quantity: 1 }] })).message).toBe('Hay un producto sin id válido.');
    expect(errorOf(() => parseOrderAdjustment({ items: [{ id: 1, quantity: 1 }, { id: 1, quantity: 2 }] })).message).toBe('Un producto aparece dos veces en el ajuste.');
  });

  it.each([-1, 'mucho', Number.NaN, Number.POSITIVE_INFINITY, 1_000_001, null, undefined])('cantidad inválida: %s', (quantity) => {
    expect(errorOf(() => parseOrderAdjustment({ items: [{ id: 1, quantity }] })).message).toBe(
      'La cantidad de cada producto tiene que ser un número mayor o igual a 0.',
    );
  });
});

describe('detectImageType', () => {
  const bytes = (...values: number[]) => new Uint8Array(values);
  const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

  it('reconoce JPEG, PNG y WebP por sus primeros bytes', () => {
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe('image/png');
    expect(detectImageType(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBP')))).toBe('image/webp');
  });

  it('cualquier otra cosa → null', () => {
    expect(detectImageType(bytes())).toBeNull();
    expect(detectImageType(bytes(0xff, 0xd8))).toBeNull();
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(detectImageType(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WAVE')))).toBeNull();
    expect(detectImageType(bytes(...ascii('GIF89a')))).toBeNull();
    expect(detectImageType(bytes(...ascii('<svg xmlns="http://www.w3.org/2000/svg">')))).toBeNull();
    expect(detectImageType(bytes(...ascii('<!doctype html><script>')))).toBeNull();
  });
});

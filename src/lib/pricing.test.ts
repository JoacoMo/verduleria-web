import { describe, expect, it } from 'vitest';
import {
  buildOrderLines,
  computeTotals,
  detectPriceChanges,
  getDiscountPercent,
  getEffectivePrice,
  getShippingCost,
  isOfferActive,
  lineTotal,
  roundMoney,
  sumLines,
  type PricedProduct,
  type ShippingConfig,
} from './pricing';
import { PRODUCT_MAX_CART_QUANTITY } from './product-units';

// Lunes 5/10/2026, 12:00 en Córdoba.
const NOW = new Date('2026-10-05T15:00:00.000Z');
const HOUR = 60 * 60 * 1000;

const SHIPPING: ShippingConfig = { deliveryFee: 4000, deliveryFreeThreshold: 20000, deliveryMinPurchase: 10000 };

function product(overrides: Partial<PricedProduct> = {}): PricedProduct {
  return { id: 1, name: 'Tomate', price: 1000, unit: 'kg', available: true, offerPrice: null, offerEndsAt: null, ...overrides };
}

describe('roundMoney', () => {
  it('evita los arrastres de coma flotante', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(1234.5678)).toBe(1234.57);
    expect(roundMoney(1500)).toBe(1500);
    expect(roundMoney(0)).toBe(0);
  });

  it('redondea medio centavo hacia arriba cuando el binario lo representa exacto', () => {
    // 308,625 = 308 + 5/8 es exacto en binario.
    expect(roundMoney(308.625)).toBe(308.63);
    expect(lineTotal({ price: 1234.5, quantity: 0.25 })).toBe(308.63);
  });

  // BUG (severidad mínima, 1 centavo): Number.EPSILON es un margen absoluto que
  // solo alcanza para montos chicos. Desde ~2 pesos, un medio centavo que en
  // binario queda apenas por debajo se redondea para abajo: 2,9 × 0,75 = 2,175
  // da 2,17 en vez de 2,18 (y 10,075 da 10,07). No cambia cobros reales (los
  // precios son enteros), pero roundMoney no cumple "redondeo a centavos" half-up.
  it.fails('BUG: medio centavo en montos >= 2 se redondea para abajo (2,175 → 2,17)', () => {
    expect(roundMoney(2.175)).toBe(2.18);
    expect(lineTotal({ price: 2.9, quantity: 0.75 })).toBe(2.18);
    expect(roundMoney(10.075)).toBe(10.08);
  });
});

describe('isOfferActive / getEffectivePrice / getDiscountPercent', () => {
  it('sin precio de oferta no hay oferta', () => {
    expect(isOfferActive(product(), NOW)).toBe(false);
    expect(isOfferActive(product({ offerPrice: undefined }), NOW)).toBe(false);
    expect(getEffectivePrice(product(), NOW)).toBe(1000);
    expect(getDiscountPercent(product(), NOW)).toBe(0);
  });

  it('oferta menor al precio y sin vencimiento: vigente', () => {
    const p = product({ offerPrice: 850 });
    expect(isOfferActive(p, NOW)).toBe(true);
    expect(getEffectivePrice(p, NOW)).toBe(850);
    expect(getDiscountPercent(p, NOW)).toBe(15);
  });

  it('oferta igual o mayor al precio normal: se ignora', () => {
    expect(isOfferActive(product({ offerPrice: 1000 }), NOW)).toBe(false);
    expect(isOfferActive(product({ offerPrice: 1200 }), NOW)).toBe(false);
    expect(getEffectivePrice(product({ offerPrice: 1200 }), NOW)).toBe(1000);
    expect(getDiscountPercent(product({ offerPrice: 1000 }), NOW)).toBe(0);
  });

  it('valores imposibles no activan la oferta', () => {
    expect(isOfferActive(product({ offerPrice: Number.NaN }), NOW)).toBe(false);
    expect(isOfferActive(product({ offerPrice: Number.POSITIVE_INFINITY }), NOW)).toBe(false);
    expect(isOfferActive(product({ offerPrice: Number.NEGATIVE_INFINITY }), NOW)).toBe(false);
    expect(isOfferActive(product({ offerPrice: -1 }), NOW)).toBe(false);
  });

  it('oferta en 0 (regalo) cuenta como vigente: 100% de descuento', () => {
    const p = product({ offerPrice: 0 });
    expect(isOfferActive(p, NOW)).toBe(true);
    expect(getEffectivePrice(p, NOW)).toBe(0);
    expect(getDiscountPercent(p, NOW)).toBe(100);
  });

  it('vencimiento: vigente antes, vencida justo en el instante y después', () => {
    const endsAt = new Date(NOW.getTime() + HOUR);
    const p = product({ offerPrice: 800, offerEndsAt: endsAt });
    expect(isOfferActive(p, NOW)).toBe(true);
    expect(isOfferActive(p, new Date(endsAt.getTime() - 1))).toBe(true);
    expect(isOfferActive(p, endsAt)).toBe(false);
    expect(isOfferActive(p, new Date(endsAt.getTime() + 1))).toBe(false);
    expect(getEffectivePrice(p, endsAt)).toBe(1000);
  });

  it('acepta el vencimiento como string ISO o Date', () => {
    expect(isOfferActive(product({ offerPrice: 800, offerEndsAt: '2026-10-06T02:59:59.999Z' }), NOW)).toBe(true);
    expect(isOfferActive(product({ offerPrice: 800, offerEndsAt: '2026-10-04T02:59:59.999Z' }), NOW)).toBe(false);
  });

  it('una fecha de vencimiento ilegible apaga la oferta (no la deja eterna)', () => {
    expect(isOfferActive(product({ offerPrice: 800, offerEndsAt: 'no-es-fecha' }), NOW)).toBe(false);
  });

  it('el descuento se redondea al entero más cercano y con precio 0 es 0', () => {
    expect(getDiscountPercent(product({ price: 3000, offerPrice: 2000 }), NOW)).toBe(33);
    expect(getDiscountPercent(product({ price: 999, offerPrice: 500 }), NOW)).toBe(50);
    expect(getDiscountPercent(product({ price: 0, offerPrice: 0 }), NOW)).toBe(0);
  });
});

describe('lineTotal / sumLines', () => {
  it('redondea cada línea y la suma', () => {
    expect(lineTotal({ price: 0.1, quantity: 3 })).toBe(0.3);
    expect(lineTotal({ price: 1250, quantity: 0.35 })).toBe(437.5);
    expect(sumLines([{ price: 0.1, quantity: 1 }, { price: 0.2, quantity: 1 }])).toBe(0.3);
    expect(sumLines([])).toBe(0);
  });
});

describe('getShippingCost / computeTotals', () => {
  it('retiro: nunca paga envío ni tiene mínimo', () => {
    expect(getShippingCost(500, false, SHIPPING)).toBe(0);
    const totals = computeTotals([{ price: 500, quantity: 1 }], false, SHIPPING);
    expect(totals).toEqual({ subtotal: 500, shippingCost: 0, total: 500, belowDeliveryMinimum: false, missingForFreeShipping: 0 });
  });

  it('envío por debajo del umbral paga el costo fijo', () => {
    const totals = computeTotals([{ price: 1000, quantity: 12 }], true, SHIPPING);
    expect(totals).toEqual({ subtotal: 12000, shippingCost: 4000, total: 16000, belowDeliveryMinimum: false, missingForFreeShipping: 8000 });
  });

  it('el umbral de envío gratis es inclusivo', () => {
    expect(getShippingCost(19999.99, true, SHIPPING)).toBe(4000);
    expect(getShippingCost(20000, true, SHIPPING)).toBe(0);
    expect(computeTotals([{ price: 20000, quantity: 1 }], true, SHIPPING)).toMatchObject({ shippingCost: 0, total: 20000, missingForFreeShipping: 0 });
    expect(computeTotals([{ price: 25000, quantity: 1 }], true, SHIPPING).missingForFreeShipping).toBe(0);
  });

  it('el mínimo de envío se mira sobre el subtotal (sin el envío) y es inclusivo', () => {
    expect(computeTotals([{ price: 9999.99, quantity: 1 }], true, SHIPPING).belowDeliveryMinimum).toBe(true);
    expect(computeTotals([{ price: 10000, quantity: 1 }], true, SHIPPING).belowDeliveryMinimum).toBe(false);
    // Aunque subtotal + envío supere el mínimo, sigue por debajo.
    expect(computeTotals([{ price: 7000, quantity: 1 }], true, SHIPPING)).toMatchObject({ total: 11000, belowDeliveryMinimum: true });
  });

  it('el total se redondea a centavos', () => {
    expect(computeTotals([{ price: 0.1, quantity: 1 }, { price: 0.2, quantity: 1 }], false, SHIPPING).total).toBe(0.3);
  });
});

describe('buildOrderLines', () => {
  const catalog: PricedProduct[] = [
    product({ id: 1, name: 'Tomate', price: 1000, unit: 'kg' }),
    product({ id: 2, name: 'Acelga', price: 900, unit: 'atado' }),
    product({ id: 3, name: 'Huevos', price: 3000, unit: 'bandeja', offerPrice: 2500 }),
    product({ id: 4, name: 'Albahaca', price: 700, unit: 'atado', available: false }),
    product({ id: 5, name: 'Nuez', price: 20, unit: 'g' }),
    product({ id: 6, name: 'Banana', price: 1500, unit: 'kg', offerPrice: 1200, offerEndsAt: new Date(NOW.getTime() - 1) }),
    product({ id: 7, name: 'Bolsón', price: 12000, unit: 'unidad' }),
  ];

  it('arma las líneas con el precio efectivo del servidor y respeta el orden del carrito', () => {
    const { lines, missingIds, unavailable } = buildOrderLines(
      [{ id: 3, quantity: 1 }, { id: 1, quantity: 1.5 }, { id: 6, quantity: 2 }],
      catalog,
      NOW,
    );
    expect(lines).toEqual([
      { id: 3, name: 'Huevos', price: 2500, quantity: 1, unit: 'bandeja' },
      { id: 1, name: 'Tomate', price: 1000, quantity: 1.5, unit: 'kg' },
      // Oferta vencida: se cobra el precio normal.
      { id: 6, name: 'Banana', price: 1500, quantity: 2, unit: 'kg' },
    ]);
    expect(missingIds).toEqual([]);
    expect(unavailable).toEqual([]);
  });

  it('ids repetidos: gana la primera aparición', () => {
    const { lines } = buildOrderLines([{ id: 1, quantity: 1 }, { id: 1, quantity: 5 }, { id: '1', quantity: 9 }], catalog, NOW);
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(1);
  });

  it('ids inválidos se descartan sin contarse como faltantes', () => {
    const cart = [
      { id: 0, quantity: 1 },
      { id: -1, quantity: 1 },
      { id: 1.5, quantity: 1 },
      { id: 'abc', quantity: 1 },
      { id: null, quantity: 1 },
      { id: undefined, quantity: 1 },
      { id: Number.NaN, quantity: 1 },
    ];
    expect(buildOrderLines(cart, catalog, NOW)).toEqual({ lines: [], missingIds: [], unavailable: [] });
  });

  it('un id como string numérico se acepta (lo convierte Number())', () => {
    expect(buildOrderLines([{ id: '2', quantity: 1 }], catalog, NOW).lines[0]).toMatchObject({ id: 2, name: 'Acelga' });
  });

  it('ids que no existen van a missingIds y los sin stock a unavailable (una sola vez)', () => {
    const { lines, missingIds, unavailable } = buildOrderLines(
      [{ id: 999, quantity: 1 }, { id: 4, quantity: 1 }, { id: 4, quantity: 2 }, { id: 2, quantity: 1 }, { id: 998, quantity: 1 }],
      catalog,
      NOW,
    );
    expect(missingIds).toEqual([999, 998]);
    expect(unavailable.map((item) => item.id)).toEqual([4]);
    expect(lines.map((line) => line.id)).toEqual([2]);
  });

  it('un producto sin stock se informa aunque la cantidad sea inválida', () => {
    expect(buildOrderLines([{ id: 4, quantity: 'dos' }], catalog, NOW).unavailable).toHaveLength(1);
  });

  it('cantidades que no son número (strings, null, NaN) o no positivas se descartan', () => {
    const cart = [
      { id: 1, quantity: '2' },
      { id: 2, quantity: null },
      { id: 3, quantity: Number.NaN },
      { id: 5, quantity: -100 },
      { id: 6, quantity: 0 },
      { id: 7, quantity: Number.POSITIVE_INFINITY },
    ];
    expect(buildOrderLines(cart, catalog, NOW).lines).toEqual([]);
  });

  it('kilos: se normalizan a la precisión de la balanza (50 g), con mínimo 50 g', () => {
    const lines = buildOrderLines([{ id: 1, quantity: 0.333 }, { id: 6, quantity: 0.001 }], catalog, NOW).lines;
    expect(lines.map((line) => line.quantity)).toEqual([0.35, 0.05]);
  });

  it('gramos: múltiplos de 50 g', () => {
    expect(buildOrderLines([{ id: 5, quantity: 330 }], catalog, NOW).lines[0].quantity).toBe(350);
    expect(buildOrderLines([{ id: 5, quantity: 1 }], catalog, NOW).lines[0].quantity).toBe(50);
  });

  it('unidades/atados/bandejas fraccionarios se redondean a entero (mínimo 1)', () => {
    const lines = buildOrderLines([{ id: 2, quantity: 1.5 }, { id: 3, quantity: 0.2 }, { id: 7, quantity: 2.49 }], catalog, NOW).lines;
    expect(lines.map((line) => line.quantity)).toEqual([2, 1, 2]);
  });

  it('cantidades enormes se recortan al tope de cada unidad', () => {
    const lines = buildOrderLines(
      [{ id: 1, quantity: 1e9 }, { id: 2, quantity: 1e6 }, { id: 5, quantity: Number.MAX_VALUE }, { id: 7, quantity: 201 }],
      catalog,
      NOW,
    ).lines;
    expect(lines.map((line) => line.quantity)).toEqual([
      PRODUCT_MAX_CART_QUANTITY.kg,
      PRODUCT_MAX_CART_QUANTITY.atado,
      PRODUCT_MAX_CART_QUANTITY.g,
      PRODUCT_MAX_CART_QUANTITY.unidad,
    ]);
  });

  it('tolera ítems null/undefined en el carrito', () => {
    const cart = [null, undefined, { id: 1, quantity: 1 }] as unknown as Array<{ id: unknown; quantity: unknown }>;
    expect(buildOrderLines(cart, catalog, NOW).lines).toHaveLength(1);
  });

  it('carrito vacío o catálogo vacío', () => {
    expect(buildOrderLines([], catalog, NOW)).toEqual({ lines: [], missingIds: [], unavailable: [] });
    expect(buildOrderLines([{ id: 1, quantity: 1 }], [], NOW).missingIds).toEqual([1]);
  });
});

describe('detectPriceChanges', () => {
  const lines = [
    { id: 1, name: 'Tomate', price: 1000, quantity: 1, unit: 'kg' as const },
    { id: 2, name: 'Acelga', price: 900, quantity: 1, unit: 'atado' as const },
  ];

  it('sin cambios no informa nada', () => {
    expect(detectPriceChanges([{ id: 1, price: 1000 }, { id: 2, price: 900 }], lines)).toEqual([]);
  });

  it('informa precio anterior y actual de cada línea que cambió', () => {
    expect(detectPriceChanges([{ id: 1, price: 800 }, { id: 2, price: 900 }], lines)).toEqual([
      { id: 1, name: 'Tomate', previousPrice: 800, currentPrice: 1000 },
    ]);
  });

  it('tolera diferencias de menos de un centavo', () => {
    expect(detectPriceChanges([{ id: 1, price: 1000.005 }], lines)).toEqual([]);
    expect(detectPriceChanges([{ id: 1, price: 999.99 }], lines)).toHaveLength(1);
  });

  it('sin precio (pestaña vieja), precio string o NaN: no se compara', () => {
    expect(detectPriceChanges([{ id: 1, price: undefined }], lines)).toEqual([]);
    expect(detectPriceChanges([{ id: 1, price: '800' }], lines)).toEqual([]);
    expect(detectPriceChanges([{ id: 1, price: Number.NaN }], lines)).toEqual([]);
    expect(detectPriceChanges([{ id: 1, price: null }], lines)).toEqual([]);
  });

  it('ids que no están en las líneas se ignoran', () => {
    expect(detectPriceChanges([{ id: 99, price: 1 }, { id: 'x', price: 1 }], lines)).toEqual([]);
  });

  // BUG (severidad baja): buildOrderLines toma la PRIMERA aparición de un id
  // repetido, pero detectPriceChanges se queda con la ÚLTIMA. Con un carrito
  // [{id:1, price:1000}, {id:1, price:1}] (armado a mano: la tienda no repite
  // ids) el checkout responde 409 PRECIOS_CAMBIARON por un precio que ni
  // siquiera es el de la línea que se iba a cobrar.
  it.fails('BUG: con ids repetidos compara contra la última aparición y no contra la primera', () => {
    expect(detectPriceChanges([{ id: 1, price: 1000 }, { id: 1, price: 1 }], lines)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { describePickupReady } from '@/lib/store-hours';
import type { Product } from '@/lib/types';
import { applyPriceChanges, markUnavailable, withServerPrice } from './catalog-updates';
import { UNREADABLE_BODY, interpretCheckoutResponse, type CheckoutRequest } from './checkout-api';
import { formatOfferEnds, formatPhoneForDisplay } from './format';
import { PICKUP_CUTOFF_RULE, describePickupCutoffRule } from './pickup-text';
import { clampQuantity, fromDisplayQuantity, parseQuantityInput, toDisplayQuantity } from './quantity';
import { toCartLines } from './storage';
import { CLOCK_SKEW_TOLERANCE_MS, computeClockOffset } from './use-client-clock';
import { validateCheckout } from './use-checkout-form';

// buildOrderMessage / buildOrderWhatsappUrl se testean en order-message.test.ts.

describe('cantidades', () => {
  it('convierte entre kg y g para mostrar', () => {
    expect(toDisplayQuantity(1.35, 'kg', 'g')).toBe(1350);
    expect(toDisplayQuantity(350, 'g', 'kg')).toBe(0.35);
    expect(fromDisplayQuantity(1350, 'kg', 'g')).toBe(1.35);
    expect(toDisplayQuantity(2, 'atado', 'atado')).toBe(2);
  });

  it('normaliza y recorta al tope', () => {
    expect(clampQuantity(1.234, 'kg')).toBe(1.25);
    expect(clampQuantity(2.4, 'bandeja')).toBe(2);
    expect(clampQuantity(5000, 'unidad')).toBe(200);
  });

  it('en kg acepta coma o punto decimal', () => {
    expect(parseQuantityInput('1,5', 'kg')).toBe(1.5);
    expect(parseQuantityInput('1.5', 'kg')).toBe(1.5);
    expect(parseQuantityInput('1,333', 'kg')).toBe(1.333);
    expect(parseQuantityInput('1.500', 'kg')).toBe(1.5);
    expect(parseQuantityInput(',5', 'kg')).toBe(0.5);
    expect(parseQuantityInput(' 2 ', 'kg')).toBe(2);
  });

  it('en gramos y unidades "1.500" y "1,500" son mil quinientos', () => {
    expect(parseQuantityInput('1.500', 'g')).toBe(1500);
    expect(parseQuantityInput('1,500', 'g')).toBe(1500);
    expect(parseQuantityInput('1 500', 'g')).toBe(1500);
    expect(parseQuantityInput('2.000.000', 'g')).toBe(2_000_000);
    expect(parseQuantityInput('1.500', 'unidad')).toBe(1500);
    expect(parseQuantityInput('330', 'g')).toBe(330);
    // Sin grupos de tres no es separador de miles.
    expect(parseQuantityInput('12,5', 'g')).toBe(12.5);
    // El caso del bug: zapallo por kg visto en gramos.
    expect(fromDisplayQuantity(parseQuantityInput('1.500', 'g'), 'kg', 'g')).toBe(1.5);
    expect(clampQuantity(fromDisplayQuantity(parseQuantityInput('1.500', 'g'), 'kg', 'g'), 'kg')).toBe(1.5);
  });

  it('miles con punto y coma decimal', () => {
    expect(parseQuantityInput('1.500,5', 'g')).toBe(1500.5);
    expect(parseQuantityInput('1.500,5', 'kg')).toBe(1500.5);
  });

  it('rechaza lo que no es un número común', () => {
    for (const text of ['', '   ', '-1', '0x10', '1e3', 'Infinity', 'dos', '1,5,5', '1.5.5', '+2']) {
      expect(Number.isNaN(parseQuantityInput(text, 'kg')), text).toBe(true);
    }
    expect(Number.isNaN(parseQuantityInput('1.5.5', 'g'))).toBe(true);
  });
});

describe('reloj del cliente', () => {
  const serverTime = Date.parse('2026-10-05T22:00:00.000Z'); // 19:00 en Córdoba

  it('no corrige la demora normal entre el render y el montaje', () => {
    expect(computeClockOffset(serverTime, serverTime)).toBe(0);
    expect(computeClockOffset(serverTime, serverTime + 90_000)).toBe(0);
    expect(computeClockOffset(serverTime, serverTime - 60_000)).toBe(0);
    expect(computeClockOffset(serverTime, serverTime + CLOCK_SKEW_TOLERANCE_MS)).toBe(0);
  });

  it('corrige un celular atrasado o adelantado', () => {
    // El celular cree que son las 11:00 y el servidor está a las 19:00.
    expect(computeClockOffset(serverTime, serverTime - 8 * 3_600_000)).toBe(8 * 3_600_000);
    // El celular está en el 25/10 y el servidor en el 5/10.
    expect(computeClockOffset(serverTime, serverTime + 20 * 86_400_000)).toBe(-20 * 86_400_000);
  });

  it('sin hora del servidor (o inválida) no toca nada', () => {
    expect(computeClockOffset(undefined, serverTime)).toBe(0);
    expect(computeClockOffset(Number.NaN, serverTime)).toBe(0);
    expect(computeClockOffset(serverTime, Number.NaN)).toBe(0);
  });
});

describe('textos de retiro', () => {
  // Hora de Córdoba. El 4/10/2026 es domingo y el 5/10, lunes.
  const at = (localIso: string) => new Date(`${localIso}-03:00`);

  it('cuándo está listo un retiro según la hora del pedido', () => {
    expect(describePickupReady(at('2026-10-05T10:00:00'))).toBe('hoy, en el horario de atención');
    expect(describePickupReady(at('2026-10-05T07:15:00'))).toBe('hoy desde las 8:00');
    expect(describePickupReady(at('2026-10-05T15:00:00'))).toBe('hoy desde las 17:30');
    expect(describePickupReady(at('2026-10-05T18:59:00'))).toBe('hoy, en el horario de atención');
    expect(describePickupReady(at('2026-10-05T19:00:00'))).toBe('mañana desde las 8:00');
    // Sábado a la noche: el domingo abre a las 9.
    expect(describePickupReady(at('2026-10-10T20:00:00'))).toBe('mañana desde las 9:00');
  });

  it('el domingo a la tarde no dice "hoy" (el local cierra a las 14)', () => {
    expect(describePickupReady(at('2026-10-04T08:00:00'))).toBe('hoy desde las 9:00');
    expect(describePickupReady(at('2026-10-04T13:30:00'))).toBe('hoy, en el horario de atención');
    expect(describePickupReady(at('2026-10-04T14:00:00'))).toBe('mañana desde las 8:00');
    expect(describePickupReady(at('2026-10-04T15:00:00'))).toBe('mañana desde las 8:00');
  });

  it('la regla fija del corte nombra la excepción del domingo', () => {
    expect(describePickupCutoffRule()).toBe('antes de las 19:00 (los domingos, antes de las 14:00)');
    expect(PICKUP_CUTOFF_RULE).toBe(describePickupCutoffRule());
  });
});

describe('respuesta del checkout', () => {
  const request: CheckoutRequest = {
    cart: [{ id: 1, quantity: 1, price: 1000 }],
    deliveryMethod: 'pickup',
    deliverySlot: null,
    paymentMethod: 'cash',
    customer: { customerName: 'Ana', customerPhone: '351 1234567', customerAddress: '', notes: '', replacementPolicy: 'replace' },
    idempotencyKey: 'clave',
  };
  const okBody = {
    orderId: 7,
    items: [{ id: 1, name: 'Tomate', price: 800, quantity: 1, unit: 'kg' }],
    subtotal: 800,
    shippingCost: 0,
    total: 800,
    paymentMethod: 'cash',
    deliveryMethod: 'pickup',
    deliverySlot: null,
    transferAlias: 'alias',
    transferCbu: '',
    whatsappNumber: '5493517656500',
    storeName: 'El Pampa',
  };

  it('200: trae solo las bajas de precio válidas', () => {
    const outcome = interpretCheckoutResponse(200, {
      ...okBody,
      priceDrops: [
        { id: 1, name: 'Tomate', previousPrice: 1000, currentPrice: 800 },
        { id: 2, name: 'Zapallo', previousPrice: 1000, currentPrice: 1100 },
        { id: 3, name: 'Roto' },
      ],
    }, request);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.data.priceDrops).toEqual([{ id: 1, name: 'Tomate', previousPrice: 1000, currentPrice: 800 }]);
    expect(outcome.data.items[0].price).toBe(800);
  });

  it('200 sin priceDrops (pedido viejo de un reintento): lista vacía', () => {
    const outcome = interpretCheckoutResponse(200, { ...okBody, yaExistia: true }, request);
    expect(outcome).toMatchObject({ kind: 'ok', data: { priceDrops: [], yaExistia: true } });
  });

  it('200 cortado a mitad de camino: se reintenta con la misma clave', () => {
    expect(interpretCheckoutResponse(200, UNREADABLE_BODY, request)).toEqual({ kind: 'network' });
  });

  it('429 por teléfono o por intentos: el mensaje del servidor', () => {
    const message = 'Ya hiciste varios pedidos hoy con este teléfono. Escribinos por WhatsApp.';
    expect(interpretCheckoutResponse(429, { error: message }, request)).toEqual({ kind: 'rate-limited', message });
    expect(interpretCheckoutResponse(429, UNREADABLE_BODY, request).kind).toBe('rate-limited');
  });

  it('503 del tope global: aviso con el mensaje; un 503 sin mensaje es un error común', () => {
    const message = 'Estamos recibiendo demasiados pedidos. Probá en unos minutos o escribinos por WhatsApp.';
    expect(interpretCheckoutResponse(503, { error: message }, request)).toEqual({ kind: 'busy', message });
    expect(interpretCheckoutResponse(503, {}, request)).toEqual({ kind: 'server-error' });
    expect(interpretCheckoutResponse(503, UNREADABLE_BODY, request)).toEqual({ kind: 'server-error' });
  });

  it('409 PRECIOS_CAMBIARON y SIN_STOCK', () => {
    const changes = [{ id: 1, name: 'Tomate', previousPrice: 800, currentPrice: 900 }];
    expect(interpretCheckoutResponse(409, { code: 'PRECIOS_CAMBIARON', error: 'Subió', priceChanges: changes }, request))
      .toEqual({ kind: 'price-changed', message: 'Subió', changes });
    expect(interpretCheckoutResponse(409, { code: 'SIN_STOCK', unavailableIds: [2, 'x', -1] }, request))
      .toMatchObject({ kind: 'unavailable', ids: [2] });
  });
});

describe('carrito guardado', () => {
  it('descarta líneas inválidas y repetidas', () => {
    expect(toCartLines([{ id: 1, quantity: 1 }, { id: 1, quantity: 2 }, { id: -3, quantity: 1 }, { id: 2, quantity: 0 }, 'x']))
      .toEqual([{ id: 1, quantity: 1 }]);
    expect(toCartLines(null)).toEqual([]);
  });
});

const now = new Date('2026-10-05T15:00:00.000Z');

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    name: 'Tomate',
    price: 1000,
    image: '',
    unit: 'kg',
    category: 'Verduras',
    description: null,
    offerPrice: null,
    offerEndsAt: null,
    available: true,
    ...overrides,
  };
}

describe('actualizaciones del catálogo', () => {
  it('sin oferta, el precio nuevo es el precio normal', () => {
    expect(withServerPrice(product(), 1200, now)).toMatchObject({ price: 1200, offerPrice: null });
  });

  it('con oferta vigente y precio por debajo del normal, cambia la oferta', () => {
    const updated = withServerPrice(product({ offerPrice: 800 }), 700, now);
    expect(updated).toMatchObject({ price: 1000, offerPrice: 700 });
  });

  it('si la oferta venció en el servidor, se descarta', () => {
    const updated = withServerPrice(product({ offerPrice: 800 }), 1000, now);
    expect(updated).toMatchObject({ price: 1000, offerPrice: null, offerEndsAt: null });
  });

  it('no toca lo que no cambió y marca sin stock', () => {
    const list = [product(), product({ id: 2 })];
    expect(applyPriceChanges(list, [], now)).toBe(list);
    const marked = markUnavailable(list, [2, 99]);
    expect(marked[0]).toBe(list[0]);
    expect(marked[1].available).toBe(false);
  });
});

describe('formatos', () => {
  it('vencimiento de oferta en hora argentina', () => {
    // Fin del 6/10 en Córdoba = 7/10 02:59:59 UTC.
    expect(formatOfferEnds('2026-10-07T02:59:59.999Z')).toBe('Hasta el martes 6/10');
    // Si se guardó como el comienzo del día siguiente, igual dice el 6.
    expect(formatOfferEnds('2026-10-07T03:00:00.000Z')).toBe('Hasta el martes 6/10');
    expect(formatOfferEnds(null)).toBeNull();
  });

  it('WhatsApp sin el 549', () => {
    expect(formatPhoneForDisplay('5493517656500')).toBe('351 765-6500');
    expect(formatPhoneForDisplay('5491123456789')).toBe('11 2345-6789');
  });
});

describe('validateCheckout', () => {
  const values = { customerName: 'Ana', customerPhone: '351 1234567', customerAddress: '', notes: '', replacementPolicy: 'replace' as const };

  it('retiro: alcanza con nombre y teléfono', () => {
    expect(validateCheckout(values, { isDelivery: false, hasSelectedSlot: false })).toEqual({});
  });

  it('envío: pide dirección y turno', () => {
    const errors = validateCheckout(values, { isDelivery: true, hasSelectedSlot: false });
    expect(errors.customerAddress).toBeTruthy();
    expect(errors.deliverySlot).toBeTruthy();
  });

  it('teléfono corto o vacío', () => {
    expect(validateCheckout({ ...values, customerPhone: '1234' }, { isDelivery: false, hasSelectedSlot: false }).customerPhone).toBeTruthy();
    expect(validateCheckout({ ...values, customerName: ' ' }, { isDelivery: false, hasSelectedSlot: false }).customerName).toBeTruthy();
  });
});

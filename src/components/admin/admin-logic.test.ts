import { describe, expect, it } from 'vitest';
import type { OrderRecord, Product } from '@/lib/types';
import {
  groupOrdersByDelivery,
  isAfterPickupCutoff,
  isAwaitingWeights,
  isCarriedPickup,
  isPickupForNextDay,
  isShippingChargedApart,
  shippingLabel,
  summarizeDay,
  summarizeOverdue,
  totalLabel,
  visibleOverdueOrders,
} from './orders-model';
import {
  IMAGE_TOO_LARGE_MESSAGE,
  discountedPrice,
  productToFormState,
  uploadErrorMessage,
  validateOffer,
  validateProductForm,
  EMPTY_PRODUCT_FORM,
} from './product-form-model';
import { firstName, formatQuantityInput, parseMoneyInput, parseQuantityInput, shiftDate } from './format';
import { fitWithin } from './image-compression';

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: 123,
    items: [
      { id: 1, name: 'Tomate', price: 800, quantity: 1.35, unit: 'kg' },
      { id: 2, name: 'Acelga', price: 900, quantity: 2, unit: 'atado' },
    ],
    subtotal: 2880,
    shippingCost: 4000,
    total: 6880,
    status: 'pending',
    deliveryMethod: 'delivery',
    paymentMethod: 'transfer',
    deliverySlot: '2026-10-06T13',
    adjustedAt: '2026-10-06T14:30:00.000Z',
    customerName: 'ana pérez',
    customerPhone: '3511234567',
    customerAddress: 'Av. Colón 123',
    notes: null,
    replacementPolicy: 'replace',
    createdAt: '2026-10-05T23:10:00.000Z',
    updatedAt: '2026-10-06T14:30:00.000Z',
    ...overrides,
  };
}

// buildFinalTotalMessage / buildReviewRequestMessage se testean en order-messages.test.ts.

describe('totalLabel / isAwaitingWeights', () => {
  it('distingue final, estimado y exacto', () => {
    expect(totalLabel(order())).toBe('Total final');
    expect(totalLabel(order({ adjustedAt: null }))).toBe('Total estimado');
    expect(totalLabel(order({ adjustedAt: null, items: [{ id: 2, name: 'Acelga', price: 900, quantity: 2, unit: 'atado' }] }))).toBe('Total');
  });

  it('solo espera pesos si hay algo por peso y todavía no se ajustó', () => {
    expect(isAwaitingWeights(order({ adjustedAt: null }))).toBe(true);
    expect(isAwaitingWeights(order())).toBe(false);
    expect(isAwaitingWeights(order({ adjustedAt: null, items: [{ id: 2, name: 'Acelga', price: 900, quantity: 2, unit: 'atado' }] }))).toBe(false);
    expect(isAwaitingWeights(order({ adjustedAt: null, items: [{ id: 3, name: 'Ajo', price: 5, quantity: 150, unit: 'g' }] }))).toBe(true);
  });
});

describe('envío de pedidos de antes (sin medio de pago guardado)', () => {
  const money = (amount: number) => `$${amount}`;
  const legacy = (overrides: Partial<OrderRecord> = {}) => order({ paymentMethod: null, shippingCost: 0, subtotal: 2880, total: 2880, ...overrides });

  it('debajo del umbral se cobraba aparte; desde el umbral era gratis', () => {
    expect(isShippingChargedApart(legacy(), 20000)).toBe(true);
    expect(shippingLabel(legacy(), 20000, money)).toBe('Aparte');
    expect(isShippingChargedApart(legacy({ subtotal: 20000, total: 20000 }), 20000)).toBe(false);
    expect(shippingLabel(legacy({ subtotal: 25000, total: 25000 }), 20000, money)).toBe('Gratis');
    // Sin el umbral cargado todavía, se toma como aparte (no se promete nada).
    expect(isShippingChargedApart(legacy({ subtotal: 25000, total: 25000 }), null)).toBe(true);
  });

  it('los pedidos de ahora no cambian: costo, o gratis si no se cobró', () => {
    expect(shippingLabel(order(), 20000, money)).toBe('$4000');
    expect(shippingLabel(order({ shippingCost: 0, subtotal: 22000, total: 22000 }), 20000, money)).toBe('Gratis');
    expect(isShippingChargedApart(order({ shippingCost: 0 }), 20000)).toBe(false);
    expect(isShippingChargedApart(legacy({ deliveryMethod: 'pickup' }), 20000)).toBe(false);
  });
});

describe('retiros y el corte del día', () => {
  // Córdoba es UTC-3 todo el año: 20:30 del domingo 4/10 = 23:30 UTC.
  const pickup = (overrides: Partial<OrderRecord>) => order({ deliveryMethod: 'pickup', deliverySlot: null, shippingCost: 0, ...overrides });

  it('el corte es a las 19:00, o al cierre si es antes (domingo 14:00)', () => {
    expect(isAfterPickupCutoff(pickup({ createdAt: '2026-10-05T21:59:00.000Z' }))).toBe(false); // lunes 18:59
    expect(isAfterPickupCutoff(pickup({ createdAt: '2026-10-05T22:00:00.000Z' }))).toBe(true); // lunes 19:00
    expect(isAfterPickupCutoff(pickup({ createdAt: '2026-10-04T16:59:00.000Z' }))).toBe(false); // domingo 13:59
    expect(isAfterPickupCutoff(pickup({ createdAt: '2026-10-04T17:30:00.000Z' }))).toBe(true); // domingo 14:30
    // Un envío no tiene corte de retiro (va por turno).
    expect(isAfterPickupCutoff(order({ createdAt: '2026-10-05T23:00:00.000Z' }))).toBe(false);
    expect(isAfterPickupCutoff(pickup({ createdAt: undefined }))).toBe(false);
  });

  it('"Se arma mañana" solo el día en que entró; el día siguiente es un retiro que viene de ayer', () => {
    const late = pickup({ createdAt: '2026-10-04T23:30:00.000Z' }); // domingo 20:30
    expect(isPickupForNextDay(late, '2026-10-04')).toBe(true);
    expect(isPickupForNextDay(late, '2026-10-05')).toBe(false);
    expect(isCarriedPickup(late, '2026-10-05')).toBe(true);
    expect(isCarriedPickup(late, '2026-10-04')).toBe(false);
    // 23:30 del domingo en Córdoba ya es lunes en UTC: la fecha se toma en hora argentina.
    expect(isCarriedPickup(pickup({ createdAt: '2026-10-05T02:30:00.000Z' }), '2026-10-05')).toBe(true);
    expect(isPickupForNextDay(pickup({ createdAt: '2026-10-05T13:00:00.000Z' }), '2026-10-05')).toBe(false);
  });

  it('agrupa los retiros que vienen de ayer antes que el resto de los retiros', () => {
    const orders = [
      pickup({ id: 10, createdAt: '2026-10-05T13:00:00.000Z' }), // lunes 10:00
      pickup({ id: 11, createdAt: '2026-10-04T23:30:00.000Z' }), // domingo 20:30
      pickup({ id: 12, createdAt: '2026-10-04T18:00:00.000Z' }), // domingo 15:00
      pickup({ id: 13, createdAt: '2026-10-05T22:30:00.000Z' }), // lunes 19:30: se arma el martes
      order({ id: 14, deliverySlot: '2026-10-05T13', createdAt: '2026-10-05T12:00:00.000Z' }),
      pickup({ id: 15, createdAt: '2026-10-04T23:00:00.000Z', status: 'cancelled' }),
    ];
    const groups = groupOrdersByDelivery(orders, '2026-10-05');
    expect(groups.map((group) => [group.kind, group.title, group.orders.map((item) => item.id)])).toEqual([
      ['slot', 'Envíos de 13 a 14 h', [14]],
      ['pickup-carry', 'Retiros que entraron ayer después del horario', [12, 11]],
      ['pickup', 'Retiros en el local', [10, 13]],
      ['cancelled', 'Cancelados', [15]],
    ]);
    expect(groups[1].hint).toMatch(/^Se arman hoy/);
    expect(groups[2].hint).toBeUndefined();

    const summary = summarizeDay(orders, '2026-10-05');
    // Los de ayer se arman hoy; el de las 19:30 de hoy, mañana.
    expect(summary.pickupCount).toBe(3);
    expect(summary.nextDayPickupCount).toBe(1);
  });
});

describe('pendientes de días anteriores', () => {
  it('no repite los que ya están en la lista del día y resume lo que falta cobrar', () => {
    const overdue = [
      order({ id: 1, total: 1000, adjustedAt: null }),
      order({ id: 2, total: 2500.5 }),
      order({ id: 3, total: 700, status: 'paid' }),
    ];
    const visible = visibleOverdueOrders(overdue, [order({ id: 2 })]);
    expect(visible.map((item) => item.id)).toEqual([1]);
    expect(summarizeOverdue(overdue.slice(0, 2))).toEqual({ count: 2, toCollectTotal: 3500.5, hasEstimated: true });
    expect(summarizeOverdue([])).toEqual({ count: 0, toCollectTotal: 0, hasEstimated: false });
  });
});

describe('groupOrdersByDelivery / summarizeDay', () => {
  const orders = [
    order({ id: 1, deliverySlot: '2026-10-06T19', createdAt: '2026-10-06T12:00:00.000Z' }),
    order({ id: 2, deliverySlot: '2026-10-06T13', createdAt: '2026-10-06T13:00:00.000Z', status: 'paid' }),
    order({ id: 3, deliverySlot: '2026-10-06T13', createdAt: '2026-10-06T11:00:00.000Z' }),
    order({ id: 4, deliveryMethod: 'pickup', deliverySlot: null, shippingCost: 0, total: 2880, createdAt: '2026-10-06T13:00:00.000Z' }),
    order({ id: 5, deliverySlot: '2026-10-07T13' }),
    order({ id: 6, status: 'cancelled' }),
    order({ id: 7, deliverySlot: null }),
  ];

  it('agrupa por turno en orden horario, después retiros, otro día y cancelados', () => {
    const groups = groupOrdersByDelivery(orders, '2026-10-06');
    expect(groups.map((group) => group.title)).toEqual([
      'Envíos de 13 a 14 h',
      'Envíos de 19 a 20 h',
      'Envíos sin turno',
      'Retiros en el local',
      'Envíos para otro día',
      'Cancelados',
    ]);
    // Dentro del turno, por orden de llegada.
    expect(groups[0].orders.map((item) => item.id)).toEqual([3, 2]);
  });

  it('resume cobrado, por cobrar y envíos por turno', () => {
    const summary = summarizeDay(orders, '2026-10-06');
    expect(summary.orderCount).toBe(6);
    expect(summary.cancelledCount).toBe(1);
    expect(summary.paidCount).toBe(1);
    expect(summary.paidTotal).toBe(6880);
    expect(summary.toCollectCount).toBe(5);
    expect(summary.toCollectTotal).toBe(6880 * 4 + 2880);
    expect(summary.pickupCount).toBe(1);
    expect(summary.deliveriesBySlot.map((slot) => [slot.label, slot.count])).toEqual([
      ['de 13 a 14 h', 2],
      ['de 19 a 20 h', 1],
    ]);
    expect(summary.otherDeliveries).toBe(2);
  });
});

describe('parseos de números', () => {
  it('precios: miles con punto, decimales con coma', () => {
    expect(parseMoneyInput('1.500')).toBe(1500);
    expect(parseMoneyInput('$ 1.500,50')).toBe(1500.5);
    expect(parseMoneyInput('1500.5')).toBe(1500.5);
    expect(parseMoneyInput('')).toBeNull();
    expect(Number.isNaN(parseMoneyInput('mil'))).toBe(true);
  });

  it('cantidades: en kilos punto y coma son decimales; en gramos y unidades, miles', () => {
    expect(parseQuantityInput('1,25', 'kg')).toBe(1.25);
    expect(parseQuantityInput('1.250', 'kg')).toBe(1.25);
    expect(parseQuantityInput('300', 'g')).toBe(300);
    expect(parseQuantityInput('1.500', 'g')).toBe(1500);
    expect(parseQuantityInput('1,500', 'unidad')).toBe(1500);
    expect(parseQuantityInput('1.500,5', 'kg')).toBe(1500.5);
    expect(parseQuantityInput('2,5', 'g')).toBe(2.5);
    expect(parseQuantityInput(' ', 'kg')).toBeNull();
    expect(Number.isNaN(parseQuantityInput('-1', 'kg'))).toBe(true);
    expect(Number.isNaN(parseQuantityInput('1.2.3', 'g'))).toBe(true);
    expect(formatQuantityInput(1.35, 'kg')).toBe('1,35');
    // El peso de la balanza va con 3 decimales.
    expect(formatQuantityInput(11.235, 'kg')).toBe('11,235');
    expect(formatQuantityInput(2, 'kg')).toBe('2');
    expect(formatQuantityInput(2, 'atado')).toBe('2');
  });

  it('nombre y fechas', () => {
    expect(firstName('  maría  josé ')).toBe('María');
    expect(shiftDate('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('formulario de producto', () => {
  const today = '2026-10-05';

  it('la oferta tiene que ser menor al precio y la fecha no puede haber pasado', () => {
    expect(validateOffer(1000, '1000', '', today).errors.offerPrice).toMatch(/menor que el precio normal/);
    expect(validateOffer(1000, '800', '2026-10-04', today).errors.offerEndsAt).toBe('Esa fecha ya pasó.');
    expect(validateOffer(1000, '', '2026-10-10', today).errors.offerEndsAt).toMatch(/cargá también el precio de oferta/);
    expect(validateOffer(1000, '800', '2026-10-05', today)).toEqual({ errors: {}, offerPrice: 800, offerEndsAt: '2026-10-05' });
  });

  it('manda null explícito en descripción y oferta vacías', () => {
    const { payload } = validateProductForm({ ...EMPTY_PRODUCT_FORM, name: ' Bolsón chico ', price: '5.000', category: 'Bolsones', unit: 'unidad' }, today);
    expect(payload).toEqual({
      name: 'Bolsón chico',
      price: 5000,
      unit: 'unidad',
      category: 'Bolsones',
      image: '',
      description: null,
      offerPrice: null,
      offerEndsAt: null,
    });
  });

  it('no precarga una oferta vencida (el servidor rechazaría la fecha)', () => {
    const product: Product = {
      id: 9,
      name: 'Banana',
      price: 1500,
      image: '',
      unit: 'kg',
      category: 'Frutas',
      description: null,
      offerPrice: 1200,
      offerEndsAt: '2026-10-03T02:59:59.999Z',
      available: true,
    };
    const { form, expiredOffer } = productToFormState(product, new Date('2026-10-05T12:00:00Z'));
    expect(form.offerPrice).toBe('');
    expect(form.offerEndsAt).toBe('');
    expect(expiredOffer).toEqual({ offerPrice: 1200, endedOn: '2026-10-02' });

    const active = productToFormState({ ...product, offerEndsAt: '2026-10-11T02:59:59.999Z' }, new Date('2026-10-05T12:00:00Z'));
    expect(active.form.offerPrice).toBe('1200');
    expect(active.form.offerEndsAt).toBe('2026-10-10');
  });

  it('rechaza una foto relativa con barra invertida (el navegador la lleva a otro dominio)', () => {
    const base = { ...EMPTY_PRODUCT_FORM, name: 'Banana', price: '1500' };
    expect(validateProductForm({ ...base, image: '/\\otro.sitio/x.png' }, today).errors.image).toBeDefined();
    expect(validateProductForm({ ...base, image: '/product-placeholder.svg' }, today).errors.image).toBeUndefined();
    expect(validateProductForm({ ...base, image: '//otro.sitio/x.png' }, today).errors.image).toBeDefined();
  });

  it('descuentos rápidos redondeados a $10', () => {
    expect(discountedPrice(1290, 10)).toBe(1160);
    expect(discountedPrice(50, 10)).toBe(45);
  });
});

describe('subida de fotos', () => {
  it('achica a 800 px de ancho y 1600 de alto sin deformar ni agrandar', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 800, height: 600 });
    // Captura de pantalla larga: antes quedaba de 800 × 10.000.
    expect(fitWithin(1080, 13500)).toEqual({ width: 128, height: 1600 });
    expect(fitWithin(400, 300)).toEqual({ width: 400, height: 300 });
    expect(fitWithin(0, 0)).toEqual({ width: 800, height: 1600 });
  });

  it('un 413 sin JSON (el corte de Vercel) dice que la imagen es muy pesada', () => {
    expect(uploadErrorMessage(413, null, 'No se pudo subir la imagen.')).toBe(IMAGE_TOO_LARGE_MESSAGE);
    // El 413 de nuestra API trae su propio mensaje.
    expect(uploadErrorMessage(413, { error: 'La imagen no puede superar los 4 MB.' }, 'x')).toBe('La imagen no puede superar los 4 MB.');
    expect(uploadErrorMessage(500, null, 'No se pudo subir la imagen.')).toBe('No se pudo subir la imagen.');
    expect(uploadErrorMessage(400, { error: 'Formato no permitido.' }, 'x')).toBe('Formato no permitido.');
  });
});

import { describe, expect, it } from 'vitest';
import { formatArs } from '@/lib/format-price';
import type { OrderRecord, Product, StoreInfo } from '@/lib/types';
import { buildFinalTotalMessage, buildReviewRequestMessage } from './order-messages';
import { groupOrdersByDelivery, summarizeDay, totalLabel } from './orders-model';
import { discountedPrice, productToFormState, validateOffer, validateProductForm, EMPTY_PRODUCT_FORM } from './product-form-model';
import { firstName, formatQuantityInput, parseMoneyInput, parseQuantityInput, shiftDate } from './format';

const STORE: StoreInfo = {
  storeName: 'El Pampa',
  storeAddress: 'Rosario de Santa Fe 1211, Barrio General Paz, Córdoba Capital',
  storeNeighborhood: 'Barrio General Paz',
  storeHours: { weekday: 'Lunes a sábado', sunday: 'Domingos' },
  transferAlias: 'el.pampa.verdu',
  transferCbu: '0000003100000000000001',
  whatsappNumber: '5493510000000',
  contactEmail: 'hola@example.com',
  instagramUrl: '',
  googleReviewUrl: 'https://g.page/r/elpampa/review',
  deliveryMaxWeightKg: 7,
  deliveryMinPurchase: 10000,
  deliveryFee: 4000,
  deliveryFreeThreshold: 20000,
};

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

describe('buildFinalTotalMessage', () => {
  it('arma el detalle con pesos reales, envío, turno y datos de transferencia', () => {
    const text = buildFinalTotalMessage(order(), STORE);
    expect(text.startsWith('*Hola Ana!* tu pedido #123 de El Pampa ya está armado ✅')).toBe(true);
    expect(text).toContain(`• 1,35 kg de Tomate: ${formatArs(1080)}`);
    expect(text).toContain(`• 2 atados de Acelga: ${formatArs(1800)}`);
    expect(text).toContain(`Envío: ${formatArs(4000)}`);
    expect(text).toContain(`*Total final: ${formatArs(6880)}* (envío incluido)`);
    expect(text).toContain('Te lo llevamos el martes 6/10 de 13 a 14 h a Av. Colón 123.');
    // El alias va sin asteriscos: si no, al copiarlo se copian también.
    expect(text).toContain('\nAlias: el.pampa.verdu\n');
    expect(text).toContain('CBU: 0000003100000000000001');
    expect(text).toContain('mandanos el comprobante por acá');
  });

  it('en efectivo con retiro no manda alias y dice que paga al retirar', () => {
    const text = buildFinalTotalMessage(order({ deliveryMethod: 'pickup', paymentMethod: 'cash', shippingCost: 0, total: 2880, deliverySlot: null }), STORE);
    expect(text).toContain(`*Total final: ${formatArs(2880)}*`);
    expect(text).not.toContain('Envío');
    expect(text).not.toContain('Alias');
    expect(text).toContain('Ya lo podés pasar a retirar por Rosario de Santa Fe 1211');
    expect(text).toContain('Lo pagás en efectivo al retirarlo.');
  });

  it('en efectivo con envío gratis lo aclara y dice que paga al recibir', () => {
    const text = buildFinalTotalMessage(order({ paymentMethod: 'cash', shippingCost: 0, total: 2880 }), STORE);
    expect(text).toContain('Envío: gratis');
    expect(text).toContain('(envío gratis)');
    expect(text).toContain('Lo pagás en efectivo al recibirlo.');
  });

  it('sin nombre saluda igual y sin CBU no pone la línea', () => {
    const text = buildFinalTotalMessage(order({ customerName: null }), { ...STORE, transferCbu: '' });
    expect(text.startsWith('*Hola!* tu pedido')).toBe(true);
    expect(text).not.toContain('CBU');
  });
});

describe('buildReviewRequestMessage', () => {
  it('solo con el pedido pagado y el link configurado', () => {
    expect(buildReviewRequestMessage(order({ status: 'pending' }), STORE)).toBeNull();
    expect(buildReviewRequestMessage(order({ status: 'paid' }), { ...STORE, googleReviewUrl: '' })).toBeNull();
    const text = buildReviewRequestMessage(order({ status: 'paid' }), STORE);
    expect(text).toContain('*Hola Ana!*');
    expect(text).toContain('https://g.page/r/elpampa/review');
  });
});

describe('totalLabel', () => {
  it('distingue final, estimado y exacto', () => {
    expect(totalLabel(order())).toBe('Total final');
    expect(totalLabel(order({ adjustedAt: null }))).toBe('Total estimado');
    expect(totalLabel(order({ adjustedAt: null, items: [{ id: 2, name: 'Acelga', price: 900, quantity: 2, unit: 'atado' }] }))).toBe('Total');
  });
});

describe('groupOrdersByDelivery / summarizeDay', () => {
  const orders = [
    order({ id: 1, deliverySlot: '2026-10-06T19', createdAt: '2026-10-06T12:00:00.000Z' }),
    order({ id: 2, deliverySlot: '2026-10-06T13', createdAt: '2026-10-06T13:00:00.000Z', status: 'paid' }),
    order({ id: 3, deliverySlot: '2026-10-06T13', createdAt: '2026-10-06T11:00:00.000Z' }),
    order({ id: 4, deliveryMethod: 'pickup', deliverySlot: null, shippingCost: 0, total: 2880 }),
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

  it('cantidades: punto y coma son decimales', () => {
    expect(parseQuantityInput('1,25')).toBe(1.25);
    expect(parseQuantityInput('1.250')).toBe(1.25);
    expect(parseQuantityInput('300')).toBe(300);
    expect(parseQuantityInput(' ')).toBeNull();
    expect(Number.isNaN(parseQuantityInput('-1'))).toBe(true);
    expect(formatQuantityInput(1.35, 'kg')).toBe('1,35');
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

  it('descuentos rápidos redondeados a $10', () => {
    expect(discountedPrice(1290, 10)).toBe(1160);
    expect(discountedPrice(50, 10)).toBe(45);
  });
});

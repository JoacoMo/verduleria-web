import { describe, expect, it } from 'vitest';
import type { OrderRecord, Product } from '@/lib/types';
import { groupOrdersByDelivery, summarizeDay, totalLabel } from './orders-model';
import { discountedPrice, productToFormState, validateOffer, validateProductForm, EMPTY_PRODUCT_FORM } from './product-form-model';
import { firstName, formatQuantityInput, parseMoneyInput, parseQuantityInput, shiftDate } from './format';

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

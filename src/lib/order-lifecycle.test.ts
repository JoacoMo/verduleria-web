import { describe, expect, it } from 'vitest';
import {
  CLOSED_ORDER_RETENTION_DAYS,
  OPEN_ORDER_STATUSES,
  ORDER_RECORD_SELECT,
  STALE_PENDING_DAYS,
  applyOrderAdjustment,
  describeStatusConflict,
  getCleanupCutoffs,
  isOrderStatus,
  parseStoredOrderItems,
  slotFromId,
  toOrderRecord,
  type OrderRecordRow,
} from './order-lifecycle';
import { ValidationError } from './validation';
import type { OrderItem } from './types';

const NOW = new Date('2026-10-05T15:00:00.000Z'); // lunes 12:00 en Córdoba

describe('estados', () => {
  it('isOrderStatus y estados abiertos', () => {
    for (const status of ['pending', 'paid', 'cancelled', 'failed']) expect(isOrderStatus(status)).toBe(true);
    for (const value of ['PENDING', 'refunded', '', null, 1]) expect(isOrderStatus(value)).toBe(false);
    expect(OPEN_ORDER_STATUSES).toEqual(['pending', 'failed']);
  });

  it('mensaje del 409 con la etiqueta en castellano', () => {
    expect(describeStatusConflict('paid')).toBe('El pedido ya figura como "Pagado".');
    expect(describeStatusConflict('cancelled')).toBe('El pedido ya figura como "Cancelado".');
    expect(describeStatusConflict('raro')).toBe('El pedido ya figura como "raro".');
  });

  it('el select del panel nunca expone la clave de idempotencia ni columnas de Mercado Pago', () => {
    expect(Object.keys(ORDER_RECORD_SELECT)).not.toContain('idempotencyKey');
    expect(Object.keys(ORDER_RECORD_SELECT)).not.toContain('mpPreferenceId');
    expect(Object.keys(ORDER_RECORD_SELECT)).not.toContain('mpPaymentId');
  });
});

describe('parseStoredOrderItems', () => {
  it('lee con tolerancia: descarta lo roto y completa lo que falta', () => {
    expect(parseStoredOrderItems([
      { id: 1, name: 'Tomate', price: 1000, quantity: 1.5, unit: 'kg' },
      { id: 2, price: 500, quantity: 2, unit: 'litro' },
      { id: '3', name: 'x', price: 1, quantity: 1 },
      { id: 4, name: 'x', price: '1', quantity: 1 },
      { id: 5, name: 'x', price: 1, quantity: Number.NaN },
      { id: 6.5, name: 'x', price: 1, quantity: 1 },
      null,
      'texto',
    ])).toEqual([
      { id: 1, name: 'Tomate', price: 1000, quantity: 1.5, unit: 'kg' },
      { id: 2, name: 'Producto 2', price: 500, quantity: 2, unit: 'kg' },
    ]);
  });

  it('lo que no es lista → []', () => {
    for (const value of [null, undefined, {}, 'x', 1]) expect(parseStoredOrderItems(value)).toEqual([]);
  });
});

describe('toOrderRecord', () => {
  const row = (overrides: Partial<OrderRecordRow> = {}): OrderRecordRow => ({
    id: 7,
    items: [{ id: 1, name: 'Tomate', price: 1000, quantity: 1, unit: 'kg' }],
    subtotal: 1000,
    shippingCost: 0,
    total: 1000,
    status: 'pending',
    deliveryMethod: 'pickup',
    paymentMethod: 'cash',
    deliverySlot: null,
    adjustedAt: null,
    customerName: 'Ana',
    customerPhone: '3511234567',
    customerAddress: null,
    notes: null,
    replacementPolicy: 'replace',
    createdAt: new Date('2026-10-05T12:00:00Z'),
    updatedAt: new Date('2026-10-05T12:30:00Z'),
    ...overrides,
  });

  it('serializa fechas y acota valores desconocidos', () => {
    expect(toOrderRecord(row({ adjustedAt: new Date('2026-10-05T13:00:00Z') }))).toMatchObject({
      id: 7,
      status: 'pending',
      deliveryMethod: 'pickup',
      paymentMethod: 'cash',
      adjustedAt: '2026-10-05T13:00:00.000Z',
      createdAt: '2026-10-05T12:00:00.000Z',
      updatedAt: '2026-10-05T12:30:00.000Z',
    });
    expect(toOrderRecord(row({ status: 'raro', deliveryMethod: 'drone', paymentMethod: 'mercadopago' }))).toMatchObject({
      status: 'pending',
      deliveryMethod: 'pickup',
      paymentMethod: null,
      adjustedAt: null,
    });
  });
});

describe('slotFromId', () => {
  it('turno todavía vigente: usa la etiqueta relativa', () => {
    expect(slotFromId('2026-10-05T13', NOW)?.label).toBe('Hoy de 13 a 14 h');
  });

  it('turno que ya pasó: se arma con la fecha', () => {
    expect(slotFromId('2026-10-01T19', NOW)).toEqual({ id: '2026-10-01T19', date: '2026-10-01', start: 1140, end: 1200, label: 'Jueves 1/10 de 19 a 20 h' });
  });

  it('null para vacío o ids inválidos', () => {
    expect(slotFromId(null, NOW)).toBeNull();
    expect(slotFromId('', NOW)).toBeNull();
    expect(slotFromId('2026-10-05T15', NOW)).toBeNull();
    expect(slotFromId('cualquiera', NOW)).toBeNull();
  });
});

describe('applyOrderAdjustment', () => {
  const stored: OrderItem[] = [
    { id: 1, name: 'Tomate', price: 1000, quantity: 1.5, unit: 'kg' },
    { id: 2, name: 'Acelga', price: 900, quantity: 2, unit: 'atado' },
    { id: 3, name: 'Nuez', price: 20, quantity: 200, unit: 'g' },
  ];

  it('usa el precio guardado, normaliza las cantidades y recalcula sin tocar el envío', () => {
    const result = applyOrderAdjustment(stored, [{ id: 1, quantity: 1.37 }, { id: 2, quantity: 2 }, { id: 3, quantity: 260 }], 4000);
    expect(result.items).toEqual([
      { id: 1, name: 'Tomate', price: 1000, quantity: 1.35, unit: 'kg' },
      { id: 2, name: 'Acelga', price: 900, quantity: 2, unit: 'atado' },
      { id: 3, name: 'Nuez', price: 20, quantity: 250, unit: 'g' },
    ]);
    expect(result.subtotal).toBe(1350 + 1800 + 5000);
    expect(result.total).toBe(1350 + 1800 + 5000 + 4000);
  });

  it('cantidad 0 o ítem que no viene = se saca', () => {
    const result = applyOrderAdjustment(stored, [{ id: 1, quantity: 0 }, { id: 2, quantity: 1 }], 0);
    expect(result.items.map((item) => item.id)).toEqual([2]);
    expect(result.total).toBe(900);
  });

  it('no se pueden agregar productos que no estaban', () => {
    const error = (() => {
      try {
        applyOrderAdjustment(stored, [{ id: 99, quantity: 1 }], 0);
      } catch (caught) {
        return caught as Error;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(ValidationError);
    expect(error?.message).toBe('El producto 99 no estaba en el pedido. Solo se pueden ajustar los que pidió el cliente.');
  });

  it('tiene que quedar al menos un producto', () => {
    expect(() => applyOrderAdjustment(stored, [], 0)).toThrow('El pedido tiene que quedar con al menos un producto. Si no se lleva nada, cancelalo.');
    expect(() => applyOrderAdjustment(stored, [{ id: 1, quantity: 0 }], 0)).toThrow(ValidationError);
  });

  it('respeta el tope por unidad', () => {
    expect(() => applyOrderAdjustment(stored, [{ id: 1, quantity: 100.05 }], 0)).toThrow('La cantidad de Tomate es demasiado grande (máximo 100 kg).');
    expect(() => applyOrderAdjustment(stored, [{ id: 2, quantity: 101 }], 0)).toThrow('La cantidad de Acelga es demasiado grande (máximo 100 atados).');
    // 100,01 kg se normaliza a 100 kg (precisión de 50 g) y entra justo.
    expect(applyOrderAdjustment(stored, [{ id: 1, quantity: 100.01 }], 0).subtotal).toBe(100_000);
  });
});

describe('getCleanupCutoffs', () => {
  it('7 días para los pendientes y 90 para los cerrados', () => {
    expect(STALE_PENDING_DAYS).toBe(7);
    expect(CLOSED_ORDER_RETENTION_DAYS).toBe(90);
    expect(getCleanupCutoffs(NOW)).toEqual({
      cancelPendingBefore: new Date('2026-09-28T15:00:00.000Z'),
      deleteClosedBefore: new Date('2026-07-07T15:00:00.000Z'),
    });
  });
});

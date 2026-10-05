import { describe, expect, it } from 'vitest';
import { formatArs } from '@/lib/format-price';
import type { Product } from '@/lib/types';
import { applyPriceChanges, markUnavailable, withServerPrice } from './catalog-updates';
import { formatOfferEnds, formatPhoneForDisplay } from './format';
import { buildOrderMessage, buildOrderWhatsappUrl, type OrderMessageInput } from './order-message';
import { clampQuantity, fromDisplayQuantity, parseQuantityInput, toDisplayQuantity } from './quantity';
import { toCartLines } from './storage';
import { validateCheckout } from './use-checkout-form';

// Los montos se arman con el mismo formateador que usa la tienda (Intl pone un
// espacio duro entre "$" y el número, que no conviene escribir a mano).
const ars = (text: string) => text.replace(/\$ ([\d.]+)/g, (_match, amount: string) => formatArs(Number(amount.replace(/\./g, ''))));

function baseMessage(overrides: Partial<OrderMessageInput> = {}): OrderMessageInput {
  return {
    orderId: 123,
    storeName: 'El Pampa',
    customerName: '  Ana Pérez ',
    items: [
      { id: 1, name: 'Tomate', price: 800, quantity: 1.5, unit: 'kg' },
      { id: 2, name: 'Acelga', price: 500, quantity: 2, unit: 'atado' },
    ],
    subtotal: 2200,
    shippingCost: 4000,
    total: 6200,
    deliveryMethod: 'delivery',
    customerAddress: 'Rosario de Santa Fe 1211',
    deliverySlotId: '2026-10-05T13',
    paymentMethod: 'transfer',
    replacementPolicy: 'replace',
    notes: 'Timbre 2B',
    ...overrides,
  };
}

describe('buildOrderMessage', () => {
  it('arma el mensaje con negritas, ítems, envío, turno y pago', () => {
    const message = buildOrderMessage(baseMessage());
    const lines = message.split('\n');
    expect(lines[0]).toBe('🥬 *Pedido #123 — El Pampa*');
    expect(lines[1]).toBe('👤 Ana Pérez');
    expect(message).toContain('🛒 *Productos*');
    expect(message).toContain(ars('• 1,5 kg Tomate — $ 1.200'));
    expect(message).toContain(ars('• 2 atados Acelga — $ 1.000'));
    expect(message).toContain(ars('Subtotal: $ 2.200'));
    expect(message).toContain(ars('Envío: $ 4.000'));
    expect(message).toContain(ars('💰 *Total aprox.: $ 6.200*'));
    expect(message).toContain('🚚 *Envío a domicilio:* Rosario de Santa Fe 1211');
    expect(message).toContain('🕐 *Turno:* Lunes 5/10 de 13 a 14 h');
    expect(message).toContain('💳 *Pago:* Transferencia (cuando me pasen el total final)');
    expect(message).toContain('🔁 *Si falta algo:* Reemplazar por uno similar');
    expect(message).toContain('📝 *Aclaraciones:* Timbre 2B');
  });

  it('sin nada por peso el total es exacto, y con retiro no hay subtotal ni envío', () => {
    const message = buildOrderMessage(baseMessage({
      items: [{ id: 2, name: 'Acelga', price: 500, quantity: 2, unit: 'atado' }],
      subtotal: 1000,
      shippingCost: 0,
      total: 1000,
      deliveryMethod: 'pickup',
      customerAddress: null,
      deliverySlotId: null,
      paymentMethod: 'cash',
      notes: '   ',
    }));
    expect(message).toContain(ars('💰 *Total: $ 1.000*'));
    expect(message).not.toContain('aprox.');
    expect(message).not.toContain('Subtotal');
    expect(message).toContain('🏪 *Retiro en el local*');
    expect(message).toContain('💵 *Pago:* Efectivo al retirar');
    expect(message).not.toContain('Aclaraciones');
  });

  it('el envío gratis se escribe "gratis"', () => {
    const message = buildOrderMessage(baseMessage({ shippingCost: 0 }));
    expect(message).toContain('Envío: gratis');
  });

  it('el link va al número del local con el texto codificado', () => {
    const url = buildOrderWhatsappUrl('5493517656500', baseMessage());
    expect(url.startsWith('https://wa.me/5493517656500?text=')).toBe(true);
    expect(decodeURIComponent(url.split('?text=')[1])).toBe(buildOrderMessage(baseMessage()));
  });
});

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

  it('acepta coma decimal', () => {
    expect(parseQuantityInput('1,5')).toBe(1.5);
    expect(parseQuantityInput(' 2 ')).toBe(2);
    expect(Number.isNaN(parseQuantityInput(''))).toBe(true);
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

import { describe, expect, it } from 'vitest';
import { formatArs } from '@/lib/format-price';
import { buildOrderMessage, buildOrderWhatsappUrl, type OrderMessageInput } from './order-message';

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
  it('arma el mensaje completo línea por línea', () => {
    expect(buildOrderMessage(baseMessage()).split('\n')).toEqual([
      '🥬 *Pedido #123 — El Pampa*',
      '👤 Ana Pérez',
      '',
      '🛒 *Productos*',
      ars('• 1,5 kg Tomate — $ 1.200'),
      ars('• 2 atados Acelga — $ 1.000'),
      '',
      ars('Subtotal: $ 2.200'),
      ars('Envío: $ 4.000'),
      ars('💰 *Total aprox.: $ 6.200*'),
      '_Lo que va por peso se ajusta al pesar: espero el total final por acá._',
      '',
      '🚚 *Envío a domicilio:* Rosario de Santa Fe 1211',
      '🕐 *Turno:* Lunes 5/10 de 13 a 14 h',
      '💳 *Pago:* Transferencia (cuando me pasen el total final)',
      '🔁 *Si falta algo:* Reemplazar por uno similar',
      '📝 *Aclaraciones:* Timbre 2B',
    ]);
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
    expect(message).not.toContain('Turno');
    expect(message.split('\n')).toContain('🏪 *Retiro en el local*');
    expect(message).toContain('💵 *Pago:* Efectivo al retirar');
    expect(message).not.toContain('Aclaraciones');
    expect(message).not.toContain('_Lo que va por peso');
  });

  it('retiro: dice cuándo está listo', () => {
    const message = buildOrderMessage(baseMessage({
      deliveryMethod: 'pickup',
      customerAddress: null,
      deliverySlotId: null,
      pickupReady: 'mañana desde las 8:00',
    }));
    expect(message).toContain('🏪 *Retiro en el local* (listo mañana desde las 8:00)');
    // Con envío no se usa.
    expect(buildOrderMessage(baseMessage({ pickupReady: 'hoy desde las 17:30' }))).not.toContain('listo');
  });

  it('transferencia sin nada por peso no dice "cuando me pasen el total final"', () => {
    const message = buildOrderMessage(baseMessage({ items: [{ id: 2, name: 'Acelga', price: 500, quantity: 2, unit: 'atado' }] }));
    expect(message).toContain('💳 *Pago:* Transferencia\n');
  });

  it('el envío gratis se escribe "gratis" y el efectivo con envío se paga al recibir', () => {
    const message = buildOrderMessage(baseMessage({ shippingCost: 0, paymentMethod: 'cash' }));
    expect(message).toContain('Envío: gratis');
    expect(message).toContain('💵 *Pago:* Efectivo al recibir');
  });

  it('envío sin dirección ni turno describible', () => {
    const message = buildOrderMessage(baseMessage({ customerAddress: '   ', deliverySlotId: 'roto', deliverySlotLabel: 'Hoy de 19 a 20 h' }));
    expect(message).toContain('🚚 *Envío a domicilio:* a coordinar');
    expect(message).toContain('🕐 *Turno:* Hoy de 19 a 20 h');
    expect(buildOrderMessage(baseMessage({ deliverySlotId: null }))).not.toContain('Turno');
  });

  it('el turno se escribe con fecha absoluta aunque haya etiqueta relativa', () => {
    expect(buildOrderMessage(baseMessage({ deliverySlotLabel: 'Hoy de 13 a 14 h' }))).toContain('🕐 *Turno:* Lunes 5/10 de 13 a 14 h');
  });

  it('políticas de reemplazo', () => {
    expect(buildOrderMessage(baseMessage({ replacementPolicy: 'skip' }))).toContain('🔁 *Si falta algo:* No reemplazar, sacarlo del pedido');
    expect(buildOrderMessage(baseMessage({ replacementPolicy: 'call' }))).toContain('🔁 *Si falta algo:* Llamarme o escribirme antes');
  });

  it('gramos y bandejas', () => {
    const message = buildOrderMessage(baseMessage({
      items: [
        { id: 3, name: 'Nuez', price: 20, quantity: 250, unit: 'g' },
        { id: 4, name: 'Huevos', price: 3000, quantity: 1, unit: 'bandeja' },
      ],
    }));
    expect(message).toContain(ars('• 250 g Nuez — $ 5.000'));
    expect(message).toContain(ars('• 1 bandeja Huevos — $ 3.000'));
  });
});

describe('buildOrderWhatsappUrl', () => {
  it('va al número del local con el texto codificado', () => {
    const url = buildOrderWhatsappUrl('5493517656500', baseMessage());
    expect(url.startsWith('https://wa.me/5493517656500?text=')).toBe(true);
    expect(decodeURIComponent(url.split('?text=')[1])).toBe(buildOrderMessage(baseMessage()));
  });

  it('caracteres especiales en las notas no rompen el link', () => {
    const input = baseMessage({ notes: 'Depto 4 & 5 #B ¿tocar? 100% "timbre"' });
    const url = new URL(buildOrderWhatsappUrl('5493517656500', input));
    expect(url.searchParams.get('text')).toBe(buildOrderMessage(input));
  });
});

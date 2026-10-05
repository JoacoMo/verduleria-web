import { describe, expect, it } from 'vitest';
import { formatArs } from '@/lib/format-price';
import type { OrderRecord, StoreInfo } from '@/lib/types';
import { buildFinalTotalMessage, buildReviewRequestMessage } from './order-messages';

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
  it('arma el detalle completo con pesos reales, envío, turno y transferencia', () => {
    expect(buildFinalTotalMessage(order(), STORE).split('\n')).toEqual([
      '*Hola Ana!* tu pedido #123 de El Pampa ya está armado ✅',
      '',
      `• 1,35 kg de Tomate: ${formatArs(1080)}`,
      `• 2 atados de Acelga: ${formatArs(1800)}`,
      '',
      `Subtotal: ${formatArs(2880)}`,
      `Envío: ${formatArs(4000)}`,
      `*Total final: ${formatArs(6880)}* (envío incluido)`,
      '',
      'Te lo llevamos el martes 6/10 de 13 a 14 h a Av. Colón 123.',
      '',
      'Para pagar por transferencia:',
      // El alias va sin asteriscos: si no, al copiarlo se copian también.
      'Alias: el.pampa.verdu',
      'CBU: 0000003100000000000001',
      'Cuando transfieras, mandanos el comprobante por acá.',
      '',
      '¡Gracias!',
    ]);
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
    expect(text).toContain('Alias: el.pampa.verdu');
    expect(text).not.toContain('CBU');
  });

  it('sin alias ni CBU avisa que se pasan por acá', () => {
    const text = buildFinalTotalMessage(order(), { ...STORE, transferAlias: '  ', transferCbu: '' });
    expect(text).not.toContain('Alias');
    expect(text).toContain('Te pasamos por acá los datos para transferir. Cuando transfieras, mandanos el comprobante.');
  });

  it('un pedido viejo sin medio de pago se trata como transferencia', () => {
    expect(buildFinalTotalMessage(order({ paymentMethod: null }), STORE)).toContain('Para pagar por transferencia:');
  });

  it('envío sin turno ni dirección', () => {
    expect(buildFinalTotalMessage(order({ deliverySlot: null, customerAddress: null }), STORE)).toContain('\nTe lo llevamos.\n');
    expect(buildFinalTotalMessage(order({ deliverySlot: '2026-10-06T19', customerAddress: '  ' }), STORE)).toContain('Te lo llevamos el martes 6/10 de 19 a 20 h.');
  });
});

describe('buildReviewRequestMessage', () => {
  it('solo con el pedido pagado y el link configurado', () => {
    expect(buildReviewRequestMessage(order({ status: 'pending' }), STORE)).toBeNull();
    expect(buildReviewRequestMessage(order({ status: 'cancelled' }), STORE)).toBeNull();
    expect(buildReviewRequestMessage(order({ status: 'paid' }), { ...STORE, googleReviewUrl: '' })).toBeNull();
    expect(buildReviewRequestMessage(order({ status: 'paid' }), { ...STORE, googleReviewUrl: '   ' })).toBeNull();
  });

  it('saluda por el primer nombre y pega el link', () => {
    expect(buildReviewRequestMessage(order({ status: 'paid' }), STORE)?.split('\n')).toEqual([
      '*Hola Ana!* Gracias por comprar en El Pampa 💚',
      '',
      'Si te gustó el pedido, ¿nos dejás una reseña en Google? Es un minuto y a una verdulería de barrio le suma muchísimo:',
      'https://g.page/r/elpampa/review',
      '',
      '¡Gracias!',
    ]);
  });
});

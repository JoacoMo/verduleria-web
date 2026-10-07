import { describe, expect, it, vi } from 'vitest';
import type { OrderItem } from '@/lib/types';
import {
  adjustmentItems,
  buildAdjustLines,
  describeItemChange,
  diffOrderItems,
  initialDrafts,
  isDraftDirty,
  rebaseDrafts,
  stepAdjustQuantity,
  summarizeAdjustLines,
} from './order-adjust-model';
import {
  ADJUST_DRAFT_MAX_AGE_MS,
  adjustDraftKey,
  clearAdjustDraft,
  describeHiddenDrafts,
  findHiddenDraftIds,
  hasAdjustDrafts,
  listAdjustDraftOrderIds,
  parseStoredAdjustDraft,
  readAdjustDraft,
  writeAdjustDraft,
  type StoredAdjustDraft,
} from './adjust-drafts';

/** sessionStorage en memoria (los tests corren en Node, sin navegador). */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
  };
}

const ITEMS: OrderItem[] = [
  { id: 1, name: 'Zapallo', price: 1000, quantity: 12.5, unit: 'kg' },
  { id: 2, name: 'Ajo', price: 10, quantity: 100, unit: 'g' },
  { id: 3, name: 'Lechuga', price: 900, quantity: 2, unit: 'unidad' },
];

describe('líneas del editor de pesos', () => {
  it('arranca con lo guardado, el peso en kilos con hasta 3 decimales', () => {
    expect(initialDrafts([{ ...ITEMS[0], quantity: 11.235 }, ITEMS[1], ITEMS[2]])).toEqual({
      1: { text: '11,235', removed: false },
      2: { text: '100', removed: false },
      3: { text: '2', removed: false },
    });
  });

  it('guarda con la precisión de la balanza (5 g), no la de 50 g del carrito', () => {
    const lines = buildAdjustLines(ITEMS, {
      1: { text: '11,237', removed: false },
      2: { text: '333', removed: false },
      3: { text: '3', removed: false },
    });
    expect(lines.map((line) => [line.quantity, line.rounded])).toEqual([[11.235, true], [335, true], [3, false]]);
    // Un peso que ya está en el paso de 5 g se guarda tal cual.
    expect(buildAdjustLines(ITEMS, { 1: { text: '11.235', removed: false } })[0]).toMatchObject({ quantity: 11.235, rounded: false });

    const totals = summarizeAdjustLines(lines, 4000);
    expect(totals.subtotal).toBe(11235 + 3350 + 2700);
    expect(totals.total).toBe(11235 + 3350 + 2700 + 4000);
    expect(adjustmentItems(lines)).toEqual([{ id: 1, quantity: 11.235 }, { id: 2, quantity: 335 }, { id: 3, quantity: 3 }]);
  });

  it('"1.500" son mil quinientos en gramos y unidades, y un kilo y medio en kilos', () => {
    const lines = buildAdjustLines(ITEMS, {
      1: { text: '1.500', removed: false },
      2: { text: '1.500', removed: false },
      3: { text: '1,500', removed: false },
    });
    expect(lines[0]).toMatchObject({ quantity: 1.5, problem: null });
    expect(lines[1]).toMatchObject({ quantity: 1500, problem: null, rounded: false });
    // 1500 lechugas pasan el tope: se avisa en vez de guardar 1,5 → 2.
    expect(lines[2].problem).toMatch(/máximo 200/);
    expect(buildAdjustLines(ITEMS, { 2: { text: '1.500,5', removed: false } })[1].quantity).toBe(1500);
  });

  it('0 o el tacho sacan el producto; vacío, texto o demasiado son errores', () => {
    const lines = buildAdjustLines(ITEMS, {
      1: { text: '0', removed: false },
      2: { text: '', removed: false },
      3: { text: 'dos', removed: false },
    });
    expect(lines[0]).toMatchObject({ removed: true, problem: null, quantity: 0 });
    expect(lines[1].problem).toMatch(/Poné la cantidad/);
    expect(lines[2].problem).toBe('Escribí un número.');
    expect(summarizeAdjustLines(lines, 0)).toMatchObject({ hasProblems: true, allRemoved: false });

    expect(buildAdjustLines(ITEMS, { 1: { text: '101', removed: false } })[0].problem).toMatch(/máximo 100 kg/);
    const allRemoved = buildAdjustLines(ITEMS, {
      1: { text: '12,5', removed: true },
      2: { text: '0', removed: false },
      3: { text: '', removed: true },
    });
    expect(summarizeAdjustLines(allRemoved, 0)).toMatchObject({ allRemoved: true, hasProblems: false, subtotal: 0 });
    expect(adjustmentItems(allRemoved).map((item) => item.quantity)).toEqual([0, 0, 0]);
  });

  it('los botones -/+ van de a 5 g y dejan siempre un valor que se guarda tal cual', () => {
    expect(stepAdjustQuantity(11.237, 'kg', 1)).toBe(11.24);
    expect(stepAdjustQuantity(11.237, 'kg', -1)).toBe(11.23);
    expect(stepAdjustQuantity(0.005, 'kg', -1)).toBe(0);
    expect(stepAdjustQuantity(0, 'kg', -1)).toBe(0);
    expect(stepAdjustQuantity(333, 'g', 1)).toBe(340);
    expect(stepAdjustQuantity(2, 'atado', -1)).toBe(1);
  });

  it('sabe si el dueño tocó algo (para guardar o no el borrador)', () => {
    expect(isDraftDirty(initialDrafts(ITEMS), ITEMS)).toBe(false);
    expect(isDraftDirty({ ...initialDrafts(ITEMS), 1: { text: '11,237', removed: false } }, ITEMS)).toBe(true);
    expect(isDraftDirty({ ...initialDrafts(ITEMS), 3: { text: '2', removed: true } }, ITEMS)).toBe(true);
  });
});

describe('qué cambió mientras el editor estaba abierto', () => {
  it('lista las cantidades nuevas y lo que se sacó', () => {
    const current: OrderItem[] = [
      { ...ITEMS[0], quantity: 12 },
      ITEMS[1],
    ];
    const changes = diffOrderItems(ITEMS, current);
    expect(changes.map(describeItemChange)).toEqual([
      'Zapallo: ahora 12 kg (antes 12,5 kg)',
      'Lechuga: lo sacaron del pedido',
    ]);
    expect(diffOrderItems(ITEMS, ITEMS)).toEqual([]);
  });

  it('"Seguir con lo que cargué" deja lo que tocó el dueño y toma lo guardado en el resto', () => {
    // Otro celular pesó la lechuga (2 → 3) y sacó el ajo; acá el dueño solo cargó el zapallo.
    const current: OrderItem[] = [ITEMS[0], { ...ITEMS[2], quantity: 3 }];
    const mine = { ...initialDrafts(ITEMS), 1: { text: '11,237', removed: false } };
    expect(rebaseDrafts(mine, ITEMS, current)).toEqual({
      1: { text: '11,237', removed: false },
      3: { text: '3', removed: false },
    });
    // Si también había tocado la lechuga, queda lo suyo (vio el aviso con lo guardado).
    const both = { ...mine, 3: { text: '2', removed: true } };
    expect(rebaseDrafts(both, ITEMS, current)[3]).toEqual({ text: '2', removed: true });
  });
});

describe('borradores en sessionStorage', () => {
  const now = new Date('2026-10-06T23:00:00.000Z');
  const stored: StoredAdjustDraft = {
    orderId: 28,
    baseUpdatedAt: '2026-10-06T20:00:00.000Z',
    baseItems: ITEMS,
    drafts: { 1: { text: '11,237', removed: false }, 3: { text: '2', removed: true } },
    savedAt: '2026-10-06T22:59:00.000Z',
  };

  it('recupera un borrador válido del mismo pedido', () => {
    expect(adjustDraftKey(28)).toBe('adm-ajuste-28');
    expect(parseStoredAdjustDraft(JSON.stringify(stored), 28, now)).toEqual(stored);
    expect(parseStoredAdjustDraft(JSON.stringify({ ...stored, baseUpdatedAt: null }), 28, now)?.baseUpdatedAt).toBeNull();
  });

  it('descarta lo que no sirve: otro pedido, vencido, roto o con otra forma', () => {
    expect(parseStoredAdjustDraft(null, 28, now)).toBeNull();
    expect(parseStoredAdjustDraft('{no es json', 28, now)).toBeNull();
    expect(parseStoredAdjustDraft(JSON.stringify(stored), 29, now)).toBeNull();
    const old = new Date(now.getTime() - ADJUST_DRAFT_MAX_AGE_MS - 1).toISOString();
    expect(parseStoredAdjustDraft(JSON.stringify({ ...stored, savedAt: old }), 28, now)).toBeNull();
    expect(parseStoredAdjustDraft(JSON.stringify({ ...stored, savedAt: 'ayer' }), 28, now)).toBeNull();
    expect(parseStoredAdjustDraft(JSON.stringify({ ...stored, drafts: { 1: { text: 5, removed: false } } }), 28, now)).toBeNull();
    expect(parseStoredAdjustDraft(JSON.stringify({ ...stored, baseItems: [{ ...ITEMS[0], unit: 'litro' }] }), 28, now)).toBeNull();
    expect(parseStoredAdjustDraft(JSON.stringify({ ...stored, baseUpdatedAt: 7 }), 28, now)).toBeNull();
  });
});

describe('borradores en la pestaña (sessionStorage)', () => {
  const draft = {
    orderId: 28,
    baseUpdatedAt: '2026-10-06T20:00:00.000Z',
    baseItems: ITEMS,
    drafts: { 1: { text: '11,237', removed: false } },
  };

  it('guarda, recupera y borra el borrador de cada pedido', () => {
    const storage = memoryStorage();
    vi.stubGlobal('window', { sessionStorage: storage });

    expect(hasAdjustDrafts()).toBe(false);
    writeAdjustDraft(draft);
    writeAdjustDraft({ ...draft, orderId: 7 });
    storage.setItem('otra-cosa', '1');
    storage.setItem(adjustDraftKey(99), '{roto');

    expect(readAdjustDraft(28)).toMatchObject({ orderId: 28, drafts: draft.drafts, baseUpdatedAt: draft.baseUpdatedAt });
    // El roto no cuenta (y al leerlo se borra); lo que no es del editor no se toca.
    expect(listAdjustDraftOrderIds()).toEqual([7, 28]);
    expect(readAdjustDraft(99)).toBeNull();
    expect(storage.getItem(adjustDraftKey(99))).toBeNull();
    expect(storage.getItem('otra-cosa')).toBe('1');

    clearAdjustDraft(28);
    expect(readAdjustDraft(28)).toBeNull();
    expect(hasAdjustDrafts()).toBe(true);
    clearAdjustDraft(7);
    expect(hasAdjustDrafts()).toBe(false);
  });

  it('sin almacenamiento (modo privado estricto, servidor) no rompe nada', () => {
    vi.stubGlobal('window', {
      get sessionStorage(): Storage {
        throw new Error('SecurityError');
      },
    });
    expect(() => writeAdjustDraft(draft)).not.toThrow();
    expect(readAdjustDraft(28)).toBeNull();
    expect(listAdjustDraftOrderIds()).toEqual([]);
    expect(() => clearAdjustDraft(28)).not.toThrow();
  });

  it('avisa por los borradores de pedidos que no están en pantalla', () => {
    expect(findHiddenDraftIds([7, 28, 31], [{ id: 28 }, { id: 40 }])).toEqual([7, 31]);
    expect(findHiddenDraftIds([28], [{ id: 28 }])).toEqual([]);
    expect(describeHiddenDrafts([28])).toBe(
      'Quedaron pesos sin guardar del pedido #28, que no figura en la lista de hoy. '
        + 'Si sigue pendiente, buscalo en el día de su entrega: ahí el editor aparece con lo que habías cargado.',
    );
    expect(describeHiddenDrafts([7, 28, 31])).toMatch(/^Quedaron pesos sin guardar de los pedidos #7, #28 y #31, que no figuran/);
  });
});

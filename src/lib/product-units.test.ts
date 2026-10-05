import { describe, expect, it } from 'vitest';
import {
  PRODUCT_CART_STEP,
  PRODUCT_DEFAULT_CART_QUANTITY,
  PRODUCT_MAX_CART_QUANTITY,
  PRODUCT_UNITS,
  PRODUCT_UNIT_CODES,
  PRODUCT_UNIT_LABELS,
  PRODUCT_UNIT_NAMES,
  formatProductQuantity,
  isProductUnit,
  isWeightUnit,
  lineWeightKg,
  normalizeProductQuantity,
} from './product-units';

describe('tablas por unidad', () => {
  it('todas las unidades tienen etiqueta, nombre, código, default, paso y tope', () => {
    for (const unit of PRODUCT_UNITS) {
      expect(PRODUCT_UNIT_LABELS[unit], unit).toBeTruthy();
      expect(PRODUCT_UNIT_NAMES[unit], unit).toBeTruthy();
      expect(PRODUCT_UNIT_CODES[unit], unit).toMatch(/^[A-Z0-9]{3}$/);
      expect(PRODUCT_CART_STEP[unit], unit).toBeGreaterThan(0);
      expect(PRODUCT_MAX_CART_QUANTITY[unit], unit).toBeGreaterThan(PRODUCT_DEFAULT_CART_QUANTITY[unit]);
    }
  });

  it('el default, el paso y el tope ya están normalizados (normalizar no los mueve)', () => {
    for (const unit of PRODUCT_UNITS) {
      expect(normalizeProductQuantity(PRODUCT_DEFAULT_CART_QUANTITY[unit], unit), unit).toBe(PRODUCT_DEFAULT_CART_QUANTITY[unit]);
      expect(normalizeProductQuantity(PRODUCT_CART_STEP[unit], unit), unit).toBe(PRODUCT_CART_STEP[unit]);
      expect(normalizeProductQuantity(PRODUCT_MAX_CART_QUANTITY[unit], unit), unit).toBe(PRODUCT_MAX_CART_QUANTITY[unit]);
    }
  });
});

describe('isProductUnit / isWeightUnit', () => {
  it('solo las cinco unidades conocidas, en minúscula', () => {
    for (const unit of PRODUCT_UNITS) expect(isProductUnit(unit)).toBe(true);
    for (const value of ['KG', 'Kg', 'kilo', 'litro', '', ' kg', null, undefined, 1, {}, ['kg']]) {
      expect(isProductUnit(value), String(value)).toBe(false);
    }
  });

  it('kg y g son por peso', () => {
    expect(PRODUCT_UNITS.filter(isWeightUnit)).toEqual(['kg', 'g']);
  });
});

describe('formatProductQuantity', () => {
  it.each([
    [1, 'kg', '1 kg'],
    [1.5, 'kg', '1,5 kg'],
    [0.25, 'kg', '0,25 kg'],
    [0.05, 'kg', '0,05 kg'],
    [2.1, 'kg', '2,1 kg'],
    [1.333, 'kg', '1,33 kg'],
    [100, 'kg', '100 kg'],
    [250, 'g', '250 g'],
    [250.4, 'g', '250 g'],
    [1, 'unidad', '1 unidad'],
    [2, 'unidad', '2 unidades'],
    [0, 'unidad', '0 unidades'],
    [1.4, 'unidad', '1 unidad'],
    [1, 'atado', '1 atado'],
    [3, 'atado', '3 atados'],
    [1, 'bandeja', '1 bandeja'],
    [2, 'bandeja', '2 bandejas'],
  ] as const)('%s %s → %s', (quantity, unit, text) => {
    expect(formatProductQuantity(quantity, unit)).toBe(text);
  });
});

describe('normalizeProductQuantity', () => {
  it('no positivas o no finitas → 0', () => {
    for (const unit of PRODUCT_UNITS) {
      for (const value of [0, -1, -0.05, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        expect(normalizeProductQuantity(value, unit), `${value} ${unit}`).toBe(0);
      }
    }
  });

  it('kg: a 50 g, con mínimo 50 g y sin arrastres de coma flotante', () => {
    expect(normalizeProductQuantity(0.001, 'kg')).toBe(0.05);
    expect(normalizeProductQuantity(0.024, 'kg')).toBe(0.05);
    expect(normalizeProductQuantity(0.3, 'kg')).toBe(0.3);
    expect(normalizeProductQuantity(0.333, 'kg')).toBe(0.35);
    expect(normalizeProductQuantity(1.15, 'kg')).toBe(1.15);
    expect(normalizeProductQuantity(1.234, 'kg')).toBe(1.25);
    expect(normalizeProductQuantity(1.37, 'kg')).toBe(1.35);
    expect(normalizeProductQuantity(2, 'kg')).toBe(2);
  });

  it('g: a múltiplos de 50, con mínimo 50', () => {
    expect(normalizeProductQuantity(1, 'g')).toBe(50);
    expect(normalizeProductQuantity(74, 'g')).toBe(50);
    expect(normalizeProductQuantity(75, 'g')).toBe(100);
    expect(normalizeProductQuantity(325, 'g')).toBe(350);
    expect(normalizeProductQuantity(1000, 'g')).toBe(1000);
  });

  it('por cantidad: entero más cercano, mínimo 1', () => {
    expect(normalizeProductQuantity(0.2, 'unidad')).toBe(1);
    expect(normalizeProductQuantity(1.4, 'atado')).toBe(1);
    expect(normalizeProductQuantity(1.5, 'atado')).toBe(2);
    expect(normalizeProductQuantity(2.5, 'bandeja')).toBe(3);
  });

  it('no recorta al tope (eso lo hace quien arma el pedido)', () => {
    expect(normalizeProductQuantity(500, 'kg')).toBe(500);
  });
});

describe('lineWeightKg', () => {
  it('kilos, gramos a kilos y 0 para lo que va por cantidad', () => {
    expect(lineWeightKg({ unit: 'kg', quantity: 1.5 })).toBe(1.5);
    expect(lineWeightKg({ unit: 'g', quantity: 250 })).toBe(0.25);
    expect(lineWeightKg({ unit: 'unidad', quantity: 3 })).toBe(0);
    expect(lineWeightKg({ unit: 'atado', quantity: 3 })).toBe(0);
  });
});

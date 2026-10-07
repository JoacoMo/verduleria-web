import { describe, expect, it } from 'vitest';
import { compareProductNames, compareProducts } from './product-order';

describe('orden del catálogo', () => {
  it('alfabético en castellano: sin mayúsculas ni tildes, la ñ después de la n y números como números', () => {
    const names = ['Zapallo', 'ají', 'Ajo', 'Ñame', 'Nabo', 'Bolsón 10 kg', 'Bolsón 2 kg', 'acelga', 'Ánana'];
    expect([...names].sort(compareProductNames)).toEqual([
      'acelga', 'ají', 'Ajo', 'Ánana', 'Bolsón 2 kg', 'Bolsón 10 kg', 'Nabo', 'Ñame', 'Zapallo',
    ]);
  });

  it('no depende de los espacios como la collation en_US de Postgres', () => {
    expect(['Producto 10 b', 'Producto 1 a', 'Producto 2 c'].sort(compareProductNames))
      .toEqual(['Producto 1 a', 'Producto 2 c', 'Producto 10 b']);
  });

  it('los disponibles primero; con el mismo nombre desempata el id', () => {
    const products = [
      { id: 3, name: 'Banana', available: false },
      { id: 9, name: 'Tomate', available: true },
      { id: 5, name: 'Acelga', available: true },
      { id: 2, name: 'Acelga', available: true },
      { id: 1, name: 'Ajo', available: false },
    ];
    expect([...products].sort(compareProducts).map((product) => product.id)).toEqual([2, 5, 9, 1, 3]);
  });
});

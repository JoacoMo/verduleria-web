/**
 * Catálogo conocido que siembra la globalSetup. Los tests que necesitan
 * productos propios los crean con `createProduct()` (helpers.ts) para no
 * depender de estos ni pisarse entre ellos; estos sirven para los GET públicos.
 */
export const SEED_PRODUCTS = [
  { name: 'Seed Tomate', price: 1000, image: '', unit: 'kg', category: 'Verduras', available: true },
  { name: 'Seed Acelga', price: 900, image: '', unit: 'atado', category: 'Verduras', available: true },
  { name: 'Seed Banana', price: 1500, image: '', unit: 'kg', category: 'Frutas', available: true },
  { name: 'Seed Bolsón chico', price: 12000, image: '', unit: 'unidad', category: 'Bolsones', description: 'Papa\nCebolla\nZanahoria', available: true },
  { name: 'Seed Albahaca', price: 700, image: '', unit: 'atado', category: 'Verduras', available: false },
];

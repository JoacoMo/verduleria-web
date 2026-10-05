import { beforeEach, expect, it, vi } from 'vitest';
import { GET as getProducts } from '@/app/api/products/route';
import { GET as getStoreInfo } from '@/app/api/store-info/route';
import type { Product, StoreInfo } from '@/lib/types';
import { SEED_PRODUCTS } from './seed-data';
import { apiRequest, describeDb, prisma, readJson } from './helpers';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describeDb('GET /api/products', () => {
  it('devuelve el catálogo sembrado, disponibles primero y alfabético, sin createdAt', async () => {
    const response = await getProducts(apiRequest('/api/products'));
    expect(response.status).toBe(200);
    const products = await readJson<Product[]>(response);

    const seeded = products.filter((product) => product.name.startsWith('Seed '));
    expect(seeded.map((product) => product.name).sort()).toEqual(SEED_PRODUCTS.map((product) => product.name).sort());
    expect(products.every((product) => !('createdAt' in product))).toBe(true);
    expect(seeded.find((product) => product.name === 'Seed Bolsón chico')).toMatchObject({
      price: 12000,
      unit: 'unidad',
      category: 'Bolsones',
      description: 'Papa\nCebolla\nZanahoria',
      available: true,
      offerPrice: null,
      offerEndsAt: null,
    });

    // Orden: todos los disponibles antes que cualquier no disponible.
    const firstUnavailable = products.findIndex((product) => !product.available);
    expect(firstUnavailable).toBeGreaterThan(-1);
    expect(products.slice(firstUnavailable).every((product) => !product.available)).toBe(true);
    const availableNames = products.slice(0, firstUnavailable).map((product) => product.name);
    expect(availableNames).toEqual([...availableNames].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('un error de base es un error (500), no un catálogo inventado', async () => {
    vi.spyOn(prisma.product, 'findMany').mockRejectedValueOnce(new Error('timeout'));
    const response = await getProducts(apiRequest('/api/products'));
    expect(response.status).toBe(500);
    expect(await readJson(response)).toEqual({ error: 'No se pudo cargar el catálogo. Probá de nuevo en un rato.' });
  });

  it('un GET público nunca escribe en la base (no siembra con la tabla vacía)', async () => {
    const before = await prisma.product.count();
    await getProducts(apiRequest('/api/products'));
    expect(await prisma.product.count()).toBe(before);
  });
});

describeDb('GET /api/store-info', () => {
  it('solo los datos públicos del local, ningún secreto', async () => {
    const response = await getStoreInfo(apiRequest('/api/store-info'));
    expect(response.status).toBe(200);
    const info = await readJson<StoreInfo>(response);
    expect(Object.keys(info).sort()).toEqual([
      'contactEmail',
      'deliveryFee',
      'deliveryFreeThreshold',
      'deliveryMaxWeightKg',
      'deliveryMinPurchase',
      'googleReviewUrl',
      'instagramUrl',
      'storeAddress',
      'storeHours',
      'storeName',
      'storeNeighborhood',
      'transferAlias',
      'transferCbu',
      'whatsappNumber',
    ]);
    expect(info).toMatchObject({ storeName: 'El Pampa', deliveryFee: 4000, deliveryFreeThreshold: 20000, deliveryMinPurchase: 10000 });
    const raw = JSON.stringify(info);
    for (const secret of ['JWT_SECRET', 'ADMIN_PASSWORD', 'CRON_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL']) {
      expect(raw).not.toContain(process.env[secret]!);
    }
  });
});

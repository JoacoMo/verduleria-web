import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Cachés del catálogo. `unstable_cache` se reemplaza por uno que anota con qué
 * opciones se creó cada caché, y la base por una vacía.
 */
const created = vi.hoisted(() => [] as Array<{ keyParts: string[]; options: { tags?: string[]; revalidate?: number } }>);

vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown, keyParts: string[], options: { tags?: string[]; revalidate?: number }) => {
    created.push({ keyParts, options });
    return fn;
  },
  revalidateTag: vi.fn(),
}));

vi.mock('./prisma', () => ({ prisma: { product: { findMany: vi.fn(async () => []) } } }));

const { PRODUCTS_CACHE_TAG, SLOW_CACHE_SECONDS } = await import('./products');

describe('cachés del catálogo', () => {
  it('la tienda usa la de 60 s; sitemap y llms.txt una de 1 h con el MISMO tag (el panel invalida las dos)', () => {
    expect(created).toEqual([
      { keyParts: ['productos-listado'], options: { tags: [PRODUCTS_CACHE_TAG], revalidate: 60 } },
      { keyParts: ['productos-listado-lento'], options: { tags: [PRODUCTS_CACHE_TAG], revalidate: SLOW_CACHE_SECONDS } },
    ]);
    expect(SLOW_CACHE_SECONDS).toBe(3600);
  });
});

describe('sitemap.xml y llms.txt leen la caché lenta', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function withProductsSpy() {
    const fast = vi.fn(async () => []);
    const slow = vi.fn(async () => []);
    vi.doMock('@/lib/products', () => ({ getCachedProducts: fast, getCachedProductsSlow: slow }));
    return { fast, slow };
  }

  // Era un bug: con la caché de 60 s, Next regeneraba las dos rutas cada minuto
  // (toma el revalidate más corto entre la ruta y sus cachés).
  it('sitemap: revalidate 3600 y caché lenta', async () => {
    const { fast, slow } = await withProductsSpy();
    const sitemap = await import('@/app/sitemap');
    expect(sitemap.revalidate).toBe(3600);
    expect((await sitemap.default()).length).toBeGreaterThan(0);
    expect(slow).toHaveBeenCalledTimes(1);
    expect(fast).not.toHaveBeenCalled();
  });

  it('llms.txt: revalidate 600, caché lenta y s-maxage coherente', async () => {
    const { fast, slow } = await withProductsSpy();
    const llms = await import('@/app/llms.txt/route');
    expect(llms.revalidate).toBe(600);
    const response = await llms.GET();
    expect(response.headers.get('cache-control')).toContain('s-maxage=600');
    expect(slow).toHaveBeenCalledTimes(1);
    expect(fast).not.toHaveBeenCalled();
  });

  it('llms.txt no promete que un retiro del domingo a la tarde se prepara ese día', async () => {
    await withProductsSpy();
    const llms = await import('@/app/llms.txt/route');
    const text = await (await llms.GET()).text();
    expect(text).toContain('Los pedidos para retirar hechos después de las 19:00 (los domingos, después de las 14:00) se preparan al día siguiente que abre el local.');
  });
});

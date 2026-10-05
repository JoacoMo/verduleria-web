import { revalidateTag } from 'next/cache';
import { beforeEach, expect, it, vi } from 'vitest';
import { POST as createProductRoute } from '@/app/api/gestion/products/route';
import { DELETE as deleteProductRoute, PUT as updateProductRoute } from '@/app/api/gestion/products/[id]/route';
import { PUT as availabilityRoute } from '@/app/api/gestion/products/[id]/availability/route';
import { POST as bulkRoute } from '@/app/api/gestion/products/bulk/route';
import { formatArs } from '@/lib/format-price';
import { isOfferActive } from '@/lib/pricing';
import { PRODUCTS_CACHE_TAG } from '@/lib/products';
import type { Product } from '@/lib/types';
import { adminCookie, apiRequest, createProduct, describeDb, prisma, readJson, routeParams } from './helpers';

const DAY = 24 * 60 * 60 * 1000;

function send(path: string, method: string, body: unknown) {
  return apiRequest(path, { method, body, cookie: adminCookie() });
}

const put = (id: number | string, body: unknown) => updateProductRoute(send(`/api/gestion/products/${id}`, 'PUT', body), routeParams(id));
const bulk = (body: unknown) => bulkRoute(send('/api/gestion/products/bulk', 'POST', body));

/** "YYYY-MM-DD" de dentro de N días (hora argentina, aprox.: alcanza para fechas futuras). */
function dateInDays(days: number) {
  return new Date(Date.now() + days * DAY - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describeDb('POST /api/gestion/products', () => {
  it('crea el producto (201), invalida la caché del catálogo y responde el Product serializado', async () => {
    const endsOn = dateInDays(5);
    const response = await createProductRoute(send('/api/gestion/products', 'POST', {
      name: '  Tomate cherry ',
      price: '2500',
      unit: 'bandeja',
      category: 'Verduras',
      image: 'https://cdn.example/tomate.webp',
      description: 'Bandeja de 250 g',
      offerPrice: 2000,
      offerEndsAt: endsOn,
      id: 1, // se ignora
    }));
    expect(response.status).toBe(201);
    const product = await readJson<Product>(response);
    expect(product).toMatchObject({
      id: expect.any(Number),
      name: 'Tomate cherry',
      price: 2500,
      unit: 'bandeja',
      category: 'Verduras',
      image: 'https://cdn.example/tomate.webp',
      description: 'Bandeja de 250 g',
      offerPrice: 2000,
      available: true,
    });
    expect(product.id).not.toBe(1);
    expect(product.offerEndsAt).toBe(new Date(`${endsOn}T23:59:59.999-03:00`).toISOString());
    expect(revalidateTag).toHaveBeenCalledWith(PRODUCTS_CACHE_TAG);
    expect(await prisma.product.findUnique({ where: { id: product.id } })).toMatchObject({ name: 'Tomate cherry', offerPrice: 2000 });
  });

  it('oferta >= precio → 400 y no se crea nada', async () => {
    const name = `Oferta mala ${Date.now()}`;
    for (const offerPrice of [1000, 1500]) {
      const response = await createProductRoute(send('/api/gestion/products', 'POST', { name, price: 1000, unit: 'kg', category: 'Frutas', offerPrice }));
      expect(response.status).toBe(400);
      expect((await readJson<{ error: string }>(response)).error).toBe(
        `El precio de oferta (${formatArs(offerPrice)}) tiene que ser menor que el precio normal (${formatArs(1000)}).`,
      );
    }
    expect(await prisma.product.count({ where: { name } })).toBe(0);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('validaciones → 400 con el mensaje; JSON roto → 400', async () => {
    const bad = [
      [{ price: 1000, unit: 'kg', category: 'Frutas' }, 'El nombre del producto es obligatorio.'],
      [{ name: 'X', price: -5, unit: 'kg', category: 'Frutas' }, `El precio debe ser un número mayor a 0 y hasta ${formatArs(10_000_000)}.`],
      [{ name: 'X', price: 0, unit: 'kg', category: 'Frutas' }, `El precio debe ser un número mayor a 0 y hasta ${formatArs(10_000_000)}.`],
      [{ name: '\u2066\u2069', price: 5, unit: 'kg', category: 'Frutas' }, 'El nombre del producto es obligatorio.'],
      [{ name: 'X', price: 5, unit: 'litro', category: 'Frutas' }, 'La unidad debe ser kg, g, unidad, atado o bandeja.'],
      [{ name: 'X', price: 5, unit: 'kg', category: 'Frutas', image: 'javascript:alert(1)' }, 'La imagen solo puede ser una URL http o https.'],
      [{ name: 'X', price: 5, unit: 'kg', category: 'Frutas', offerPrice: 1, offerEndsAt: '2020-01-01' }, 'La fecha de vencimiento de la oferta ya pasó.'],
    ] as const;
    for (const [payload, message] of bad) {
      const response = await createProductRoute(send('/api/gestion/products', 'POST', payload));
      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({ error: message });
    }
    const broken = await createProductRoute(apiRequest('/api/gestion/products', { method: 'POST', rawBody: '{"name":', cookie: adminCookie() }));
    expect(broken.status).toBe(400);
  });
});

describeDb('PUT /api/gestion/products/[id]', () => {
  it('edición parcial: cambia solo lo que vino', async () => {
    const product = await createProduct({ price: 1000, name: 'Papa negra' });
    const response = await put(product.id, { price: 1200 });
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ id: product.id, name: 'Papa negra', price: 1200 });
    expect(revalidateTag).toHaveBeenCalledWith(PRODUCTS_CACHE_TAG);
  });

  it('oferta >= precio guardado → 400', async () => {
    const product = await createProduct({ price: 1000 });
    const response = await put(product.id, { offerPrice: 1000 });
    expect(response.status).toBe(400);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).offerPrice).toBeNull();
  });

  it('precio nuevo por debajo de la oferta vigente → 400; con la oferta vencida, se puede', async () => {
    const active = await createProduct({ price: 1000, offerPrice: 800, offerEndsAt: new Date(Date.now() + DAY) });
    const blocked = await put(active.id, { price: 700 });
    expect(blocked.status).toBe(400);
    expect((await readJson<{ error: string }>(blocked)).error).toMatch(/tiene que ser mayor que el de la oferta vigente/);

    const expired = await createProduct({ price: 1000, offerPrice: 800, offerEndsAt: new Date(Date.now() - DAY) });
    expect((await put(expired.id, { price: 700 })).status).toBe(200);
  });

  it('precio y oferta juntos se comparan entre sí, no con lo guardado', async () => {
    const product = await createProduct({ price: 1000, offerPrice: 900 });
    const response = await put(product.id, { price: 3000, offerPrice: 2500, offerEndsAt: dateInDays(3) });
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ price: 3000, offerPrice: 2500 });
  });

  it('offerPrice null saca la oferta y su vencimiento', async () => {
    const product = await createProduct({ price: 1000, offerPrice: 800, offerEndsAt: new Date(Date.now() + DAY) });
    const response = await put(product.id, { offerPrice: null, offerEndsAt: '2020-01-01' });
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({ offerPrice: null, offerEndsAt: null });
  });

  it('vencimiento sin oferta (ni nueva ni guardada) → 400', async () => {
    const product = await createProduct({ price: 1000 });
    const response = await put(product.id, { offerEndsAt: dateInDays(2) });
    expect(response.status).toBe(400);
    expect(await readJson(response)).toEqual({ error: 'Para ponerle vencimiento a la oferta, cargá también el precio de oferta.' });
  });

  it('sin cambios → 400; id inválido → 400; inexistente → 404', async () => {
    const product = await createProduct();
    expect(await readJson(await put(product.id, {}))).toEqual({ error: 'No hay cambios para guardar.' });
    expect(await readJson(await put(product.id, { foo: 'bar' }))).toEqual({ error: 'No hay cambios para guardar.' });
    for (const id of ['abc', '0', '-3', '1.5']) {
      const response = await put(id, { price: 1 });
      expect(response.status, id).toBe(400);
      expect(await readJson(response)).toEqual({ error: 'Id de producto inválido.' });
    }
    // Con y sin campos de precio (el primero falla al leer lo guardado, el segundo en el update).
    for (const payload of [{ price: 1 }, { name: 'Nuevo nombre' }]) {
      const response = await put(99_999_999, payload);
      expect(response.status).toBe(404);
      expect(await readJson(response)).toEqual({ error: 'El producto no existe.' });
    }
  });

  // Era un bug: con una oferta VENCIDA guardada, cargar un precio de oferta nuevo
  // sin offerEndsAt dejaba el vencimiento viejo y la oferta nacía vencida (200
  // sin aviso). Ahora una oferta nueva sin fecha es una oferta sin vencimiento.
  it('una oferta nueva sin vencimiento no hereda el vencimiento viejo', async () => {
    const product = await createProduct({ price: 1000, offerPrice: 900, offerEndsAt: new Date(Date.now() - DAY) });
    const response = await put(product.id, { offerPrice: 700 });
    expect(response.status).toBe(200);
    const saved = await readJson<Product>(response);
    expect(isOfferActive(saved)).toBe(true);
    expect(saved.offerEndsAt).toBeNull();
  });

  it('una oferta con vencimiento FUTURO sí lo conserva al cambiar solo el precio de oferta', async () => {
    const endsAt = new Date(Date.now() + 3 * DAY);
    const product = await createProduct({ price: 1000, offerPrice: 900, offerEndsAt: endsAt });
    const saved = await readJson<Product>(await put(product.id, { offerPrice: 800 }));
    expect(saved.offerPrice).toBe(800);
    expect(saved.offerEndsAt).toBe(endsAt.toISOString());
  });
});

describeDb('DELETE /api/gestion/products/[id]', () => {
  it('borra (204), invalida la caché y un segundo borrado da 404', async () => {
    const product = await createProduct();
    const first = await deleteProductRoute(send(`/api/gestion/products/${product.id}`, 'DELETE', undefined), routeParams(product.id));
    expect(first.status).toBe(204);
    expect(await first.text()).toBe('');
    expect(revalidateTag).toHaveBeenCalledWith(PRODUCTS_CACHE_TAG);
    const second = await deleteProductRoute(send(`/api/gestion/products/${product.id}`, 'DELETE', undefined), routeParams(product.id));
    expect(second.status).toBe(404);
    expect((await deleteProductRoute(send('/api/gestion/products/x', 'DELETE', undefined), routeParams('x'))).status).toBe(400);
  });
});

describeDb('PUT /api/gestion/products/[id]/availability', () => {
  const setAvailability = (id: number | string, body: unknown) =>
    availabilityRoute(send(`/api/gestion/products/${id}/availability`, 'PUT', body), routeParams(id));

  it('marca sin stock y vuelve a habilitar', async () => {
    const product = await createProduct();
    const off = await setAvailability(product.id, { available: false });
    expect(off.status).toBe(200);
    expect(await readJson(off)).toMatchObject({ id: product.id, available: false });
    expect(revalidateTag).toHaveBeenCalledWith(PRODUCTS_CACHE_TAG);
    expect(await readJson(await setAvailability(product.id, { available: true }))).toMatchObject({ available: true });
  });

  it('solo acepta boolean; inexistente → 404; id inválido → 400', async () => {
    const product = await createProduct();
    for (const body of [{}, { available: 'false' }, { available: 0 }, { available: null }]) {
      const response = await setAvailability(product.id, body);
      expect(response.status).toBe(400);
      expect(await readJson(response)).toEqual({ error: 'La disponibilidad debe ser verdadero o falso.' });
    }
    expect((await setAvailability(99_999_999, { available: true })).status).toBe(404);
    expect((await setAvailability('abc', { available: true })).status).toBe(400);
  });
});

describeDb('POST /api/gestion/products/bulk', () => {
  it('aplica precios, stock y ofertas en una tanda e informa los que no existen', async () => {
    const a = await createProduct({ price: 1000 });
    const b = await createProduct({ price: 2000, available: false });
    const c = await createProduct({ price: 3000, offerPrice: 2500 });
    const response = await bulk({
      updates: [
        { id: a.id, price: 1100 },
        { id: b.id, available: true, price: '2100' },
        { id: 99_999_999, price: 5 },
        { id: c.id, offerPrice: null },
      ],
    });
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ updated: 3, notFound: [99_999_999] });
    expect(await prisma.product.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ price: 1100 });
    expect(await prisma.product.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ price: 2100, available: true });
    expect(await prisma.product.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ offerPrice: null, offerEndsAt: null });
    // Una sola invalidación para toda la tanda.
    expect(revalidateTag).toHaveBeenCalledTimes(1);
  });

  it('todo o nada: si un ítem choca con su oferta, no se escribe ninguno', async () => {
    const a = await createProduct({ price: 1000 });
    const b = await createProduct({ price: 2000, offerPrice: 1500 });
    const response = await bulk({ updates: [{ id: a.id, price: 1234 }, { id: b.id, price: 1400 }] });
    expect(response.status).toBe(400);
    const data = await readJson<{ error: string; index: number }>(response);
    expect(data.index).toBe(1);
    expect(data.error).toMatch(new RegExp(`^Ítem 2 \\(producto ${b.id}\\): El precio nuevo`));
    expect((await prisma.product.findUniqueOrThrow({ where: { id: a.id } })).price).toBe(1000);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: b.id } })).price).toBe(2000);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('todo o nada: un ítem mal formado corta antes de leer la base', async () => {
    const a = await createProduct({ price: 1000 });
    const response = await bulk({ updates: [{ id: a.id, price: 1 }, { id: a.id, price: 2 }] });
    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({ index: 1 });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: a.id } })).price).toBe(1000);
  });

  it('solo ids inexistentes: 200 sin cambios y sin invalidar la caché', async () => {
    const response = await bulk({ updates: [{ id: 99_999_990, price: 1 }, { id: 99_999_991, available: false }] });
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ updated: 0, notFound: [99_999_990, 99_999_991] });
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('forma inválida → 400', async () => {
    for (const payload of [{}, { updates: [] }, { updates: 'x' }, { updates: Array.from({ length: 501 }, (_, i) => ({ id: i + 1, price: 1 })) }]) {
      expect((await bulk(payload)).status).toBe(400);
    }
  });

  // Mismo caso que en el PUT, por el bulk (lo usa el script de precios).
  it('bulk con offerPrice sin offerEndsAt sobre una oferta vencida la deja vigente', async () => {
    const product = await createProduct({ price: 1000, offerPrice: 900, offerEndsAt: new Date(Date.now() - DAY) });
    expect(await readJson(await bulk({ updates: [{ id: product.id, offerPrice: 700 }] }))).toEqual({ updated: 1, notFound: [] });
    const saved = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(isOfferActive(saved)).toBe(true);
  });
});

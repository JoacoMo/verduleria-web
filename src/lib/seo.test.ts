import { describe, expect, it } from 'vitest';
import {
  absoluteUrl,
  buildBreadcrumbs,
  buildProductOffers,
  getDeliveryScheduleText,
  getFullAddress,
  getLeadTimeText,
  getStreetAddress,
  jsonLdGraph,
  jsonLdScriptProps,
  matchesCategoryPage,
  serializeJsonLd,
} from './seo';
import type { Product } from './types';

// Los datos del local salen del `env` de vitest.config.ts (SITE_URL=https://elpampa.test).
const SITE = 'https://elpampa.test';
const NOW = new Date('2026-10-05T15:00:00.000Z');

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

describe('serializeJsonLd', () => {
  it('un </script> en un dato no puede cerrar el bloque', () => {
    const data = { name: '</script><script>alert(1)</script>', description: 'a <b> & c', nested: [{ x: '<!--' }] };
    const output = serializeJsonLd(data);
    expect(output).not.toContain('<');
    expect(output).not.toContain('>');
    expect(output).not.toContain('&');
    expect(output.toLowerCase()).not.toContain('</script');
    expect(output).toContain('\\u003c/script\\u003e');
    // Sigue siendo el mismo JSON.
    expect(JSON.parse(output)).toEqual(data);
  });

  it('jsonLdScriptProps arma el bloque de datos sin nonce', () => {
    const props = jsonLdScriptProps({ name: '</script>' });
    expect(props.type).toBe('application/ld+json');
    expect(props.dangerouslySetInnerHTML.__html).toBe('{"name":"\\u003c/script\\u003e"}');
    expect(props).not.toHaveProperty('nonce');
  });

  it('jsonLdGraph descarta los nodos vacíos', () => {
    expect(jsonLdGraph([{ '@type': 'A' }, null, undefined, { '@type': 'B' }])).toEqual({
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'A' }, { '@type': 'B' }],
    });
  });
});

describe('URLs y dirección', () => {
  it('absoluteUrl', () => {
    expect(absoluteUrl('/')).toBe(`${SITE}/`);
    expect(absoluteUrl('')).toBe(`${SITE}/`);
    expect(absoluteUrl('/bolsones')).toBe(`${SITE}/bolsones`);
    expect(absoluteUrl('bolsones')).toBe(`${SITE}/bolsones`);
  });

  it('dirección completa sin repetir barrio ni ciudad', () => {
    expect(getStreetAddress()).toBe('Rosario de Santa Fe 1211');
    expect(getFullAddress()).toBe('Rosario de Santa Fe 1211, Barrio General Paz, Córdoba Capital');
  });

  it('migas de pan numeradas desde 1', () => {
    expect(buildBreadcrumbs([{ name: 'Inicio', path: '/' }, { name: 'Bolsones', path: '/bolsones' }])).toEqual({
      '@type': 'BreadcrumbList',
      '@id': `${SITE}/bolsones#migas`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: 'Bolsones', item: `${SITE}/bolsones` },
      ],
    });
  });
});

describe('textos de envíos', () => {
  it('derivados de los turnos y del horario', () => {
    expect(getDeliveryScheduleText()).toEqual({
      weekdays: 'de 13 a 14 h y de 19 a 20 h',
      sunday: 'de 13 a 14 h',
      summary: 'De lunes a sábado, de 13 a 14 h y de 19 a 20 h. Los domingos, solo de 13 a 14 h.',
      deadlines: 'para el de 13 a 14 h, hasta las 12:00, y para el de 19 a 20 h, hasta las 18:00',
    });
    expect(getLeadTimeText()).toBe('1 hora');
  });
});

describe('catálogo en JSON-LD', () => {
  it('la página de ofertas incluye la categoría vieja y las ofertas vigentes', () => {
    expect(matchesCategoryPage(product({ category: 'Ofertas' }), 'Ofertas', NOW)).toBe(true);
    expect(matchesCategoryPage(product({ offerPrice: 800 }), 'Ofertas', NOW)).toBe(true);
    expect(matchesCategoryPage(product({ offerPrice: 800, offerEndsAt: '2026-10-01T02:59:59.999Z' }), 'Ofertas', NOW)).toBe(false);
    expect(matchesCategoryPage(product(), 'Verduras', NOW)).toBe(true);
    expect(matchesCategoryPage(product(), 'Frutas', NOW)).toBe(false);
  });

  it('oferta vigente: precio de oferta, ListPrice tachado y vencimiento en fecha argentina', () => {
    const [offer] = buildProductOffers([product({ offerPrice: 800, offerEndsAt: '2026-10-12T02:59:59.999Z' })], NOW);
    expect(offer.price).toBe(800);
    expect(offer.priceValidUntil).toBe('2026-10-11');
    expect(offer.availability).toBe('https://schema.org/InStock');
    expect(offer.priceSpecification).toEqual([
      expect.objectContaining({ price: 800, priceCurrency: 'ARS', referenceQuantity: expect.objectContaining({ unitCode: 'KGM' }) }),
      expect.objectContaining({ price: 1000, priceType: 'https://schema.org/ListPrice' }),
    ]);
    expect(offer.url).toBe(`${SITE}/verduras`);
  });

  it('sin oferta: un solo precio, sin vencimiento; sin stock = OutOfStock', () => {
    const [offer] = buildProductOffers([product({ available: false, unit: 'unidad', category: 'Almacén' })], NOW);
    expect(offer.price).toBe(1000);
    expect(offer).not.toHaveProperty('priceValidUntil');
    expect(offer.availability).toBe('https://schema.org/OutOfStock');
    expect(offer.priceSpecification).toMatchObject({ referenceQuantity: { unitCode: 'C62' } });
    // Almacén no tiene página propia: va a la home.
    expect(offer.url).toBe(`${SITE}/`);
  });

  it('imagen: los placeholders no se publican y las rutas propias van absolutas', () => {
    const offers = buildProductOffers([
      product({ image: '/product-placeholder.svg' }),
      product({ image: 'https://via.placeholder.com/150' }),
      product({ image: '/fotos/tomate.webp' }),
      product({ image: 'https://cdn.example/tomate.webp' }),
      product({ image: 'javascript:alert(1)' }),
    ], NOW);
    expect(offers.map((offer) => (offer.itemOffered as { image?: string }).image)).toEqual([
      undefined,
      undefined,
      `${SITE}/fotos/tomate.webp`,
      'https://cdn.example/tomate.webp',
      undefined,
    ]);
  });

  it('la descripción de un bolsón (una línea por producto) va en una sola línea', () => {
    const [offer] = buildProductOffers([product({ category: 'Bolsones', description: 'Papa 2 kg,\nCebolla 1 kg;\n\n  Zanahoria  \n' })], NOW);
    expect((offer.itemOffered as { description?: string }).description).toBe('Papa 2 kg, Cebolla 1 kg, Zanahoria');
  });
});

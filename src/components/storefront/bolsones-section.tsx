'use client';

import { ShoppingBasket } from 'lucide-react';
import ProductGrid, { type ProductGridProps } from './product-grid';

type BolsonesSectionProps = Omit<ProductGridProps, 'featured' | 'className' | 'imageOffset'>;

/**
 * "Bolsones de la semana": los arma el local con lo mejor de la temporada y son
 * lo que más se repite entre los clientes de siempre. Van arriba del catálogo y
 * con la descripción entera, porque lo que importa es qué trae cada uno.
 */
export default function BolsonesSection(props: BolsonesSectionProps) {
  if (props.products.length === 0) return null;

  return (
    <section className="bolsones-section" id="bolsones" aria-labelledby="bolsones-title">
      <h2 id="bolsones-title">
        <ShoppingBasket size={30} aria-hidden="true" /> Bolsones de la semana
      </h2>
      <p className="section-subtitle">
        Los armamos nosotros con lo mejor de la semana. Fijate qué trae cada uno y sumalo con un toque.
      </p>
      <ProductGrid {...props} featured className="product-grid bolsones-grid" imageOffset={0} />
    </section>
  );
}

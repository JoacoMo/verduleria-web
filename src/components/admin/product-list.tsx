'use client';

import { useId, useMemo, useState } from 'react';
import { Ban, Check, Package, Pencil, RefreshCw, Search, Tag, Trash2 } from 'lucide-react';
import type { Product } from '@/lib/types';
import { PRODUCT_UNIT_LABELS } from '@/lib/product-units';
import { PRODUCT_CATEGORIES, isProductCategory, type ProductCategory } from '@/lib/product-categories';
import { formatArs } from '@/lib/format-price';
import { getDiscountPercent, getEffectivePrice, isOfferActive } from '@/lib/pricing';
import { matchesSearch } from '@/lib/search';
import type { AdminClient } from './api';
import { InlineAlert } from './notices';
import { Spinner } from './fields';
import { OfferEditor } from './offer-editor';
import { describeDate, toArgentinaDate } from './format';

const PLACEHOLDER_IMAGE = '/product-placeholder.svg';
const INITIAL_VISIBLE_PRODUCTS = 8;

type ProductSort = 'alpha' | 'newest' | 'oldest';
type ProductFilter = 'todas' | 'con-oferta' | 'sin-stock' | ProductCategory;

type ProductListProps = {
  products: Product[];
  status: 'loading' | 'ready' | 'error';
  error: string;
  onRetry: () => void;
  client: AdminClient;
  editingProductId: number | null;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
  onToggleAvailability: (product: Product) => void;
  onProductUpdated: (product: Product, message: string) => void;
};

function matchesFilter(product: Product, filter: ProductFilter, now: Date) {
  if (filter === 'todas') return true;
  if (filter === 'con-oferta') return isOfferActive(product, now);
  if (filter === 'sin-stock') return !product.available;
  return product.category === filter;
}

export function ProductList({
  products,
  status,
  error,
  onRetry,
  client,
  editingProductId,
  onEdit,
  onDelete,
  onToggleAvailability,
  onProductUpdated,
}: ProductListProps) {
  const baseId = useId();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ProductSort>('alpha');
  const [filter, setFilter] = useState<ProductFilter>('todas');
  const [showAll, setShowAll] = useState(false);
  const [offerEditorId, setOfferEditorId] = useState<number | null>(null);
  const now = new Date();

  const counts = useMemo(() => {
    const reference = new Date();
    return {
      offers: products.filter((product) => isOfferActive(product, reference)).length,
      unavailable: products.filter((product) => !product.available).length,
      byCategory: Object.fromEntries(
        PRODUCT_CATEGORIES.map((category) => [category, products.filter((product) => product.category === category).length]),
      ) as Record<ProductCategory, number>,
    };
  }, [products]);

  const visible = useMemo(() => {
    const reference = new Date();
    const query = search.trim();
    const filtered = products.filter((product) => (
      matchesFilter(product, filter, reference) && (!query || matchesSearch(product.name, query))
    ));
    const sorted = [...filtered];
    if (sort === 'alpha') sorted.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    else if (sort === 'newest') sorted.sort((a, b) => b.id - a.id);
    else sorted.sort((a, b) => a.id - b.id);
    return sorted;
  }, [products, search, filter, sort]);

  const isNarrowed = search.trim().length > 0 || filter !== 'todas';
  const shown = isNarrowed || showAll ? visible : visible.slice(0, INITIAL_VISIBLE_PRODUCTS);
  const hiddenCount = visible.length - shown.length;

  if (status === 'loading' && products.length === 0) {
    return <p className="adm-empty"><Spinner /> Cargando productos…</p>;
  }

  return (
    <div className="adm-product-list">
      {status === 'error' ? (
        <InlineAlert
          action={(
            <button type="button" className="adm-btn adm-btn--secondary adm-btn--small" onClick={onRetry}>
              <RefreshCw size={16} aria-hidden="true" /> Reintentar
            </button>
          )}
        >
          {error}
        </InlineAlert>
      ) : null}

      <div className="adm-toolbar">
        <div className="adm-search">
          <Search size={18} aria-hidden="true" className="adm-search__icon" />
          <input
            className="adm-input adm-search__input"
            type="search"
            placeholder="Buscar producto…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Buscar productos"
          />
        </div>
        <label className="adm-inline-select" htmlFor={`${baseId}-filter`}>
          <span>Mostrar</span>
          <select
            id={`${baseId}-filter`}
            className="adm-select"
            value={filter}
            onChange={(event) => {
              const value = event.target.value;
              setFilter(value === 'con-oferta' || value === 'sin-stock' || isProductCategory(value) ? value : 'todas');
            }}
          >
            <option value="todas">Todos ({products.length})</option>
            <option value="con-oferta">Con oferta vigente ({counts.offers})</option>
            <option value="sin-stock">Sin stock ({counts.unavailable})</option>
            {PRODUCT_CATEGORIES.map((category) => (
              <option key={category} value={category}>{category} ({counts.byCategory[category]})</option>
            ))}
          </select>
        </label>
        <label className="adm-inline-select" htmlFor={`${baseId}-sort`}>
          <span>Orden</span>
          <select
            id={`${baseId}-sort`}
            className="adm-select"
            value={sort}
            onChange={(event) => setSort(event.target.value as ProductSort)}
          >
            <option value="alpha">Nombre (A-Z)</option>
            <option value="newest">Últimos cargados</option>
            <option value="oldest">Primeros cargados</option>
          </select>
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="adm-empty">
          {products.length === 0
            ? 'Todavía no hay productos. Cargá el primero con "Nuevo producto".'
            : search.trim()
              ? `No hay productos que coincidan con "${search.trim()}".`
              : 'No hay productos en este filtro.'}
        </p>
      ) : (
        <ul className="adm-products">
          {shown.map((product) => {
            const offerActive = isOfferActive(product, now);
            const offerExpired = product.offerPrice !== null && !offerActive && product.offerEndsAt !== null
              && new Date(product.offerEndsAt).getTime() <= now.getTime();
            const unit = PRODUCT_UNIT_LABELS[product.unit];
            const editorOpen = offerEditorId === product.id;
            const isBolson = product.category === 'Bolsones';

            return (
              <li
                key={product.id}
                className={[
                  'adm-product',
                  product.available ? '' : 'adm-product--unavailable',
                  editingProductId === product.id ? 'adm-product--editing' : '',
                ].filter(Boolean).join(' ')}
              >
                <div className="adm-product__main">
                  {/* eslint-disable-next-line @next/next/no-img-element -- miniatura de 64 px en el panel: no vale la pena pasar por el optimizador */}
                  <img
                    className="adm-product__img"
                    src={product.image || PLACEHOLDER_IMAGE}
                    alt=""
                    width={64}
                    height={64}
                    loading="lazy"
                    onError={(event) => {
                      if (!event.currentTarget.src.endsWith(PLACEHOLDER_IMAGE)) event.currentTarget.src = PLACEHOLDER_IMAGE;
                    }}
                  />
                  <div className="adm-product__info">
                    <p className="adm-product__name">
                      <strong>{product.name}</strong>
                      {isBolson ? (
                        <span className="adm-badge adm-badge--bolson"><Package size={13} aria-hidden="true" /> Bolsón</span>
                      ) : (
                        <span className="adm-badge adm-badge--category">{product.category}</span>
                      )}
                      {offerActive ? (
                        <span className="adm-badge adm-badge--offer"><Tag size={13} aria-hidden="true" /> Oferta -{getDiscountPercent(product, now)}%</span>
                      ) : null}
                      {product.available ? null : <span className="adm-badge adm-badge--stock">Sin stock</span>}
                    </p>
                    <p className={`adm-product__price${offerActive ? ' adm-product__price--offer' : ''}`}>
                      <span className="adm-price-now">{formatArs(getEffectivePrice(product, now))}</span>
                      {offerActive ? <s className="adm-price-old">{formatArs(product.price)}</s> : null}
                      <span className="adm-product__unit">/ {unit}</span>
                    </p>
                    {offerActive ? (
                      <p className="adm-product__meta">
                        {product.offerEndsAt
                          ? `Oferta hasta el ${describeDate(toArgentinaDate(product.offerEndsAt))}`
                          : 'Oferta sin vencimiento'}
                      </p>
                    ) : offerExpired && product.offerEndsAt ? (
                      <p className="adm-product__meta adm-product__meta--muted">
                        La oferta de {formatArs(product.offerPrice ?? 0)} venció el {describeDate(toArgentinaDate(product.offerEndsAt))}
                      </p>
                    ) : null}
                    {product.description ? <p className="adm-product__desc">{product.description}</p> : null}
                  </div>
                </div>

                <div className="adm-product__actions">
                  <button
                    type="button"
                    className={`adm-btn adm-btn--small ${product.available ? 'adm-btn--warn' : 'adm-btn--primary'}`}
                    onClick={() => onToggleAvailability(product)}
                    title={product.available ? 'Deja de poder pedirse en la tienda' : 'Vuelve a poder pedirse en la tienda'}
                  >
                    {product.available ? <Ban size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
                    {product.available ? 'Marcar sin stock' : 'Marcar disponible'}
                  </button>
                  <button
                    type="button"
                    className={`adm-btn adm-btn--small adm-btn--secondary${editorOpen ? ' is-active' : ''}`}
                    aria-expanded={editorOpen}
                    onClick={() => setOfferEditorId(editorOpen ? null : product.id)}
                  >
                    <Tag size={16} aria-hidden="true" />
                    {offerActive ? 'Oferta' : 'Poner oferta'}
                  </button>
                  <button type="button" className="adm-btn adm-btn--small adm-btn--secondary" onClick={() => onEdit(product)}>
                    <Pencil size={16} aria-hidden="true" /> Editar
                  </button>
                  <button
                    type="button"
                    className="adm-btn adm-btn--small adm-btn--danger-ghost adm-btn--icon"
                    onClick={() => onDelete(product)}
                    aria-label={`Eliminar ${product.name}`}
                    title="Eliminar"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>

                {editorOpen ? (
                  <OfferEditor
                    product={product}
                    client={client}
                    onClose={() => setOfferEditorId(null)}
                    onSaved={(updated, message) => {
                      setOfferEditorId(null);
                      onProductUpdated(updated, message);
                    }}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {hiddenCount > 0 ? (
        <button type="button" className="adm-btn adm-btn--secondary adm-btn--block" onClick={() => setShowAll(true)}>
          Ver todos los productos ({visible.length})
        </button>
      ) : null}
      {!isNarrowed && showAll && visible.length > INITIAL_VISIBLE_PRODUCTS ? (
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--block" onClick={() => setShowAll(false)}>
          Ver menos
        </button>
      ) : null}
    </div>
  );
}

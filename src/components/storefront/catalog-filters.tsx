'use client';

import { Search, X } from 'lucide-react';
import type { CategoryFilter } from '@/lib/product-categories';

type CatalogFiltersProps = {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  categories: CategoryFilter[];
  activeCategory: CategoryFilter;
  onCategoryChange: (category: CategoryFilter) => void;
};

/** Buscador y filtros por categoría del catálogo. */
export default function CatalogFilters({
  searchQuery,
  onSearchChange,
  categories,
  activeCategory,
  onCategoryChange,
}: CatalogFiltersProps) {
  return (
    <>
      <div className="search-bar">
        <Search size={20} aria-hidden="true" />
        <input
          type="search"
          placeholder="Buscar productos..."
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          aria-label="Buscar productos"
          enterKeyHint="search"
          autoComplete="off"
        />
        {searchQuery ? (
          <button type="button" className="search-clear-btn" onClick={() => onSearchChange('')} aria-label="Borrar búsqueda">
            <X size={18} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="category-filters" role="group" aria-label="Filtrar por categoría">
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            className={`category-filter-btn ${activeCategory === category ? 'active' : ''}`}
            aria-pressed={activeCategory === category}
            onClick={() => onCategoryChange(category)}
          >
            {category}
          </button>
        ))}
      </div>
    </>
  );
}

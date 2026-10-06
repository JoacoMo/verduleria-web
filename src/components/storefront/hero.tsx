import { Carrot, ShoppingCart, Truck } from 'lucide-react';
import { DELIVERY_WINDOWS_TEXT } from '@/lib/delivery-slots';
import { formatArs } from '@/lib/format-price';
import type { StoreInfo } from '@/lib/types';

export type StorefrontHeading = { title: string; subtitle: string };

type HeroProps = {
  storeInfo: StoreInfo;
  /** h1 + bajada de las páginas de categoría. Sin esto, el de la home. */
  heading?: StorefrontHeading;
  cartCount: number;
  onOpenCart: () => void;
  /** Al acercarse al botón (mouse, toque o foco): precarga el carrito. */
  onCartIntent?: () => void;
};

/**
 * Cabecera tipo pizarrón. En la home el h1 es la marca grande más la bajada
 * geográfica ("El Pampa · Verdulería en Barrio General Paz"), que es lo que
 * busca la gente. En las páginas de categoría la marca queda como adorno y el
 * h1 es el título propio de la página.
 */
export default function Hero({ storeInfo, heading, cartCount, onOpenCart, onCartIntent }: HeroProps) {
  const defaultTagline = `Frutas y verduras frescas por kilo, gramo o unidad, y bolsones armados. Retirá en el local o recibilo en tu casa de ${DELIVERY_WINDOWS_TEXT}.`;

  return (
    <header className="site-hero">
      <div className="container">
        <div className="hero-text">
          {heading ? (
            <>
              <p className="hero-brand hero-brand-small">
                <Carrot size={30} aria-hidden="true" />
                {storeInfo.storeName}
              </p>
              <h1 className="hero-heading">{heading.title}</h1>
              <HeroUnderline />
              <p className="hero-tagline">{heading.subtitle}</p>
            </>
          ) : (
            <>
              <h1 className="hero-title">
                <span className="hero-brand">
                  <Carrot size={44} aria-hidden="true" />
                  {storeInfo.storeName}
                </span>
                <span className="visually-hidden"> · </span>
                <span className="hero-title-sub">Verdulería en {storeInfo.storeNeighborhood}</span>
              </h1>
              <HeroUnderline />
              <p className="hero-tagline">{defaultTagline}</p>
            </>
          )}
          <p className="hero-shipping-badge">
            <Truck size={18} aria-hidden="true" /> Envío gratis en pedidos desde {formatArs(storeInfo.deliveryFreeThreshold)}
          </p>
        </div>
        <button
          type="button"
          className="cart-icon"
          onClick={onOpenCart}
          onPointerEnter={onCartIntent}
          onPointerDown={onCartIntent}
          onFocus={onCartIntent}
          aria-label={`Abrir carrito (${cartCount} ${cartCount === 1 ? 'producto' : 'productos'})`}
        >
          <ShoppingCart size={26} aria-hidden="true" />
          <span className="cart-count" aria-hidden="true">{cartCount}</span>
        </button>
      </div>
      <svg className="header-edge" viewBox="0 0 1200 26" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
        <path d="M0,0 L0,14 L30,22 L60,10 L90,20 L120,8 L150,18 L180,6 L210,16 L240,4 L270,14 L300,22 L330,10 L360,20 L390,8 L420,18 L450,6 L480,16 L510,4 L540,14 L570,22 L600,10 L630,20 L660,8 L690,18 L720,6 L750,16 L780,4 L810,14 L840,22 L870,10 L900,20 L930,8 L960,18 L990,6 L1020,16 L1050,4 L1080,14 L1110,22 L1140,10 L1170,20 L1200,8 L1200,26 L0,26 Z" fill="#FAF6EC" />
      </svg>
    </header>
  );
}

function HeroUnderline() {
  return (
    <svg className="hero-underline" viewBox="0 0 260 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <path d="M2 9 C 40 2, 80 13, 120 7 S 200 1, 258 8" stroke="#C98A3E" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

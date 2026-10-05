'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Carrot, House, Info, MapPin, ShoppingBasket, Tag, Truck, type LucideIcon } from 'lucide-react';
import { InstagramIcon, WhatsAppIcon } from '@/components/brand-icons';
import { buildWhatsappUrl } from '@/lib/whatsapp';
import type { StoreInfo } from '@/lib/types';

const ICON_SIZE = 20;

type NavEntry =
  /** Sección de la página (se llega con scroll). */
  | { kind: 'section'; id: string; label: string; Icon: LucideIcon }
  /** Página propia: link real, que también siguen los buscadores. */
  | { kind: 'page'; href: string; label: string; Icon: LucideIcon };

const NAV_ENTRIES: NavEntry[] = [
  { kind: 'section', id: 'inicio', label: 'Inicio', Icon: House },
  { kind: 'section', id: 'productos', label: 'Productos', Icon: Carrot },
  { kind: 'page', href: '/bolsones', label: 'Bolsones', Icon: ShoppingBasket },
  { kind: 'page', href: '/ofertas', label: 'Ofertas', Icon: Tag },
  { kind: 'page', href: '/envios', label: 'Envíos', Icon: Truck },
  { kind: 'section', id: 'ubicacion', label: 'Ubicación', Icon: MapPin },
  { kind: 'section', id: 'informacion', label: 'Preguntas', Icon: Info },
];

type SiteNavProps = {
  storeInfo: StoreInfo;
};

/**
 * Menú tipo app: hamburguesa en el celular, barra en línea en desktop.
 *
 * Va FUERA del <header> a propósito: position:sticky solo funciona dentro del
 * contenedor del elemento, y el header es position:relative, así que al pasarlo
 * la barra se iba con él. Como hermano del header, su contenedor es el body y
 * queda fija en toda la página.
 */
export default function SiteNav({ storeInfo }: SiteNavProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  /**
   * Lleva a una sección y cierra el menú.
   *
   * Se usa scrollIntoView en vez de un href="#seccion" para cerrar el menú en el
   * mismo gesto y no dejar el hash colgado en la URL. Si la sección no está en
   * esta página (p. ej. "Preguntas" desde /frutas), se va a la home.
   */
  function goToSection(sectionId: string) {
    setIsOpen(false);
    const target = sectionId === 'inicio' ? null : document.getElementById(sectionId);

    if (sectionId === 'inicio' && pathname === '/') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (!target) {
      router.push(sectionId === 'inicio' ? '/' : `/#${sectionId}`);
      return;
    }
    // El menú se cierra con una transición; se espera un toque para que el
    // scroll no compita con ella.
    window.setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  const whatsappUrl = buildWhatsappUrl(storeInfo.whatsappNumber);

  return (
    <nav className="app-nav" aria-label="Menú principal">
      <div className="container app-nav-inner">
        <button
          type="button"
          className={`menu-toggle ${isOpen ? 'open' : ''}`}
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          aria-controls="menu-principal"
          aria-label={isOpen ? 'Cerrar menú' : 'Abrir menú'}
        >
          {/* Tres barras que se transforman en una X al abrir. */}
          <span className="menu-bar" />
          <span className="menu-bar" />
          <span className="menu-bar" />
        </button>
        <Link href="/" className="app-nav-title" onClick={() => setIsOpen(false)}>
          {storeInfo.storeName}
        </Link>
      </div>

      <div id="menu-principal" className={`app-menu ${isOpen ? 'open' : ''}`}>
        <div className="container app-menu-items">
          {NAV_ENTRIES.map((entry) => (entry.kind === 'page' ? (
            <Link
              key={entry.href}
              href={entry.href}
              onClick={() => setIsOpen(false)}
              aria-current={pathname === entry.href ? 'page' : undefined}
            >
              <entry.Icon size={ICON_SIZE} aria-hidden="true" /> {entry.label}
            </Link>
          ) : (
            <button key={entry.id} type="button" onClick={() => goToSection(entry.id)}>
              <entry.Icon size={ICON_SIZE} aria-hidden="true" /> {entry.label}
            </button>
          )))}
          <a
            className="app-menu-brand"
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setIsOpen(false)}
            aria-label="Escribinos por WhatsApp"
          >
            <WhatsAppIcon size={ICON_SIZE} /> <span className="app-menu-label">WhatsApp</span>
          </a>
          {storeInfo.instagramUrl ? (
            <a
              className="app-menu-brand"
              href={storeInfo.instagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setIsOpen(false)}
              aria-label="Instagram"
            >
              <InstagramIcon size={ICON_SIZE} /> <span className="app-menu-label">Instagram</span>
            </a>
          ) : null}
        </div>
      </div>
    </nav>
  );
}

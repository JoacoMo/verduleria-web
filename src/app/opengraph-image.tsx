import { ImageResponse } from 'next/og';
import { siteConfig } from '@/lib/site';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = `${siteConfig.storeName}, verdulería y frutería en ${siteConfig.storeNeighborhood}, Córdoba`;

/**
 * Imagen que aparece al compartir el link (WhatsApp, Instagram, Facebook).
 *
 * Sin precios ni montos a propósito: las redes cachean esta imagen por días o
 * semanas, así que un "envío gratis desde $X" quedaría mostrando un valor viejo
 * cuando cambie. Solo va lo que no cambia: la marca, el barrio y qué ofrece.
 *
 * Colores fijos de la paleta de globals.css (acá no hay CSS: lo dibuja satori).
 */
const COLORS = {
  chalkboard: '#1E2E22',
  leaf: '#3F6B44',
  leafWash: '#EEF5EC',
  crate: '#C98A3E',
  paper: '#FAF6EC',
};

const HIGHLIGHTS = ['Frutas y verduras', 'Bolsones armados', 'Envíos a domicilio'];

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: COLORS.paper,
          borderTop: `24px solid ${COLORS.chalkboard}`,
          borderBottom: `24px solid ${COLORS.leaf}`,
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 150,
            height: 150,
            borderRadius: '50%',
            backgroundColor: COLORS.crate,
            marginBottom: 28,
          }}
        >
          <span style={{ fontSize: 84 }}>🥕</span>
        </div>
        <div style={{ display: 'flex', fontSize: 92, fontWeight: 700, color: COLORS.chalkboard }}>
          {siteConfig.storeName}
        </div>
        <div style={{ display: 'flex', fontSize: 36, color: COLORS.leaf, marginTop: 12 }}>
          Verdulería y frutería en {siteConfig.storeNeighborhood}, Córdoba
        </div>
        <div style={{ display: 'flex', gap: 18, marginTop: 40 }}>
          {HIGHLIGHTS.map((text) => (
            <div
              key={text}
              style={{
                display: 'flex',
                fontSize: 28,
                color: COLORS.chalkboard,
                backgroundColor: COLORS.leafWash,
                border: `2px solid ${COLORS.leaf}`,
                borderRadius: 999,
                padding: '10px 26px',
              }}
            >
              {text}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}

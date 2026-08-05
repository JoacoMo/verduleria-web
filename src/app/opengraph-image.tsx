import { ImageResponse } from 'next/og';
import { siteConfig } from '@/lib/site';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

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
          backgroundColor: '#FAF6EC',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 160,
            height: 160,
            borderRadius: '50%',
            backgroundColor: '#C98A3E',
            marginBottom: 36,
          }}
        >
          <span style={{ fontSize: 90 }}>🥕</span>
        </div>
        <div style={{ display: 'flex', fontSize: 84, fontWeight: 700, color: '#1E2E22' }}>
          {siteConfig.storeName}
        </div>
        <div style={{ display: 'flex', fontSize: 34, color: '#3F6B44', marginTop: 18 }}>
          Verdulería y frutería en {siteConfig.storeNeighborhood}, Córdoba Capital
        </div>
      </div>
    ),
    { ...size },
  );
}

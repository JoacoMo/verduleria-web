// Solo servidor: lee variables de entorno. Al navegador va el subconjunto
// público (getPublicStoreInfo) como props; importarlo desde un componente
// 'use client' rompe el build en vez de arrastrar process.env al bundle.
import 'server-only';
import type { StoreInfo } from './types';
import { STORE_HOURS_TEXT } from './store-hours';

function envNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 && process.env[name] !== '' && process.env[name] !== undefined ? value : fallback;
}

/**
 * Datos del local que se muestran en la web, leídos de variables de entorno con
 * valores por defecto. Solo se usa en el servidor: a los componentes del
 * navegador les llega como prop (`getPublicStoreInfo`) o por /api/store-info.
 */
export const siteConfig = {
  storeName: process.env.STORE_NAME || 'El Pampa',
  storeAddress: process.env.STORE_ADDRESS || 'Rosario de Santa Fe 1211, Barrio General Paz, Córdoba Capital',
  storeNeighborhood: process.env.STORE_NEIGHBORHOOD || 'Barrio General Paz',
  siteUrl: (process.env.SITE_URL || 'https://elpampa.vercel.app').replace(/\/$/, ''),
  // Los horarios salen de src/lib/store-hours.ts (única fuente de verdad).
  storeHours: STORE_HOURS_TEXT,
  transferAlias: process.env.TRANSFER_ALIAS || 'mi.verduleria.alias',
  transferCbu: process.env.TRANSFER_CBU || '',
  // Número de WhatsApp del negocio: es público (aparece en toda la web).
  whatsappNumber: process.env.WHATSAPP_NUMBER || '5493517656500',
  contactEmail: process.env.CONTACT_EMAIL || 'gastaldo50@gmail.com',
  // Si queda vacío, el menú no muestra el botón de Instagram.
  instagramUrl: process.env.INSTAGRAM_URL || '',
  // Link corto de Google para dejar reseña (Perfil de empresa > Pedir reseñas).
  // Si queda vacío, no se muestra el pedido de reseña.
  googleReviewUrl: process.env.GOOGLE_REVIEW_URL || '',
  // Peso orientativo a partir del cual un envío puede necesitar dos viajes.
  deliveryMaxWeightKg: envNumber('DELIVERY_MAX_WEIGHT_KG', 7),
  // Subtotal mínimo para pedir con envío (no aplica a retiro).
  deliveryMinPurchase: envNumber('DELIVERY_MIN_PURCHASE', 10000),
  // Costo fijo del envío.
  deliveryFee: envNumber('DELIVERY_FEE', 4000),
  // Desde este subtotal el envío corre por cuenta del local.
  deliveryFreeThreshold: envNumber('DELIVERY_FREE_THRESHOLD', 20000),
};

/** Lo que el navegador necesita saber del local (nada sensible: todo se muestra en la web). */
export function getPublicStoreInfo(): StoreInfo {
  return {
    storeName: siteConfig.storeName,
    storeAddress: siteConfig.storeAddress,
    storeNeighborhood: siteConfig.storeNeighborhood,
    storeHours: siteConfig.storeHours,
    transferAlias: siteConfig.transferAlias,
    transferCbu: siteConfig.transferCbu,
    whatsappNumber: siteConfig.whatsappNumber,
    contactEmail: siteConfig.contactEmail,
    instagramUrl: siteConfig.instagramUrl,
    googleReviewUrl: siteConfig.googleReviewUrl,
    deliveryMaxWeightKg: siteConfig.deliveryMaxWeightKg,
    deliveryMinPurchase: siteConfig.deliveryMinPurchase,
    deliveryFee: siteConfig.deliveryFee,
    deliveryFreeThreshold: siteConfig.deliveryFreeThreshold,
  };
}

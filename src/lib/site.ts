export const siteConfig = {
  storeName: process.env.STORE_NAME || 'El Pampa',
  storeAddress: process.env.STORE_ADDRESS || 'Barrio General Paz, Córdoba Capital',
  storeNeighborhood: process.env.STORE_NEIGHBORHOOD || 'Barrio General Paz',
  siteUrl: process.env.SITE_URL || 'https://elpampa.vercel.app',
  storeHours: {
    weekday: process.env.STORE_WEEKDAY_HOURS || 'Lunes a sábado de 8:00 a 14:00 y de 17:30 a 21:30',
    sunday: process.env.STORE_SUNDAY_HOURS || 'Domingos de 9:00 a 14:00',
  },
  transferAlias: process.env.TRANSFER_ALIAS || 'mi.verduleria.alias',
  transferCbu: process.env.TRANSFER_CBU || '',
  whatsappNumber: process.env.WHATSAPP_NUMBER || '5493517656500',
  contactEmail: 'gastaldo50@gmail.com',
  deliveryProviderName: process.env.DELIVERY_PROVIDER_NAME || 'Uber Moto',
  deliveryMaxWeightKg: Number(process.env.DELIVERY_MAX_WEIGHT_KG) || 7,
  deliveryMinPurchase: Number(process.env.DELIVERY_MIN_PURCHASE) || 10000,
};
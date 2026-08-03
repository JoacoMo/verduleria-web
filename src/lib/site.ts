export const siteConfig = {
  storeName: process.env.STORE_NAME || 'Verdulería Fresca',
  storeAddress: process.env.STORE_ADDRESS || 'Rosario de Santa Fe 1211, Córdoba Capital',
  storeHours: {
    weekday: process.env.STORE_WEEKDAY_HOURS || 'Lunes a sábado de 8:00 a 14:00 y de 17:30 a 21:30',
    sunday: process.env.STORE_SUNDAY_HOURS || 'Domingos de 9:00 a 14:00',
  },
  transferAlias: process.env.TRANSFER_ALIAS || 'mi.verduleria.alias',
  transferCbu: process.env.TRANSFER_CBU || '',
  whatsappNumber: process.env.WHATSAPP_NUMBER || '5490000000000',
};
// Busca en Pexels una foto libre de uso para cada producto que todavía tiene
// una imagen placeholder, la sube a Supabase Storage (mismo bucket que usa
// el panel de admin) y actualiza la columna `image` del producto.
//
// Uso:
//   node scripts/fill-product-images.js                  -> dry run (no escribe nada)
//   node scripts/fill-product-images.js --apply           -> aplica los cambios
//   node scripts/fill-product-images.js --apply --all      -> también pisa productos que ya tienen foto real
//   node scripts/fill-product-images.js --apply --id=12     -> procesa un solo producto (para probar)
//
// Requiere PEXELS_API_KEY en el .env (gratis en https://www.pexels.com/api/).

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

loadEnv();

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'product-images';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE_ALL = args.includes('--all');
const ONLY_ID = (() => {
  const flag = args.find((arg) => arg.startsWith('--id='));
  return flag ? Number(flag.split('=')[1]) : null;
})();

// Términos de búsqueda en inglés para mejorar los resultados en Pexels (su
// catálogo está mayormente etiquetado en inglés). Se busca primero por el
// nombre del producto ya limpio de aclaraciones entre paréntesis; si no
// está en el diccionario, se usa ese nombre tal cual como búsqueda.
const SEARCH_TERMS = {
  lechuga: 'lettuce',
  'lechuga arrepollada': 'iceberg lettuce',
  'lechuga manteca': 'butter lettuce',
  lechuguin: 'baby lettuce',
  tomate: 'tomato',
  'tomate cherry': 'cherry tomatoes',
  zanahoria: 'carrots',
  papa: 'potatoes',
  acelga: 'swiss chard',
  achicoria: 'chicory',
  brocoli: 'broccoli',
  espinaca: 'spinach',
  puerro: 'leek',
  rabanito: 'radish',
  remolacha: 'beetroot',
  'repollo blanco': 'white cabbage',
  'repollo morado': 'red cabbage',
  rucula: 'arugula',
  'cebolla de verdeo': 'green onion',
  ajo: 'garlic',
  anquito: 'butternut squash',
  apio: 'celery',
  batata: 'sweet potato',
  berenjena: 'eggplant',
  chaucha: 'green beans',
  choclo: 'corn on the cob',
  cebolla: 'onion',
  'cebolla morada': 'red onion',
  'zucchini / cuza': 'zucchini',
  pepino: 'cucumber',
  'pimiento rojo': 'red bell pepper',
  'pimiento verde': 'green bell pepper',
  zapallito: 'summer squash',
  zapallo: 'pumpkin',
  jengibre: 'ginger root',
  banana: 'bananas',
  frutilla: 'strawberries',
  kiwi: 'kiwi fruit',
  limon: 'lemon',
  mandarina: 'mandarin orange',
  'manzana roja': 'red apple',
  'manzana verde': 'green apple',
  naranja: 'orange fruit',
  'naranja de ombligo': 'navel orange',
  palta: 'avocado',
  pera: 'pear fruit',
  pomelo: 'grapefruit',
  uva: 'grapes',
  arandanos: 'blueberries',
  mango: 'mango fruit',
  huevos: 'eggs carton',
  lena: 'firewood',
  carbon: 'charcoal',
};

function stripAccents(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function cleanProductName(name) {
  return name.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
}

function buildSearchQuery(productName) {
  const cleaned = cleanProductName(productName);
  const key = stripAccents(cleaned).toLowerCase();
  return SEARCH_TERMS[key] || cleaned;
}

function needsImage(product) {
  const { image } = product;
  if (!image) return true;
  if (image.startsWith('/placeholder')) return true;
  if (image.includes('via.placeholder.com')) return true;
  return false;
}

async function searchPexelsImage(query) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=square`;
  const response = await fetch(url, { headers: { Authorization: PEXELS_API_KEY } });

  if (!response.ok) {
    throw new Error(`Pexels respondió ${response.status} para "${query}"`);
  }

  const data = await response.json();
  const photo = data.photos && data.photos[0];
  if (!photo) return null;

  return {
    downloadUrl: photo.src.large,
    credit: `Foto de ${photo.photographer} en Pexels`,
  };
}

async function ensureBucketExists() {
  const bucketsResponse = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!bucketsResponse.ok) throw new Error('No se pudo verificar el bucket de Storage.');

  const buckets = await bucketsResponse.json();
  const exists = Array.isArray(buckets) && buckets.some((bucket) => bucket.name === SUPABASE_STORAGE_BUCKET);
  if (exists) return;

  const createResponse = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ id: SUPABASE_STORAGE_BUCKET, name: SUPABASE_STORAGE_BUCKET, public: true }),
  });
  if (!createResponse.ok) throw new Error('No se pudo crear el bucket de Storage.');
}

async function uploadToStorage(productName, imageUrl) {
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) throw new Error(`No se pudo descargar la imagen (${imageResponse.status}).`);

  const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
  const extension = contentType.includes('png') ? 'png' : 'jpg';
  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  const safeName = `${Date.now()}-${productName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${extension}`;

  const uploadResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_STORAGE_BUCKET}/${safeName}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: buffer,
  });

  if (!uploadResponse.ok) {
    const body = await uploadResponse.text();
    throw new Error(`No se pudo subir a Supabase Storage: ${body}`);
  }

  return `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}/${safeName}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!PEXELS_API_KEY) {
    console.error('Falta PEXELS_API_KEY en el .env. Conseguí una gratis en https://www.pexels.com/api/ y agregala.');
    process.exitCode = 1;
    return;
  }
  if (APPLY && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
    console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en el .env.');
    process.exitCode = 1;
    return;
  }

  const allProducts = await prisma.product.findMany({ orderBy: { id: 'asc' } });
  const targets = allProducts.filter((product) => {
    if (ONLY_ID) return product.id === ONLY_ID;
    return FORCE_ALL || needsImage(product);
  });

  console.log(APPLY ? 'APLICANDO cambios' : 'DRY RUN (no se escribe nada, agregá --apply para aplicar)');
  console.log(`${targets.length} de ${allProducts.length} productos a procesar.\n`);

  if (APPLY) await ensureBucketExists();

  let updated = 0;
  let skipped = 0;

  for (const product of targets) {
    const query = buildSearchQuery(product.name);
    try {
      const result = await searchPexelsImage(query);
      if (!result) {
        console.log(`⚠️  Sin resultados para "${product.name}" (query: "${query}")`);
        skipped += 1;
        continue;
      }

      if (!APPLY) {
        console.log(`[dry-run] #${product.id} ${product.name} (query: "${query}") -> ${result.downloadUrl}`);
        updated += 1;
        continue;
      }

      const publicUrl = await uploadToStorage(product.name, result.downloadUrl);
      await prisma.product.update({ where: { id: product.id }, data: { image: publicUrl } });
      console.log(`✅ #${product.id} ${product.name} -> ${publicUrl} (${result.credit})`);
      updated += 1;
    } catch (error) {
      console.error(`❌ #${product.id} ${product.name}:`, error.message);
      skipped += 1;
    }

    await sleep(350); // no golpear de más la API gratuita de Pexels
  }

  console.log(`\nListo. ${updated} actualizados, ${skipped} sin cambios.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

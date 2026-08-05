// Asigna una categoría (Frutas / Verduras / Almacén / Ofertas) a los productos
// existentes según su nombre, para la migración que agregó la columna `category`.
// Corre una sola vez; después la categoría se administra desde el panel.
//
// Uso:
//   node scripts/backfill-product-categories.js          -> dry run (no escribe nada)
//   node scripts/backfill-product-categories.js --apply    -> aplica los cambios

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

const APPLY = process.argv.includes('--apply');

function stripAccents(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Se busca por palabra dentro del nombre normalizado (sin acentos, minúscula),
// así "Naranja de Ombligo" matchea "naranja" y "Ajo (Grande)" matchea "ajo".
const FRUIT_KEYWORDS = [
  'arandano', 'banana', 'frutilla', 'kiwi', 'limon', 'mandarina', 'mango',
  'manzana', 'naranja', 'palta', 'pera', 'pomelo', 'uva',
];

const VEGETABLE_KEYWORDS = [
  'acelga', 'achicoria', 'ajo', 'anquito', 'apio', 'batata', 'berenjena',
  'brocoli', 'cebolla', 'chaucha', 'choclo', 'espinaca', 'jengibre',
  'lechuga', 'lechuguin', 'papa', 'pepino', 'pimiento', 'puerro', 'rabanito',
  'remolacha', 'repollo', 'rucula', 'tomate', 'zanahoria', 'zapallito',
  'zapallo', 'zucchini', 'cuza',
];

function guessCategory(name) {
  const normalized = stripAccents(name).toLowerCase();

  if (normalized.includes('promo') || normalized.includes('oferta')) return 'Ofertas';
  if (FRUIT_KEYWORDS.some((keyword) => normalized.includes(keyword))) return 'Frutas';
  if (VEGETABLE_KEYWORDS.some((keyword) => normalized.includes(keyword))) return 'Verduras';
  return 'Almacén';
}

async function main() {
  const products = await prisma.product.findMany({ orderBy: { name: 'asc' } });

  console.log(`${products.length} productos encontrados.\n`);

  for (const product of products) {
    const guessedCategory = guessCategory(product.name);
    const changed = guessedCategory !== product.category ? ' (cambia)' : '';
    console.log(`${product.name.padEnd(35)} ${product.category} -> ${guessedCategory}${changed}`);

    if (APPLY && guessedCategory !== product.category) {
      await prisma.product.update({ where: { id: product.id }, data: { category: guessedCategory } });
    }
  }

  console.log(APPLY ? '\nCategorías actualizadas.' : '\nDry run: correr con --apply para guardar los cambios.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

const { PrismaClient } = require('@prisma/client');
const { ensureDefaultCatalog } = require('./catalog');
const prisma = new PrismaClient();

async function main() {
    const created = await ensureDefaultCatalog(prisma);
    console.log(`Catálogo base revisado. Productos nuevos agregados: ${created}.`);
}

main()
    .catch((e) => console.error(e))
    .finally(() => prisma.$disconnect());

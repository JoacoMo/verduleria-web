const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const count = await prisma.product.count();
    if (count > 0) {
        console.log('Ya hay productos cargados, no se hace seed.');
        return;
    }

    await prisma.product.createMany({
        data: [
            { name: 'Tomate', price: 800, image: 'https://via.placeholder.com/300?text=Tomate', stock: 50 },
            { name: 'Papa', price: 500, image: 'https://via.placeholder.com/300?text=Papa', stock: 100 },
            { name: 'Lechuga', price: 600, image: 'https://via.placeholder.com/300?text=Lechuga', stock: 30 },
        ],
    });

    console.log('Productos de ejemplo creados.');
}

main()
    .catch((e) => console.error(e))
    .finally(() => prisma.$disconnect());

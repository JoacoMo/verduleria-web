const unsplash = (query) => `https://source.unsplash.com/featured/800x600/?${encodeURIComponent(query)}`;

const defaultCatalog = [
    { name: 'Zanahoria', price: 950, stock: 25, saleUnit: 'kg', image: unsplash('carrot vegetable') },
    { name: 'Manzana', price: 1650, stock: 18, saleUnit: 'kg', image: unsplash('apple fruit') },
    { name: 'Palta', price: 1200, stock: 24, saleUnit: 'unit', image: unsplash('avocado fruit') },
    { name: 'Zapallito verde', price: 1350, stock: 16, saleUnit: 'kg', image: unsplash('zucchini vegetable') },
    { name: 'Zapallo anco', price: 890, stock: 20, saleUnit: 'kg', image: unsplash('pumpkin squash') },
    { name: 'Banana', price: 1490, stock: 22, saleUnit: 'kg', image: unsplash('banana fruit') },
    { name: 'Pera', price: 1750, stock: 16, saleUnit: 'kg', image: unsplash('pear fruit') },
    { name: 'Uva', price: 2800, stock: 12, saleUnit: 'kg', image: unsplash('grapes fruit') },
    { name: 'Frutilla', price: 3200, stock: 10, saleUnit: 'kg', image: unsplash('strawberry fruit') },
    { name: 'Arándanos', price: 4200, stock: 8, saleUnit: 'kg', image: unsplash('blueberries fruit') },
    { name: 'Bandejita mixta', price: 2600, stock: 14, saleUnit: 'tray', image: unsplash('mixed fruit tray') },
    { name: 'Cebolla', price: 990, stock: 28, saleUnit: 'kg', image: unsplash('onion vegetable') },
    { name: 'Pepino', price: 850, stock: 18, saleUnit: 'kg', image: unsplash('cucumber vegetable') },
    { name: 'Pimiento verde', price: 2100, stock: 14, saleUnit: 'kg', image: unsplash('green bell pepper') },
    { name: 'Pimiento rojo', price: 2300, stock: 12, saleUnit: 'kg', image: unsplash('red bell pepper') },
    { name: 'Pomelo', price: 1150, stock: 20, saleUnit: 'kg', image: unsplash('grapefruit fruit') },
    { name: 'Aceite de oliva', price: 5400, stock: 10, saleUnit: 'unit', image: unsplash('olive oil bottle') },
    { name: 'Cebolla morada', price: 1200, stock: 18, saleUnit: 'kg', image: unsplash('red onion vegetable') },
    { name: 'Apio', price: 980, stock: 12, saleUnit: 'kg', image: unsplash('celery vegetable') },
    { name: 'Kiwi', price: 2650, stock: 14, saleUnit: 'kg', image: unsplash('kiwi fruit') },
    { name: 'Mandarina', price: 1300, stock: 18, saleUnit: 'kg', image: unsplash('mandarin fruit') },
    { name: 'Brócoli', price: 1450, stock: 22, saleUnit: 'unit', image: unsplash('broccoli vegetable') },
    { name: 'Rúcula', price: 790, stock: 30, saleUnit: 'bunch', image: unsplash('arugula leaves') },
    { name: 'Tomate perita', price: 1680, stock: 20, saleUnit: 'kg', image: unsplash('plum tomato vegetable') },
    { name: 'Tomate redondo', price: 1550, stock: 24, saleUnit: 'kg', image: unsplash('round tomato vegetable') },
    { name: 'Choclo', price: 850, stock: 26, saleUnit: 'unit', image: unsplash('corn cob') },
    { name: 'Papa', price: 780, stock: 32, saleUnit: 'kg', image: unsplash('potato vegetable') },
    { name: 'Papa lavada', price: 920, stock: 24, saleUnit: 'kg', image: unsplash('washed potatoes') },
    { name: 'Carbón', price: 3100, stock: 16, saleUnit: 'bag', image: unsplash('charcoal bag') },
    { name: 'Limón', price: 1250, stock: 20, saleUnit: 'kg', image: unsplash('lemon fruit') },
    { name: 'Naranja', price: 1350, stock: 22, saleUnit: 'kg', image: unsplash('orange fruit') },
    { name: 'Durazno', price: 2100, stock: 14, saleUnit: 'kg', image: unsplash('peach fruit') },
    { name: 'Lechuga mantecosa', price: 980, stock: 20, saleUnit: 'unit', image: unsplash('butter lettuce') },
    { name: 'Espinaca', price: 890, stock: 20, saleUnit: 'bunch', image: unsplash('spinach leaves') },
    { name: 'Berenjena', price: 1500, stock: 16, saleUnit: 'kg', image: unsplash('eggplant vegetable') },
    { name: 'Perejil', price: 590, stock: 24, saleUnit: 'bunch', image: unsplash('parsley herbs') },
];

async function ensureDefaultCatalog(prisma) {
    let created = 0;

    for (const product of defaultCatalog) {
        const existing = await prisma.product.findFirst({ where: { name: product.name } });
        if (!existing) {
            await prisma.product.create({ data: product });
            created += 1;
        }
    }

    return created;
}

module.exports = {
    defaultCatalog,
    ensureDefaultCatalog,
};
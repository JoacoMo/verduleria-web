const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const { ensureDefaultCatalog } = require('./prisma/catalog');

const prisma = new PrismaClient();
const app = express();
const APP_VERSION = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || 'local';
const SALE_UNIT_VALUES = new Set(['kg', 'unit', 'bunch', 'tray', 'bag']);
const SALE_UNIT_LABELS = {
    kg: 'kg',
    unit: 'unidad',
    bunch: 'atado',
    tray: 'bandeja',
    bag: 'bolsa',
};

// --- CONFIG ---
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Datos para mostrarle al cliente al momento de pagar por transferencia
const TRANSFER_ALIAS = process.env.TRANSFER_ALIAS || 'mi.verduleria.alias';
const TRANSFER_CBU = process.env.TRANSFER_CBU || '';
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || '5490000000000';
const STORE_NAME = process.env.STORE_NAME || 'Verdulería Fresca';

if (!JWT_SECRET || !ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.warn('ADVERTENCIA: Faltan variables de entorno (JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD). El login de admin no va a funcionar hasta que las configures en .env');
}

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/healthz', (req, res) => {
    res.json({ ok: true, version: APP_VERSION });
});

app.get('/version', (req, res) => {
    res.json({ version: APP_VERSION });
});

app.get(/^(?!\/api|\/healthz|\/version).*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- MIDDLEWARE DE AUTENTICACIÓN ADMIN ---
function requireAdmin(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No autorizado. Falta el token.' });
    }
    const token = authHeader.split(' ')[1];
    try {
        jwt.verify(token, JWT_SECRET);
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Token inválido o vencido.' });
    }
}

// ==========================
// RUTAS PÚBLICAS - PRODUCTOS
// ==========================

app.get('/api/products', async (req, res) => {
    try {
        const products = await prisma.product.findMany({ orderBy: { id: 'asc' } });
        res.json(products);
    } catch (error) {
        console.error('Error en GET /api/products:', error);
        res.status(500).json({ error: 'Error al obtener los productos.' });
    }
});

app.get('/api/store-info', (req, res) => {
    res.json({
        storeName: STORE_NAME,
        transferAlias: TRANSFER_ALIAS,
        transferCbu: TRANSFER_CBU,
        whatsappNumber: WHATSAPP_NUMBER,
    });
});

// ==========================
// LOGIN DE ADMIN
// ==========================

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
        return res.json({ token });
    }
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
});

// ==========================
// RUTAS DE ADMIN (protegidas) - PRODUCTOS
// ==========================

app.post('/api/admin/products', requireAdmin, async (req, res) => {
    try {
        const { name, price, image, stock, saleUnit } = req.body;
        const product = await prisma.product.create({
            data: {
                name,
                price: parseFloat(price),
                image,
                stock: Number.parseFloat(stock) || 0,
                saleUnit: SALE_UNIT_VALUES.has(saleUnit) ? saleUnit : 'unit',
            },
        });
        res.status(201).json(product);
    } catch (error) {
        console.error('Error en POST /api/admin/products:', error);
        res.status(500).json({ error: 'Error al crear el producto.' });
    }
});

app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const { name, price, image, stock, saleUnit } = req.body;
        const data = {};
        if (name !== undefined) data.name = name;
        if (price !== undefined) data.price = parseFloat(price);
        if (image !== undefined && image !== '') data.image = image;
        if (stock !== undefined) data.stock = Number.parseFloat(stock);
        if (saleUnit !== undefined && SALE_UNIT_VALUES.has(saleUnit)) data.saleUnit = saleUnit;

        const product = await prisma.product.update({
            where: { id: parseInt(id) },
            data,
        });
        res.json(product);
    } catch (error) {
        console.error('Error en PUT /api/admin/products:', error);
        res.status(500).json({ error: 'Error al actualizar el producto.' });
    }
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await prisma.product.delete({ where: { id: parseInt(id) } });
        res.status(204).send();
    } catch (error) {
        console.error('Error en DELETE /api/admin/products:', error);
        res.status(500).json({ error: 'Error al eliminar el producto.' });
    }
});

// ==========================
// RUTAS DE ADMIN (protegidas) - PEDIDOS
// ==========================

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
    try {
        const orders = await prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
        res.json(orders);
    } catch (error) {
        console.error('Error en GET /api/admin/orders:', error);
        res.status(500).json({ error: 'Error al obtener los pedidos.' });
    }
});

// Confirmar que llegó la transferencia: recién acá se descuenta el stock
app.put('/api/admin/orders/:id/confirm', requireAdmin, async (req, res) => {
    const orderId = parseInt(req.params.id);
    try {
        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });
        if (order.status !== 'pending') {
            return res.status(409).json({ error: `El pedido ya está en estado "${order.status}".` });
        }

        await prisma.$transaction(async (tx) => {
            for (const item of order.items) {
                const product = await tx.product.findUnique({ where: { id: item.id } });
                if (!product) {
                    const error = new Error(`El producto ${item.name} ya no existe.`);
                    error.code = 'PRODUCT_NOT_FOUND';
                    throw error;
                }

                const packSize = product.saleUnit === 'kg' ? Number(item.packSize || 1) : 1;
                const quantity = Number(item.quantity || 1);
                const requestedStock = quantity * packSize;

                if (product.stock + 1e-9 < requestedStock) {
                    const error = new Error(`Stock insuficiente para ${product.name}.`);
                    error.code = 'INSUFFICIENT_STOCK';
                    throw error;
                }

                await tx.product.update({
                    where: { id: product.id },
                    data: { stock: { decrement: requestedStock } },
                });
            }
            await tx.order.update({ where: { id: orderId }, data: { status: 'paid' } });
        });

        res.json({ message: 'Pedido confirmado y stock actualizado.' });
    } catch (error) {
        console.error('Error al confirmar pedido:', error);
        if (error.code === 'INSUFFICIENT_STOCK' || error.code === 'PRODUCT_NOT_FOUND') {
            return res.status(409).json({ error: error.message });
        }
        res.status(500).json({ error: 'No se pudo confirmar el pedido.' });
    }
});

// Cancelar un pedido pendiente (no toca el stock, porque nunca se descontó)
app.put('/api/admin/orders/:id/cancel', requireAdmin, async (req, res) => {
    const orderId = parseInt(req.params.id);
    try {
        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });
        if (order.status !== 'pending') {
            return res.status(409).json({ error: `El pedido ya está en estado "${order.status}".` });
        }
        await prisma.order.update({ where: { id: orderId }, data: { status: 'cancelled' } });
        res.json({ message: 'Pedido cancelado.' });
    } catch (error) {
        console.error('Error al cancelar pedido:', error);
        res.status(500).json({ error: 'No se pudo cancelar el pedido.' });
    }
});

// ==========================
// CHECKOUT (transferencia + confirmación manual)
// ==========================

app.post('/api/checkout', async (req, res) => {
    const { cart, customer } = req.body;
    if (!Array.isArray(cart) || cart.length === 0) {
        return res.status(400).json({ error: 'El carrito está vacío.' });
    }

    try {
        const productIds = cart.map((item) => item.id);
        const dbProducts = await prisma.product.findMany({ where: { id: { in: productIds } } });

        const itemsForOrder = [];
        let total = 0;
        const sinStock = [];

        for (const cartItem of cart) {
            const product = dbProducts.find((p) => p.id === cartItem.id);
            if (!product) continue;
            const packSize = product.saleUnit === 'kg' ? (Number(cartItem.packSize) === 0.5 ? 0.5 : 1) : 1;
            const quantity = Math.max(1, Number.parseInt(cartItem.quantity, 10) || 1);
            const requestedStock = quantity * packSize;

            if (product.stock + 1e-9 < requestedStock) {
                sinStock.push(product.name);
                continue;
            }
            itemsForOrder.push({
                id: product.id,
                name: product.name,
                price: product.price,
                quantity,
                packSize,
                saleUnit: product.saleUnit,
            });
            total += product.price * requestedStock;
        }

        if (sinStock.length > 0) {
            return res.status(409).json({ error: `Sin stock suficiente: ${sinStock.join(', ')}` });
        }
        if (itemsForOrder.length === 0) {
            return res.status(400).json({ error: 'No hay productos válidos en el carrito.' });
        }

        // El stock NO se descuenta acá. Se descuenta recién cuando el admin confirma
        // que llegó la transferencia, para no reservar productos que nunca se pagaron.
        const order = await prisma.order.create({
            data: {
                items: itemsForOrder,
                total,
                status: 'pending',
                customerName: customer?.name || null,
                customerPhone: customer?.phone || null,
            },
        });

        res.json({
            orderId: order.id,
            total,
            items: itemsForOrder,
            transferAlias: TRANSFER_ALIAS,
            transferCbu: TRANSFER_CBU,
            whatsappNumber: WHATSAPP_NUMBER,
            storeName: STORE_NAME,
        });
    } catch (error) {
        console.error('Error en /api/checkout:', error);
        res.status(500).json({ error: 'No se pudo registrar el pedido.' });
    }
});

// --- CONTACTO ---
app.post('/api/contact', (req, res) => {
    const { name, message, email } = req.body;
    console.log('Nuevo mensaje de contacto:', { name, email, message });
    res.status(200).json({ message: 'Mensaje recibido, te vamos a contactar pronto.' });
});

// --- INICIO DEL SERVIDOR ---
async function bootstrap() {
    try {
        await ensureDefaultCatalog(prisma);
    } catch (error) {
        console.error('No se pudo asegurar el catálogo base:', error);
    }

    app.listen(PORT, () => {
        console.log(`Servidor de la verdulería corriendo en el puerto ${PORT}`);
    });
}

bootstrap();

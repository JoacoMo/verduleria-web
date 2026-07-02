document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('adminToken');
    const SALE_UNIT_LABELS = {
        kg: 'kg',
        unit: 'unidad',
        bunch: 'atado',
        tray: 'bandeja',
        bag: 'bolsa',
    };

    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    const authHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };

    const productForm = document.getElementById('product-form');
    const productList = document.getElementById('admin-product-list');
    const orderList = document.getElementById('admin-order-list');
    const formTitle = document.getElementById('form-title');
    const submitButton = document.getElementById('save-btn');
    const cancelBtn = document.getElementById('cancel-edit-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const saleUnitSelect = document.getElementById('product-sale-unit');
    const stockInput = document.getElementById('product-stock');

    let editingProductId = null;

    const ESTADOS = {
        pending: 'Pendiente',
        paid: 'Confirmado',
        cancelled: 'Cancelado',
        failed: 'Cancelado',
    };

    async function handleAuthError(response) {
        if (response.status === 401) {
            localStorage.removeItem('adminToken');
            window.location.href = 'login.html';
            return true;
        }
        return false;
    }

    function getSaleUnitLabel(saleUnit) {
        return SALE_UNIT_LABELS[saleUnit] || saleUnit || 'unidad';
    }

    function formatStock(stock) {
        return Number.isInteger(stock) ? stock.toString() : stock.toFixed(1);
    }

    // --- PRODUCTOS ---

    async function fetchAndRenderProducts() {
        if (!productList) return;
        try {
            const response = await fetch(`${API_URL}/products`);
            if (!response.ok) throw new Error(`Error al cargar productos: ${response.statusText}`);
            const products = await response.json();

            productList.innerHTML = '';
            products.forEach((product) => {
                const item = document.createElement('div');
                item.className = 'product-item';
                item.innerHTML = `
                    <div class="product-item-info">
                        <img src="${product.image}" alt="${product.name}" onerror="this.src='https://via.placeholder.com/60'; this.onerror=null;">
                        <div>
                            <strong>${product.name}</strong><br>
                            $${product.price.toFixed(2)} — Stock: ${formatStock(product.stock)} ${getSaleUnitLabel(product.saleUnit)}
                        </div>
                    </div>
                    <div class="product-item-actions">
                        <button class="edit-btn" data-id="${product.id}">Editar</button>
                        <button class="delete-btn" data-id="${product.id}">Eliminar</button>
                    </div>
                `;
                productList.appendChild(item);
            });
        } catch (error) {
            console.error('Error en fetchAndRenderProducts:', error);
            productList.innerHTML = '<p>Error al cargar los productos. Revisá la consola.</p>';
        }
    }

    async function handleFormSubmit(e) {
        e.preventDefault();

        const productData = {
            name: document.getElementById('product-name').value,
            price: parseFloat(document.getElementById('product-price').value),
            stock: parseFloat(stockInput.value),
            image: document.getElementById('product-image').value,
            saleUnit: saleUnitSelect.value,
        };

        let url = `${API_URL}/admin/products`;
        let method = 'POST';

        if (editingProductId) {
            url = `${API_URL}/admin/products/${editingProductId}`;
            method = 'PUT';
        }

        try {
            const response = await fetch(url, { method, headers: authHeaders, body: JSON.stringify(productData) });
            if (await handleAuthError(response)) return;
            if (!response.ok) throw new Error('La operación en el servidor falló.');

            resetForm();
            await fetchAndRenderProducts();
        } catch (error) {
            console.error('Error al guardar producto:', error);
            alert('No se pudo guardar el producto. Revisá la consola.');
        }
    }

    async function handleEdit(productId) {
        try {
            const response = await fetch(`${API_URL}/products`);
            const products = await response.json();
            const product = products.find((p) => p.id === parseInt(productId));
            if (!product) return;

            document.getElementById('product-name').value = product.name;
            document.getElementById('product-price').value = product.price;
            stockInput.value = product.stock;
            stockInput.step = product.saleUnit === 'kg' ? '0.1' : '1';
            document.getElementById('product-image').value = product.image;
            saleUnitSelect.value = product.saleUnit || 'unit';

            editingProductId = productId;
            formTitle.textContent = 'Editar Producto';
            submitButton.textContent = 'Actualizar Producto';
            cancelBtn.style.display = 'inline-block';
            window.scrollTo(0, 0);
        } catch (error) {
            console.error('Error al preparar edición:', error);
        }
    }

    async function handleDelete(productId) {
        if (!confirm('¿Estás seguro de eliminar este producto?')) return;
        try {
            const response = await fetch(`${API_URL}/admin/products/${productId}`, { method: 'DELETE', headers: authHeaders });
            if (await handleAuthError(response)) return;
            await fetchAndRenderProducts();
        } catch (error) {
            console.error('Error al eliminar:', error);
            alert('No se pudo eliminar el producto.');
        }
    }

    function resetForm() {
        productForm.reset();
        saleUnitSelect.value = 'unit';
        if (stockInput) stockInput.step = '1';
        editingProductId = null;
        formTitle.textContent = 'Agregar Nuevo Producto';
        submitButton.textContent = 'Guardar Producto';
        cancelBtn.style.display = 'none';
    }

    // --- PEDIDOS ---

    async function fetchAndRenderOrders() {
        if (!orderList) return;
        try {
            const response = await fetch(`${API_URL}/admin/orders`, { headers: authHeaders });
            if (await handleAuthError(response)) return;
            if (!response.ok) throw new Error('Error al cargar pedidos.');
            const orders = await response.json();

            if (orders.length === 0) {
                orderList.innerHTML = '<p>Todavía no hay pedidos.</p>';
                return;
            }

            orderList.innerHTML = '';
            orders.forEach((order) => {
                const itemsHtml = order.items.map((i) => {
                    const packSize = i.packSize || 1;
                    const saleUnit = i.saleUnit || 'unit';
                    const unitLabel = SALE_UNIT_LABELS[saleUnit] || saleUnit || 'unidad';
                    const purchaseLabel = saleUnit === 'kg' ? `${packSize} kg` : unitLabel;
                    const lineTotal = i.price * i.quantity * packSize;
                    return `<li>${i.quantity} x ${purchaseLabel} ${i.name} — $${lineTotal.toFixed(2)}</li>`;
                }).join('');
                const statusKey = order.status;
                const div = document.createElement('div');
                div.className = 'order-item';
                div.innerHTML = `
                    <div class="order-header">
                        <strong>Pedido #${order.id}</strong>
                        <span class="order-status ${statusKey === 'paid' ? 'paid' : statusKey === 'pending' ? 'pending' : 'cancelled'}">${ESTADOS[statusKey] || statusKey}</span>
                    </div>
                    <ul class="order-items-list">${itemsHtml}</ul>
                    <div><strong>Total: $${order.total.toFixed(2)}</strong></div>
                    ${statusKey === 'pending' ? `
                        <div class="order-actions">
                            <button class="confirm-order-btn" data-id="${order.id}">Confirmar pago</button>
                            <button class="cancel-order-btn" data-id="${order.id}">Cancelar</button>
                        </div>
                    ` : ''}
                `;
                orderList.appendChild(div);
            });
        } catch (error) {
            console.error('Error en fetchAndRenderOrders:', error);
            orderList.innerHTML = '<p>Error al cargar los pedidos.</p>';
        }
    }

    async function handleConfirmOrder(orderId) {
        if (!confirm('¿Confirmás que llegó la transferencia de este pedido? Se va a descontar el stock.')) return;
        try {
            const response = await fetch(`${API_URL}/admin/orders/${orderId}/confirm`, { method: 'PUT', headers: authHeaders });
            if (await handleAuthError(response)) return;
            const result = await response.json();
            if (!response.ok) {
                alert(result.error || 'No se pudo confirmar el pedido.');
                return;
            }
            await fetchAndRenderOrders();
            await fetchAndRenderProducts();
        } catch (error) {
            console.error('Error al confirmar pedido:', error);
            alert('No se pudo confirmar el pedido.');
        }
    }

    async function handleCancelOrder(orderId) {
        if (!confirm('¿Cancelar este pedido?')) return;
        try {
            const response = await fetch(`${API_URL}/admin/orders/${orderId}/cancel`, { method: 'PUT', headers: authHeaders });
            if (await handleAuthError(response)) return;
            await fetchAndRenderOrders();
        } catch (error) {
            console.error('Error al cancelar pedido:', error);
            alert('No se pudo cancelar el pedido.');
        }
    }

    // --- EVENT LISTENERS ---
    if (productForm) productForm.addEventListener('submit', handleFormSubmit);

    if (productList) {
        productList.addEventListener('click', (e) => {
            if (e.target.matches('.edit-btn')) handleEdit(e.target.dataset.id);
            if (e.target.matches('.delete-btn')) handleDelete(e.target.dataset.id);
        });
    }

    if (orderList) {
        orderList.addEventListener('click', (e) => {
            if (e.target.matches('.confirm-order-btn')) handleConfirmOrder(e.target.dataset.id);
            if (e.target.matches('.cancel-order-btn')) handleCancelOrder(e.target.dataset.id);
        });
    }

    if (saleUnitSelect && stockInput) {
        saleUnitSelect.addEventListener('change', () => {
            stockInput.step = saleUnitSelect.value === 'kg' ? '0.1' : '1';
        });
        stockInput.step = saleUnitSelect.value === 'kg' ? '0.1' : '1';
    }

    if (cancelBtn) cancelBtn.addEventListener('click', resetForm);

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('adminToken');
            window.location.href = 'login.html';
        });
    }

    fetchAndRenderProducts();
    fetchAndRenderOrders();
});

document.addEventListener('DOMContentLoaded', () => {
    let products = [];
    let cart = [];
    let storeInfo = null;
    const productSelections = {};

    const SALE_UNIT_LABELS = {
        kg: 'kg',
        unit: 'unidad',
        bunch: 'atado',
        tray: 'bandeja',
        bag: 'bolsa',
    };

    const productList = document.getElementById('product-list');
    const cartItemsContainer = document.getElementById('cart-items');
    const cartTotalPrice = document.getElementById('cart-total-price');
    const cartCount = document.getElementById('cart-count');
    const checkoutBtn = document.querySelector('.checkout-btn');
    const cartSection = document.querySelector('.shopping-cart-section');
    const contactForm = document.getElementById('contact-form');
    const contactSuccess = document.getElementById('contact-success');

    function getSaleUnitLabel(saleUnit) {
        return SALE_UNIT_LABELS[saleUnit] || saleUnit || 'unidad';
    }

    function formatStockValue(stock) {
        return Number.isInteger(stock) ? stock.toString() : stock.toFixed(1);
    }

    function getProductSelection(productId) {
        if (!productSelections[productId]) {
            productSelections[productId] = { quantity: 1 };
        }
        return productSelections[productId];
    }

    function getCartItemKey(productId, packSize) {
        return `${productId}-${packSize}`;
    }

    function findCartItem(productId, packSize) {
        return cart.find((item) => item.key === getCartItemKey(productId, packSize));
    }

    function formatProductPurchaseLabel(product, packSize) {
        if (product.saleUnit === 'kg') {
            return `${packSize} kg`;
        }
        return getSaleUnitLabel(product.saleUnit);
    }

    async function fetchProducts() {
        try {
            const response = await fetch(`${API_URL}/products`);
            if (!response.ok) throw new Error('No se pudieron cargar los productos.');
            products = await response.json();
            renderProducts();
        } catch (error) {
            console.error('Error fetching products:', error);
            if (productList) {
                productList.innerHTML = '<p>Lo sentimos, no se pueden mostrar los productos en este momento.</p>';
            }
        }
    }

    async function fetchStoreInfo() {
        try {
            const response = await fetch(`${API_URL}/store-info`);
            if (response.ok) storeInfo = await response.json();
        } catch (error) {
            console.error('Error fetching store info:', error);
        }
    }

    function renderProducts() {
        if (!productList) return;
        productList.innerHTML = '';
        products.forEach((product) => {
            const selection = getProductSelection(product.id);
            const saleUnitLabel = getSaleUnitLabel(product.saleUnit);
            const productCard = document.createElement('div');
            productCard.className = 'product-card';
            const sinStock = product.stock <= 0;
            productCard.innerHTML = `
                <div class="product-card-image">
                    <img src="${product.image}" alt="${product.name}" onerror="this.src='https://via.placeholder.com/300?text=Sin+imagen'; this.onerror=null;">
                    <span class="price-tag">$${product.price.toFixed(2)} / ${saleUnitLabel}</span>
                </div>
                <div class="product-info">
                    <h3>${product.name}</h3>
                    ${sinStock ? '<p class="sin-stock">Sin stock por ahora</p>' : `<p class="stock-note">${formatStockValue(product.stock)} ${saleUnitLabel} disponibles</p>`}
                    <div class="purchase-controls" data-id="${product.id}">
                        ${product.saleUnit === 'kg' ? `
                            <label class="pack-size-label" for="pack-size-${product.id}">Presentación</label>
                            <select class="pack-size-select" id="pack-size-${product.id}" data-id="${product.id}">
                                <option value="0.5">0.5 kg</option>
                                <option value="1" selected>1 kg</option>
                            </select>
                        ` : `<span class="unit-badge">${saleUnitLabel}</span>`}
                        <div class="quantity-control" data-id="${product.id}">
                            <button type="button" class="quantity-btn quantity-btn-minus" data-id="${product.id}">−</button>
                            <span class="quantity-value" data-id="${product.id}">${selection.quantity}</span>
                            <button type="button" class="quantity-btn quantity-btn-plus" data-id="${product.id}">+</button>
                        </div>
                    </div>
                    <button class="add-to-cart-btn" data-id="${product.id}" ${sinStock ? 'disabled' : ''}>
                        <i class="fa-solid fa-cart-plus"></i> Agregar
                    </button>
                </div>
            `;
            productList.appendChild(productCard);
        });
    }

    function renderCart() {
        if (!cartItemsContainer) return;
        cartItemsContainer.innerHTML = '';
        if (cart.length === 0) {
            cartItemsContainer.innerHTML = '<p>Tu carrito está vacío.</p>';
        } else {
            cart.forEach((item) => {
                const totalUnits = item.quantity * item.packSize;
                const lineTotal = item.price * totalUnits;
                const purchaseLabel = formatProductPurchaseLabel(item, item.packSize);
                const cartItem = document.createElement('div');
                cartItem.className = 'cart-item';
                cartItem.innerHTML = `
                    <div class="cart-item-info">
                        <img src="${item.image}" alt="${item.name}" onerror="this.src='https://via.placeholder.com/50'; this.onerror=null;">
                        <div>
                            <strong>${item.name}</strong>
                            <p>${item.quantity} x ${purchaseLabel} · $${lineTotal.toFixed(2)}</p>
                        </div>
                    </div>
                    <div class="cart-item-actions">
                        <div class="cart-quantity-control">
                            <button type="button" class="cart-qty-btn" data-action="decrease" data-key="${item.key}">−</button>
                            <span>${item.quantity}</span>
                            <button type="button" class="cart-qty-btn" data-action="increase" data-key="${item.key}">+</button>
                        </div>
                        <button class="remove-from-cart-btn" data-key="${item.key}">&times;</button>
                    </div>
                `;
                cartItemsContainer.appendChild(cartItem);
            });
        }
        updateCartInfo();
    }

    function updateCartInfo() {
        if (!cartCount || !cartTotalPrice || !checkoutBtn) return;
        const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
        const totalPrice = cart.reduce((sum, item) => sum + item.price * item.quantity * item.packSize, 0);
        cartCount.textContent = totalItems;
        cartTotalPrice.textContent = totalPrice.toFixed(2);
        checkoutBtn.disabled = cart.length === 0;
    }

    function addToCart(productId, options = {}) {
        const product = products.find((p) => p.id === productId);
        if (!product) return;
        const packSize = product.saleUnit === 'kg' ? (Number(options.packSize) === 0.5 ? 0.5 : 1) : 1;
        const quantity = Math.max(1, Number.parseInt(options.quantity, 10) || 1);
        const requestedUnits = quantity * packSize;
        const existingItem = findCartItem(productId, packSize);
        const currentRequested = existingItem ? existingItem.quantity * existingItem.packSize : 0;

        if (currentRequested + requestedUnits > product.stock + 1e-9) {
            alert(`No hay más stock disponible de ${product.name}.`);
            return;
        }

        if (existingItem) {
            existingItem.quantity += quantity;
        } else {
            cart.push({ ...product, key: getCartItemKey(productId, packSize), packSize, quantity });
        }
        renderCart();
    }

    function adjustCartQuantity(itemKey, delta) {
        const item = cart.find((entry) => entry.key === itemKey);
        if (!item) return;

        const product = products.find((entry) => entry.id === item.id);
        if (!product) return;

        const nextQuantity = item.quantity + delta;
        if (nextQuantity <= 0) {
            cart = cart.filter((entry) => entry.key !== itemKey);
            renderCart();
            return;
        }

        const requestedUnits = nextQuantity * item.packSize;
        if (requestedUnits > product.stock + 1e-9) {
            alert(`No hay más stock disponible de ${product.name}.`);
            return;
        }

        item.quantity = nextQuantity;
        renderCart();
    }

    function removeFromCart(itemKey) {
        cart = cart.filter((item) => item.key !== itemKey);
        renderCart();
    }

    function buildWhatsappMessage(order) {
        const lineas = order.items.map((item) => {
            const purchaseLabel = formatProductPurchaseLabel(item, item.packSize || 1);
            const lineTotal = item.price * item.quantity * (item.packSize || 1);
            return `• ${item.quantity} x ${purchaseLabel} ${item.name} — $${lineTotal.toFixed(2)}`;
        }).join('%0A');
        const texto =
            `Hola! Quiero confirmar el pago del pedido #${order.orderId} de ${order.storeName}.%0A%0A` +
            `${lineas}%0A%0A` +
            `Total: $${order.total.toFixed(2)}%0A%0A` +
            `Ya hice la transferencia, te mando el comprobante:`;
        return `https://wa.me/${order.whatsappNumber}?text=${texto}`;
    }

    function showPaymentInstructions(order) {
        const box = document.createElement('div');
        box.className = 'order-confirmation';
        box.innerHTML = `
            <h3>¡Pedido #${order.orderId} registrado!</h3>
            <p>Transferí <strong>$${order.total.toFixed(2)}</strong> a:</p>
            <ul class="transfer-details">
                <li><strong>Alias:</strong> ${order.transferAlias}</li>
                ${order.transferCbu ? `<li><strong>CBU:</strong> ${order.transferCbu}</li>` : ''}
            </ul>
            <p>Después mandanos el comprobante por WhatsApp con el número de pedido, y en cuanto lo confirmemos preparamos tu compra.</p>
            <a class="whatsapp-btn" href="${buildWhatsappMessage(order)}" target="_blank" rel="noopener">
                <i class="fa-brands fa-whatsapp"></i> Enviar comprobante por WhatsApp
            </a>
        `;
        cartSection.appendChild(box);
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    async function handleCheckout() {
        if (cart.length === 0) return;
        checkoutBtn.textContent = 'Registrando pedido...';
        checkoutBtn.disabled = true;

        try {
            const response = await fetch(`${API_URL}/checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cart: cart.map((item) => ({ id: item.id, quantity: item.quantity, packSize: item.packSize })),
                }),
            });

            const result = await response.json();

            if (!response.ok) {
                alert(result.error || 'Hubo un problema al procesar el pedido.');
                checkoutBtn.textContent = 'Pedir por transferencia';
                updateCartInfo();
                return;
            }

            document.querySelectorAll('.order-confirmation').forEach((el) => el.remove());
            showPaymentInstructions(result);
            cart = [];
            renderCart();
        } catch (error) {
            console.error('Error en el checkout:', error);
            alert('No se pudo registrar el pedido. Inténtalo de nuevo.');
        } finally {
            checkoutBtn.textContent = 'Pedir por transferencia';
            updateCartInfo();
        }
    }

    async function handleContactSubmit(e) {
        e.preventDefault();
        const submitBtn = contactForm.querySelector('.contact-submit-btn');
        submitBtn.disabled = true;

        try {
            await fetch(`${API_URL}/contact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: document.getElementById('contact-name').value,
                    email: document.getElementById('contact-email').value,
                    message: document.getElementById('contact-message').value,
                }),
            });
            contactForm.reset();
            contactSuccess.style.display = 'block';
        } catch (error) {
            console.error('Error al enviar contacto:', error);
            alert('No se pudo enviar el mensaje. Probá de nuevo más tarde.');
        } finally {
            submitBtn.disabled = false;
        }
    }

    // --- EVENT LISTENERS ---
    if (productList) {
        productList.addEventListener('click', (e) => {
            const plusButton = e.target.closest('.quantity-btn-plus');
            const minusButton = e.target.closest('.quantity-btn-minus');
            const addButton = e.target.closest('.add-to-cart-btn');

            if (plusButton) {
                const productId = parseInt(plusButton.dataset.id, 10);
                const selection = getProductSelection(productId);
                selection.quantity += 1;
                const quantityValue = productList.querySelector(`.quantity-value[data-id="${productId}"]`);
                if (quantityValue) quantityValue.textContent = selection.quantity;
                return;
            }

            if (minusButton) {
                const productId = parseInt(minusButton.dataset.id, 10);
                const selection = getProductSelection(productId);
                selection.quantity = Math.max(1, selection.quantity - 1);
                const quantityValue = productList.querySelector(`.quantity-value[data-id="${productId}"]`);
                if (quantityValue) quantityValue.textContent = selection.quantity;
                return;
            }

            if (addButton) {
                const productId = parseInt(addButton.dataset.id, 10);
                const product = products.find((p) => p.id === productId);
                const selection = getProductSelection(productId);
                const packSize = product?.saleUnit === 'kg'
                    ? Number(productList.querySelector(`#pack-size-${productId}`)?.value || 1)
                    : 1;
                addToCart(productId, { packSize, quantity: selection.quantity });
                return;
            }
        });
    }

    if (cartItemsContainer) {
        cartItemsContainer.addEventListener('click', (e) => {
            const cartPlus = e.target.closest('.cart-qty-btn[data-action="increase"]');
            const cartMinus = e.target.closest('.cart-qty-btn[data-action="decrease"]');
            const removeButton = e.target.closest('.remove-from-cart-btn');

            if (cartPlus) {
                adjustCartQuantity(cartPlus.dataset.key, 1);
                return;
            }

            if (cartMinus) {
                adjustCartQuantity(cartMinus.dataset.key, -1);
                return;
            }

            if (removeButton) {
                removeFromCart(removeButton.dataset.key);
            }
        });
    }

    if (checkoutBtn) checkoutBtn.addEventListener('click', handleCheckout);
    if (contactForm) contactForm.addEventListener('submit', handleContactSubmit);

    // Carga inicial
    if (document.getElementById('product-list')) fetchProducts();
    if (document.getElementById('cart-items')) renderCart();
    fetchStoreInfo();
});

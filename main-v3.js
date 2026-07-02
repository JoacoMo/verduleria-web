document.addEventListener('DOMContentLoaded', () => {
    let products = [];
    let cart = [];
    let storeInfo = null;

    const productList = document.getElementById('product-list');
    const cartItemsContainer = document.getElementById('cart-items');
    const cartTotalPrice = document.getElementById('cart-total-price');
    const cartCount = document.getElementById('cart-count');
    const checkoutBtn = document.querySelector('.checkout-btn');
    const cartSection = document.querySelector('.shopping-cart-section');
    const contactForm = document.getElementById('contact-form');
    const contactSuccess = document.getElementById('contact-success');

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
            const productCard = document.createElement('div');
            productCard.className = 'product-card';
            const sinStock = product.stock <= 0;
            productCard.innerHTML = `
                <div class="product-card-image">
                    <img src="${product.image}" alt="${product.name}" onerror="this.src='https://via.placeholder.com/300?text=Sin+imagen'; this.onerror=null;">
                    <span class="price-tag">$${product.price.toFixed(2)}</span>
                </div>
                <div class="product-info">
                    <h3>${product.name}</h3>
                    ${sinStock ? '<p class="sin-stock">Sin stock por ahora</p>' : `<p class="stock-note">${product.stock} disponibles</p>`}
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
                const cartItem = document.createElement('div');
                cartItem.className = 'cart-item';
                cartItem.innerHTML = `
                    <div class="cart-item-info">
                        <img src="${item.image}" alt="${item.name}" onerror="this.src='https://via.placeholder.com/50'; this.onerror=null;">
                        <div>
                            <strong>${item.name}</strong>
                            <p>$${item.price.toFixed(2)} x ${item.quantity}</p>
                        </div>
                    </div>
                    <button class="remove-from-cart-btn" data-id="${item.id}">&times;</button>
                `;
                cartItemsContainer.appendChild(cartItem);
            });
        }
        updateCartInfo();
    }

    function updateCartInfo() {
        if (!cartCount || !cartTotalPrice || !checkoutBtn) return;
        const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
        const totalPrice = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
        cartCount.textContent = totalItems;
        cartTotalPrice.textContent = totalPrice.toFixed(2);
        checkoutBtn.disabled = cart.length === 0;
    }

    function addToCart(productId) {
        const product = products.find((p) => p.id === productId);
        if (!product) return;
        const existingItem = cart.find((item) => item.id === productId);
        const currentQty = existingItem ? existingItem.quantity : 0;

        if (currentQty + 1 > product.stock) {
            alert(`No hay más stock disponible de ${product.name}.`);
            return;
        }

        if (existingItem) {
            existingItem.quantity++;
        } else {
            cart.push({ ...product, quantity: 1 });
        }
        renderCart();
    }

    function removeFromCart(productId) {
        cart = cart.filter((item) => item.id !== productId);
        renderCart();
    }

    function buildWhatsappMessage(order) {
        const lineas = cart.map((item) => `• ${item.quantity}x ${item.name} — $${(item.price * item.quantity).toFixed(2)}`).join('%0A');
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
                    cart: cart.map((item) => ({ id: item.id, quantity: item.quantity })),
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
            if (e.target.closest('.add-to-cart-btn')) {
                addToCart(parseInt(e.target.closest('.add-to-cart-btn').dataset.id));
            }
        });
    }

    if (cartItemsContainer) {
        cartItemsContainer.addEventListener('click', (e) => {
            if (e.target.closest('.remove-from-cart-btn')) {
                removeFromCart(parseInt(e.target.closest('.remove-from-cart-btn').dataset.id));
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

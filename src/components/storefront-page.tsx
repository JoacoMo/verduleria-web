'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { OrderConfirmation, OrderItem, Product, StoreInfo } from '@/lib/types';
import { PRODUCT_CART_STEP, PRODUCT_DEFAULT_CART_QUANTITY, PRODUCT_UNIT_LABELS, formatProductQuantity, normalizeProductQuantity } from '@/lib/product-units';

type CartItem = Product & { quantity: number };

const PLACEHOLDER_IMAGE = '/product-placeholder.svg';

const DEFAULT_STORE_INFO: StoreInfo = {
  storeName: 'El Pampa',
  storeAddress: 'Barrio General Paz, Córdoba Capital',
  storeHours: {
    weekday: 'Lunes a sábado de 8:00 a 14:00 y de 17:30 a 21:30',
    sunday: 'Domingos de 9:00 a 14:00',
  },
  transferAlias: 'mi.verduleria.alias',
  transferCbu: '',
  whatsappNumber: '5490000000000',
};

export default function StorefrontPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [storeInfo, setStoreInfo] = useState<StoreInfo>(DEFAULT_STORE_INFO);
  const [orderConfirmation, setOrderConfirmation] = useState<OrderConfirmation | null>(null);
  const [contactForm, setContactForm] = useState({ name: '', email: '', message: '' });
  const [contactSuccess, setContactSuccess] = useState(false);

  useEffect(() => {
    async function fetchProducts() {
      try {
        const response = await fetch('/api/products');
        if (!response.ok) throw new Error('No se pudieron cargar los productos.');
        setProducts(await response.json());
      } catch (error) {
        console.error('Error fetching products:', error);
      }
    }

    async function fetchStoreInfo() {
      try {
        const response = await fetch('/api/store-info');
        if (response.ok) {
          setStoreInfo(await response.json());
        }
      } catch (error) {
        console.error('Error fetching store info:', error);
      }
    }

    void fetchProducts();
    void fetchStoreInfo();
  }, []);

  const cartCount = useMemo(() => cart.length, [cart]);
  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart]);

  function addToCart(productId: number) {
    const product = products.find((item) => item.id === productId);
    if (!product) return;

    const quantityToAdd = PRODUCT_DEFAULT_CART_QUANTITY[product.unit];
    const existingItem = cart.find((item) => item.id === productId);

    setCart((currentCart) => {
      const nextCart = [...currentCart];
      const itemIndex = nextCart.findIndex((item) => item.id === productId);
      if (itemIndex >= 0) {
        nextCart[itemIndex] = {
          ...nextCart[itemIndex],
          quantity: normalizeProductQuantity(nextCart[itemIndex].quantity + quantityToAdd, product.unit),
        };
      } else {
        nextCart.push({ ...product, quantity: quantityToAdd });
      }
      return nextCart;
    });
  }

  function updateCartQuantity(productId: number, quantity: number) {
    setCart((currentCart) => currentCart.flatMap((item) => {
      if (item.id !== productId) return [item];
      const normalizedQuantity = normalizeProductQuantity(quantity, item.unit);
      if (normalizedQuantity <= 0) return [];
      return [{ ...item, quantity: normalizedQuantity }];
    }));
  }

  function removeFromCart(productId: number) {
    setCart((currentCart) => currentCart.filter((item) => item.id !== productId));
  }

  function buildWhatsappMessage(items: OrderItem[], orderId: number, total: number, isDelivery: boolean, totalWeight: number) {
    const lines = items.map((item) => `• ${item.name}: ${formatProductQuantity(item.quantity, item.unit)} - $${(item.price * item.quantity).toFixed(2)}`).join('%0A');
    const deliveryText = isDelivery ? 'Quiero que me lo envíen a domicilio.' : 'Voy a pasar a retirarlo.';
    const deliveryWarning = isDelivery && totalWeight > 7 ? '%0A%0A⚠️ *Nota:* Tu pedido pesa más de 7kg. Tené en cuenta que para Uber Moto el máximo suele ser 7-8kg.' : '';

    const text =
      `Hola! Realicé el pedido #${orderId} en ${storeInfo.storeName}.%0A%0A` +
      `*Pedido:*%0A${lines}%0A%0A` +
      `*Total:* $${total.toFixed(2)}%0A` +
      `*Entrega:* ${deliveryText}${deliveryWarning}%0A%0A` +
      'Ya hice la transferencia, te mando el comprobante:';
    return `https://wa.me/${storeInfo.whatsappNumber}?text=${text}`;
  }

  async function handleCheckout() {
    if (cart.length === 0) return;

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart: cart.map((item) => ({ id: item.id, quantity: item.quantity })) }),
      });

      const result = await response.json();
      if (!response.ok) {
        alert(result.error || 'Hubo un problema al procesar el pedido.');
        return;
      }

      setOrderConfirmation({ ...result, items: cart.map(({ id, name, price, quantity, unit }) => ({ id, name, price, quantity, unit })) });
      setCart([]);
    } catch (error) {
      console.error('Error en el checkout:', error);
      alert('No se pudo registrar el pedido. Inténtalo de nuevo.');
    }
  }

  async function handleContactSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(contactForm),
      });

      if (!response.ok) {
        throw new Error('No se pudo enviar el mensaje.');
      }

      setContactForm({ name: '', email: '', message: '' });
      setContactSuccess(true);
    } catch (error) {
      console.error('Error al enviar contacto:', error);
      alert('No se pudo enviar el mensaje. Probá de nuevo más tarde.');
    }
  }

  return (
    <>
      <header>
        <div className="container">
          <div className="hero-text">
            <h1><i className="fa-solid fa-carrot" />El Pampa</h1>
            <svg className="hero-underline" viewBox="0 0 260 14" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 9 C 40 2, 80 13, 120 7 S 200 1, 258 8" stroke="#C98A3E" strokeWidth="3" fill="none" strokeLinecap="round" />
            </svg>
            <p className="hero-tagline">Verdulería y frutería en Barrio General Paz, Córdoba Capital. Pedí por kilo, gramos o unidad y coordinamos retiro o envío.</p>
          </div>
          <div className="cart-icon">
            <i className="fa-solid fa-cart-shopping" />
            <span id="cart-count">{cartCount}</span>
          </div>
        </div>
        <svg className="header-edge" viewBox="0 0 1200 26" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0,0 L0,14 L30,22 L60,10 L90,20 L120,8 L150,18 L180,6 L210,16 L240,4 L270,14 L300,22 L330,10 L360,20 L390,8 L420,18 L450,6 L480,16 L510,4 L540,14 L570,22 L600,10 L630,20 L660,8 L690,18 L720,6 L750,16 L780,4 L810,14 L840,22 L870,10 L900,20 L930,8 L960,18 L990,6 L1020,16 L1050,4 L1080,14 L1110,22 L1140,10 L1170,20 L1200,8 L1200,26 L0,26 Z" fill="#FAF6EC" />
        </svg>
      </header>

      <main className="container">
        <h2><i className="fa-solid fa-leaf" /> Nuestros Productos Frescos</h2>
        <p className="section-subtitle">Productos por kilo, gramos o unidad, listos para pedir online.</p>
        <div className="product-grid">
          {products.map((product) => {
            const defaultQuantity = PRODUCT_DEFAULT_CART_QUANTITY[product.unit];
            return (
              <div className="product-card" key={product.id}>
                <div className="product-card-image">
                  <img src={product.image || PLACEHOLDER_IMAGE} alt={product.name} onError={(event) => { event.currentTarget.src = PLACEHOLDER_IMAGE; }} />
                  <span className="price-tag">${product.price.toFixed(2)} / {PRODUCT_UNIT_LABELS[product.unit]}</span>
                </div>
                <div className="product-info">
                  <h3>{product.name}</h3>
                  <p className="stock-note">Se vende por {PRODUCT_UNIT_LABELS[product.unit]}</p>
                  <button className="add-to-cart-btn" onClick={() => addToCart(product.id)}>
                    <i className="fa-solid fa-cart-plus" /> Agregar {formatProductQuantity(defaultQuantity, product.unit)}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <section className="shopping-cart-section">
          <h2 style={{ marginTop: 0 }}><i className="fa-solid fa-cart-shopping" /> Tu Carrito</h2>
          <div id="cart-items">
            {cart.length === 0 ? (
              <p>Tu carrito está vacío.</p>
            ) : (
              cart.map((item) => (
                <div className="cart-item" key={item.id}>
                  <div className="cart-item-info">
                    <img src={item.image || PLACEHOLDER_IMAGE} alt={item.name} onError={(event) => { event.currentTarget.src = PLACEHOLDER_IMAGE; }} />
                    <div>
                      <strong>{item.name}</strong>
                      <p>${item.price.toFixed(2)} x {formatProductQuantity(item.quantity, item.unit)}</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <label style={{ fontSize: '0.85rem', color: '#6c7a6a' }}>
                      {item.unit === 'kg' ? 'Kilogramos' : item.unit === 'g' ? 'Gramos' : 'Unidades'}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                        <button
                          type="button"
                          onClick={() => updateCartQuantity(item.id, item.quantity - PRODUCT_CART_STEP[item.unit])}
                          style={{ padding: '4px 8px' }}
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min={PRODUCT_CART_STEP[item.unit]}
                          step={PRODUCT_CART_STEP[item.unit]}
                          value={item.quantity}
                          onChange={(event) => updateCartQuantity(item.id, Number(event.target.value))}
                          style={{ width: 60, textAlign: 'center' }}
                        />
                        <button
                          type="button"
                          onClick={() => updateCartQuantity(item.id, item.quantity + PRODUCT_CART_STEP[item.unit])}
                          style={{ padding: '4px 8px' }}
                        >
                          +
                        </button>
                      </div>
                    </label>
                    <button className="remove-from-cart-btn" onClick={() => removeFromCart(item.id)} title="Eliminar producto">&times;</button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="cart-total">Total: $<span>{cartTotal.toFixed(2)}</span></div>
          <button className="checkout-btn" onClick={handleCheckout} disabled={cart.length === 0}>Pedir por transferencia</button>

          {orderConfirmation ? (
            <div className="order-confirmation">
              <h3>¡Pedido #{orderConfirmation.orderId} registrado!</h3>
              <p>Transferí <strong>${orderConfirmation.total.toFixed(2)}</strong> a:</p>
              <ul className="transfer-details">
                <li><strong>Alias:</strong> {orderConfirmation.transferAlias}</li>
                {orderConfirmation.transferCbu ? <li><strong>CBU:</strong> {orderConfirmation.transferCbu}</li> : null}
              </ul>
              <p>Después mandanos el comprobante por WhatsApp con el número de pedido, y en cuanto lo confirmemos preparamos tu compra.</p>
              <a className="whatsapp-btn" href={buildWhatsappMessage(orderConfirmation.items, orderConfirmation.orderId, orderConfirmation.total, isDelivery, totalWeight)} target="_blank" rel="noopener noreferrer">
                <i className="fa-brands fa-whatsapp" /> Enviar comprobante por WhatsApp
              </a>
            </div>
          ) : null}
        </section>

        <section className="contact-section">
          <h2 style={{ marginTop: 0 }}><i className="fa-solid fa-envelope" /> Contacto</h2>
          <div className="contact-grid">
            <div className="contact-info">
              <p><i className="fa-solid fa-location-dot" /> {storeInfo.storeAddress}</p>
              <p><i className="fa-brands fa-whatsapp" /> <a href={`https://wa.me/${storeInfo.whatsappNumber}`} target="_blank" rel="noopener noreferrer">WhatsApp: 3517656500</a></p>
              <p><i className="fa-solid fa-envelope" /> <a href="mailto:contacto@tuverduleria.com">contacto@tuverduleria.com</a></p>
              <p><i className="fa-solid fa-clock" /> {storeInfo.storeHours.weekday}</p>
              <p><i className="fa-solid fa-clock" /> {storeInfo.storeHours.sunday}</p>
            </div>
            <form className="contact-form" onSubmit={handleContactSubmit}>
              <div className="form-group">
                <input type="text" placeholder="Tu nombre" required value={contactForm.name} onChange={(event) => setContactForm((current) => ({ ...current, name: event.target.value }))} />
              </div>
              <div className="form-group">
                <input type="email" placeholder="Tu email" required value={contactForm.email} onChange={(event) => setContactForm((current) => ({ ...current, email: event.target.value }))} />
              </div>
              <div className="form-group">
                <textarea rows={4} placeholder="Tu mensaje" required value={contactForm.message} onChange={(event) => setContactForm((current) => ({ ...current, message: event.target.value }))} />
              </div>
              <button type="submit" className="contact-submit-btn">Enviar mensaje</button>
              {contactSuccess ? <p style={{ color: 'var(--leaf)', fontWeight: 600 }}>¡Mensaje enviado! Te vamos a responder pronto.</p> : null}
            </form>
          </div>

          <div className="map-container">
            <iframe
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d4211.8315560727915!2d-64.16876892364488!3d-31.41596097426193!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x9432a2a385140651%3A0xc7a2b6dd6ae27bd!2sEl%20Pampa!5e1!3m2!1ses!2sar!4v1785775498093!5m2!1ses!2sar"
              width="600"
              height="450"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              title="Ubicación de la verdulería"
            />
          </div>
        </section>
      </main>

      <footer>
        <div className="container">
          <p>&copy; 2026 El Pampa. Verdulería y frutería en Barrio General Paz, Córdoba Capital.</p>
        </div>
      </footer>
    </>
  );
}
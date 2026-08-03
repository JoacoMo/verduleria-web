'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { OrderConfirmation, OrderItem, Product, StoreInfo } from '@/lib/types';

type CartItem = Product & { quantity: number };

const DEFAULT_STORE_INFO: StoreInfo = {
  storeName: 'Verdulería Fresca',
  storeAddress: 'Rosario de Santa Fe 1211, Córdoba Capital',
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

  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
  const cartTotal = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart]);

  function addToCart(productId: number) {
    const product = products.find((item) => item.id === productId);
    if (!product) return;

    const existingItem = cart.find((item) => item.id === productId);
    const currentQty = existingItem ? existingItem.quantity : 0;

    if (currentQty + 1 > product.stock) {
      alert(`No hay más stock disponible de ${product.name}.`);
      return;
    }

    setCart((currentCart) => {
      const nextCart = [...currentCart];
      const itemIndex = nextCart.findIndex((item) => item.id === productId);
      if (itemIndex >= 0) {
        nextCart[itemIndex] = { ...nextCart[itemIndex], quantity: nextCart[itemIndex].quantity + 1 };
      } else {
        nextCart.push({ ...product, quantity: 1 });
      }
      return nextCart;
    });
  }

  function removeFromCart(productId: number) {
    setCart((currentCart) => currentCart.filter((item) => item.id !== productId));
  }

  function buildWhatsappMessage(items: OrderItem[], orderId: number, total: number) {
    const lines = items.map((item) => `• ${item.quantity}x ${item.name} — $${(item.price * item.quantity).toFixed(2)}`).join('%0A');
    const text =
      `Hola! Quiero confirmar el pago del pedido #${orderId} de ${storeInfo.storeName}.%0A%0A` +
      `${lines}%0A%0A` +
      `Total: $${total.toFixed(2)}%0A%0A` +
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

      setOrderConfirmation({ ...result, items: cart.map(({ id, name, price, quantity }) => ({ id, name, price, quantity })) });
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
            <h1><i className="fa-solid fa-carrot" />Verdulería Fresca</h1>
            <svg className="hero-underline" viewBox="0 0 260 14" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 9 C 40 2, 80 13, 120 7 S 200 1, 258 8" stroke="#C98A3E" strokeWidth="3" fill="none" strokeLinecap="round" />
            </svg>
            <p className="hero-tagline">Del cajón a tu mesa. Verdura y fruta fresca todos los días, pedís online y retirás o coordinamos la entrega.</p>
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
        <p className="section-subtitle">Cosecha del día, directo del cajón.</p>
        <div className="product-grid">
          {products.map((product) => {
            const sinStock = product.stock <= 0;
            return (
              <div className="product-card" key={product.id}>
                <div className="product-card-image">
                  <img src={product.image} alt={product.name} onError={(event) => { event.currentTarget.src = 'https://via.placeholder.com/300?text=Sin+imagen'; }} />
                  <span className="price-tag">${product.price.toFixed(2)}</span>
                </div>
                <div className="product-info">
                  <h3>{product.name}</h3>
                  {sinStock ? <p className="sin-stock">Sin stock por ahora</p> : <p className="stock-note">{product.stock} disponibles</p>}
                  <button className="add-to-cart-btn" onClick={() => addToCart(product.id)} disabled={sinStock}>
                    <i className="fa-solid fa-cart-plus" /> Agregar
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
                    <img src={item.image} alt={item.name} onError={(event) => { event.currentTarget.src = 'https://via.placeholder.com/50'; }} />
                    <div>
                      <strong>{item.name}</strong>
                      <p>${item.price.toFixed(2)} x {item.quantity}</p>
                    </div>
                  </div>
                  <button className="remove-from-cart-btn" onClick={() => removeFromCart(item.id)}>&times;</button>
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
              <a className="whatsapp-btn" href={buildWhatsappMessage(orderConfirmation.items, orderConfirmation.orderId, orderConfirmation.total)} target="_blank" rel="noopener noreferrer">
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
          <p>&copy; 2026 Verdulería Fresca. Todos los derechos reservados.</p>
        </div>
      </footer>
    </>
  );
}
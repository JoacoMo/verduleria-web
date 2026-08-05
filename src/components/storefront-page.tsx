'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { OrderConfirmation, OrderItem, Product, StoreInfo } from '@/lib/types';
import type { ProductUnit } from '@/lib/product-units';
import { PRODUCT_CART_STEP, PRODUCT_DEFAULT_CART_QUANTITY, PRODUCT_UNIT_LABELS, formatProductQuantity, normalizeProductQuantity } from '@/lib/product-units';
import { matchesSearch } from '@/lib/search';
import { isPastOrderCutoff, isStoreOpenNow } from '@/lib/store-hours';
import { PRODUCT_CATEGORIES, type ProductCategory } from '@/lib/product-categories';

type CartItem = Product & { quantity: number };
type CategoryFilter = ProductCategory | 'Todas';

const PLACEHOLDER_IMAGE = '/product-placeholder.svg';
const INITIAL_VISIBLE_PRODUCTS = 8;
const MAP_DIRECTIONS_URL = 'https://maps.google.com/?cid=899078826367002557';
const CATEGORY_FILTERS: CategoryFilter[] = ['Todas', ...PRODUCT_CATEGORIES];

const DEFAULT_STORE_INFO: StoreInfo = {
  storeName: 'El Pampa',
  storeAddress: 'Rosario de Santafe 1211, Córdoba Capital',
  storeHours: {
    weekday: 'Lunes a sábado de 8:00 a 14:00 y de 17:30 a 21:30',
    sunday: 'Domingos de 9:00 a 14:00',
  },
  transferAlias: 'jgastaldo',
  transferCbu: '',
  whatsappNumber: '5493517656500',
  deliveryProviderName: 'Uber Moto',
  deliveryMaxWeightKg: 7,
  deliveryMinPurchase: 10000,
};

export default function StorefrontPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [storeInfo, setStoreInfo] = useState<StoreInfo>(DEFAULT_STORE_INFO);
  const [orderConfirmation, setOrderConfirmation] = useState<OrderConfirmation | null>(null);
  const [isDelivery, setIsDelivery] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [unitModes, setUnitModes] = useState<Record<number, ProductUnit>>({});
  const [gridQuantities, setGridQuantities] = useState<Record<number, number>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('Todas');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [storeStatus, setStoreStatus] = useState<{ open: boolean; pastCutoff: boolean } | null>(null);

  useEffect(() => {
    if (!toastMessage) return;
    const timeout = setTimeout(() => setToastMessage(null), 2500);
    return () => clearTimeout(timeout);
  }, [toastMessage]);

  useEffect(() => {
    function updateStoreStatus() {
      setStoreStatus({ open: isStoreOpenNow(), pastCutoff: isPastOrderCutoff() });
    }
    updateStoreStatus();
    const interval = setInterval(updateStoreStatus, 60_000);
    return () => clearInterval(interval);
  }, []);
  const totalWeight = useMemo(() => cart.reduce((sum, item) => item.unit === 'kg' ? sum + item.quantity : sum, 0), [cart]);

  useEffect(() => {
    if (!isCartOpen) return;

    document.body.style.overflow = 'hidden';
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsCartOpen(false);
    }
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isCartOpen]);

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
  const belowDeliveryMinimum = isDelivery && cartTotal < storeInfo.deliveryMinPurchase;

  function addToCart(productId: number, quantityToAdd?: number) {
    const product = products.find((item) => item.id === productId);
    if (!product) return;

    const quantity = quantityToAdd ?? PRODUCT_DEFAULT_CART_QUANTITY[product.unit];

    setCart((currentCart) => {
      const nextCart = [...currentCart];
      const itemIndex = nextCart.findIndex((item) => item.id === productId);
      if (itemIndex >= 0) {
        nextCart[itemIndex] = {
          ...nextCart[itemIndex],
          quantity: normalizeProductQuantity(nextCart[itemIndex].quantity + quantity, product.unit),
        };
      } else {
        nextCart.push({ ...product, quantity });
      }
      return nextCart;
    });

    setToastMessage(`${product.name} agregado al carrito`);
  }

  function getGridQuantity(product: Product) {
    return gridQuantities[product.id] ?? PRODUCT_DEFAULT_CART_QUANTITY[product.unit];
  }

  function adjustGridSelection(productId: number, direction: 1 | -1) {
    const product = products.find((item) => item.id === productId);
    if (!product) return;
    const step = PRODUCT_CART_STEP[product.unit];

    setGridQuantities((current) => {
      const currentQuantity = current[productId] ?? PRODUCT_DEFAULT_CART_QUANTITY[product.unit];
      const nextQuantity = normalizeProductQuantity(currentQuantity + direction * step, product.unit);
      if (nextQuantity < step) return current;
      return { ...current, [productId]: nextQuantity };
    });
  }

  function addSelectedToCart(productId: number) {
    const product = products.find((item) => item.id === productId);
    if (!product) return;
    addToCart(productId, getGridQuantity(product));
  }

  function updateCartQuantityInUnit(productId: number, displayValue: number, displayUnit: ProductUnit) {
    setCart((currentCart) => currentCart.map((item) => {
      if (item.id !== productId) return item;
      // Si el usuario resta hasta 0 (o escribe 0 a mano), no se saca el producto del
      // carrito solo: puede ser un missclick y tendría que buscarlo de nuevo. Se clampea
      // a la cantidad mínima; para sacarlo de verdad está el botón de la ×.
      const normalizedDisplay = displayValue <= 0
        ? PRODUCT_CART_STEP[displayUnit]
        : normalizeProductQuantity(displayValue, displayUnit);
      const nativeQuantity = displayUnit === item.unit
        ? normalizedDisplay
        : item.unit === 'kg' ? normalizedDisplay / 1000 : normalizedDisplay * 1000;
      return { ...item, quantity: Number(nativeQuantity.toFixed(3)) };
    }));
  }

  function removeFromCart(productId: number) {
    setCart((currentCart) => currentCart.filter((item) => item.id !== productId));
    setUnitModes((current) => {
      if (!(productId in current)) return current;
      const next = { ...current };
      delete next[productId];
      return next;
    });
  }

  const filteredProducts = useMemo(() => {
    const byCategory = activeCategory === 'Todas'
      ? products
      : products.filter((product) => product.category === activeCategory);
    if (!searchQuery.trim()) return byCategory;
    return byCategory.filter((product) => matchesSearch(product.name, searchQuery));
  }, [products, searchQuery, activeCategory]);

  const isSearching = searchQuery.trim().length > 0;
  const visibleProducts = isSearching || showAllProducts
    ? filteredProducts
    : filteredProducts.slice(0, INITIAL_VISIBLE_PRODUCTS);
  const hasMoreProducts = !isSearching && !showAllProducts && filteredProducts.length > INITIAL_VISIBLE_PRODUCTS;

  const relatedProducts = useMemo(() => {
    if (cart.length === 0) return [];
    const cartIds = new Set(cart.map((item) => item.id));
    return products.filter((product) => !cartIds.has(product.id)).slice(0, 4);
  }, [products, cart]);

  function buildWhatsappMessage(items: OrderItem[], orderId: number, total: number, isDelivery: boolean, totalWeight: number) {
    const lines = items.map((item) => {
      const quantityText = item.unit === 'unidad' ? `${item.quantity}x` : `${item.quantity}${item.unit}x`;
      return `- ${quantityText} ${item.name}: $${(item.price * item.quantity).toFixed(2)}`;
    }).join('\n');

    const maxWeight = storeInfo.deliveryMaxWeightKg;
    const deliveryText = isDelivery
      ? `Quiero que me lo envíen por ${storeInfo.deliveryProviderName}.`
      : 'Quiero retirarlo en el local.';
    const deliveryWarning = isDelivery && totalWeight > maxWeight
      ? `\n⚠️ Nota: el pedido pesa más de ${maxWeight}kg, tené en cuenta que para ${storeInfo.deliveryProviderName} el máximo suele ser ${maxWeight}-${maxWeight + 1}kg.`
      : '';

    const text =
      `Hola! Quiero hacer el pedido #${orderId} de ${storeInfo.storeName}.\n\n` +
      `${lines}\n\n` +
      `Total: $${total.toFixed(2)}\n\n` +
      `Entrega: ${deliveryText}${deliveryWarning}\n\n` +
      '¡Te envío el comprobante de la transferencia!';
    return `https://wa.me/${storeInfo.whatsappNumber}?text=${encodeURIComponent(text)}`;
  }

  async function handleCheckout() {
    if (cart.length === 0) return;

    // Se abre una pestaña en blanco de forma síncrona (dentro del gesto del click)
    // para evitar que el navegador bloquee el popup al redirigirla después del fetch.
    const waTab = window.open('', '_blank');

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cart: cart.map((item) => ({ id: item.id, quantity: item.quantity })),
          isDelivery,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        waTab?.close();
        alert(result.error || 'Hubo un problema al procesar el pedido.');
        return;
      }

      const items = cart.map(({ id, name, price, quantity, unit }) => ({ id, name, price, quantity, unit }));
      const waLink = buildWhatsappMessage(items, result.orderId, result.total, isDelivery, totalWeight);
      setOrderConfirmation({ ...result, items, whatsappUrl: waLink });

      if (waTab) {
        waTab.location.href = waLink;
      } else {
        window.open(waLink, '_blank', 'noopener,noreferrer');
      }

      setCart([]);
    } catch (error) {
      waTab?.close();
      console.error('Error en el checkout:', error);
      alert('No se pudo registrar el pedido. Inténtalo de nuevo.');
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
          <button type="button" className="cart-icon" onClick={() => setIsCartOpen(true)} aria-label="Abrir carrito">
            <i className="fa-solid fa-cart-shopping" />
            <span id="cart-count">{cartCount}</span>
          </button>
        </div>
        <svg className="header-edge" viewBox="0 0 1200 26" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0,0 L0,14 L30,22 L60,10 L90,20 L120,8 L150,18 L180,6 L210,16 L240,4 L270,14 L300,22 L330,10 L360,20 L390,8 L420,18 L450,6 L480,16 L510,4 L540,14 L570,22 L600,10 L630,20 L660,8 L690,18 L720,6 L750,16 L780,4 L810,14 L840,22 L870,10 L900,20 L930,8 L960,18 L990,6 L1020,16 L1050,4 L1080,14 L1110,22 L1140,10 L1170,20 L1200,8 L1200,26 L0,26 Z" fill="#FAF6EC" />
        </svg>
      </header>

      <main className="container">
        <h2><i className="fa-solid fa-leaf" /> Nuestros Productos</h2>
        <p className="section-subtitle">Productos por kilo, gramos o unidad, listos para pedir online.</p>

        <div className="search-bar">
          <i className="fa-solid fa-magnifying-glass" />
          <input
            type="search"
            placeholder="Buscar productos..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            aria-label="Buscar productos"
          />
        </div>

        <div className="category-filters">
          {CATEGORY_FILTERS.map((category) => (
            <button
              key={category}
              type="button"
              className={`category-filter-btn ${activeCategory === category ? 'active' : ''}`}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>

        {filteredProducts.length === 0 ? (
          <p className="no-results">
            {isSearching
              ? `No encontramos productos con "${searchQuery}".`
              : `No hay productos en "${activeCategory}" por ahora.`}
          </p>
        ) : (
          <div className="product-grid">
            {visibleProducts.map((product) => {
              const selectedQuantity = getGridQuantity(product);
              const step = PRODUCT_CART_STEP[product.unit];
              return (
                <div className="product-card" key={product.id}>
                  <div className="product-card-image">
                    <img src={product.image || PLACEHOLDER_IMAGE} alt={product.name} onError={(event) => { event.currentTarget.src = PLACEHOLDER_IMAGE; }} />
                    <span className="price-tag">${product.price.toFixed(2)} / {PRODUCT_UNIT_LABELS[product.unit]}</span>
                  </div>
                  <div className="product-info">
                    <h3>{product.name}</h3>
                    <p className="stock-note">Se vende por {PRODUCT_UNIT_LABELS[product.unit]}</p>
                    <div className="grid-qty-controls">
                      <button type="button" disabled={selectedQuantity <= step} onClick={() => adjustGridSelection(product.id, -1)} aria-label={`Restar cantidad de ${product.name}`}>-</button>
                      <span>{formatProductQuantity(selectedQuantity, product.unit)}</span>
                      <button type="button" onClick={() => adjustGridSelection(product.id, 1)} aria-label={`Sumar cantidad de ${product.name}`}>+</button>
                    </div>
                    <button className="add-to-cart-btn" onClick={() => addSelectedToCart(product.id)}>
                      <i className="fa-solid fa-cart-plus" /> Añadir al carrito
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {hasMoreProducts ? (
          <button type="button" className="show-more-btn" onClick={() => setShowAllProducts(true)}>
            Ver todos los productos ({filteredProducts.length})
          </button>
        ) : null}

        {!isSearching && showAllProducts && filteredProducts.length > INITIAL_VISIBLE_PRODUCTS ? (
          <button type="button" className="show-more-btn" onClick={() => setShowAllProducts(false)}>
            Ver menos
          </button>
        ) : null}

        <section className="contact-section">
          <div className="contact-heading">
            <h2 style={{ marginTop: 0 }}><i className="fa-solid fa-store" /> Dónde estamos</h2>
            {storeStatus ? (
              <span className={`store-status-badge ${storeStatus.open ? 'open' : 'closed'}`}>
                <i className="fa-solid fa-circle" /> {storeStatus.open ? 'Abierto ahora' : 'Cerrado ahora'}
              </span>
            ) : null}
          </div>
          <div className="contact-info">
            <p>
              <i className="fa-solid fa-location-dot" />{' '}
              <a href={MAP_DIRECTIONS_URL} target="_blank" rel="noopener noreferrer">{storeInfo.storeAddress}</a>
            </p>
            <p><i className="fa-brands fa-whatsapp" /> <a href={`https://wa.me/${storeInfo.whatsappNumber}`} target="_blank" rel="noopener noreferrer">WhatsApp: 3517656500</a></p>
            <p><i className="fa-solid fa-envelope" /> <a href="mailto:gastaldo50@gmail.com">gastaldo50@gmail.com</a></p>
            <p><i className="fa-solid fa-clock" /> {storeInfo.storeHours.weekday}</p>
            <p><i className="fa-solid fa-clock" /> {storeInfo.storeHours.sunday}</p>
            <p className="order-cutoff-note">
              <i className="fa-solid fa-triangle-exclamation" />{' '}
              {storeStatus?.pastCutoff
                ? 'Ya pasaron las 19:00, así que los pedidos de hoy se toman en cuenta recién mañana.'
                : 'Los pedidos hechos después de las 19:00 se toman en cuenta a partir del día siguiente.'}
            </p>
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

      <div className={`cart-drawer-overlay ${isCartOpen ? 'open' : ''}`} onClick={() => setIsCartOpen(false)}>
        <aside className="cart-drawer" onClick={(event) => event.stopPropagation()}>
          <div className="cart-drawer-header">
            <h2><i className="fa-solid fa-cart-shopping" /> Tu carrito</h2>
            <button type="button" className="cart-drawer-close" onClick={() => setIsCartOpen(false)} aria-label="Cerrar carrito">&times;</button>
          </div>

          {orderConfirmation ? (
            <div className="cart-drawer-body">
              <div className="order-confirmation">
                <h3>¡Pedido #{orderConfirmation.orderId} registrado!</h3>
                <p>Transferí <strong>${orderConfirmation.total.toFixed(2)}</strong> a:</p>
                <ul className="transfer-details">
                  <li><strong>Alias:</strong> {orderConfirmation.transferAlias}</li>
                  {orderConfirmation.transferCbu ? <li><strong>CBU:</strong> {orderConfirmation.transferCbu}</li> : null}
                </ul>
                <p>Ya te abrimos WhatsApp con el detalle del pedido. Cuando hagas la transferencia, mandanos el comprobante por ahí.</p>
                <a className="whatsapp-btn" href={orderConfirmation.whatsappUrl} target="_blank" rel="noopener noreferrer">
                  <i className="fa-brands fa-whatsapp" /> Reenviar pedido por WhatsApp
                </a>
                <button type="button" className="continue-shopping-btn" onClick={() => setOrderConfirmation(null)}>
                  ¿Querés hacer otro pedido? Seguir comprando
                </button>
              </div>
            </div>
          ) : (
          <>
          <div className="cart-drawer-body">
            {cart.length === 0 ? (
              <p>Tu carrito está vacío.</p>
            ) : (
              cart.map((item) => {
                const displayUnit = item.unit === 'unidad' ? 'unidad' : (unitModes[item.id] ?? item.unit);
                const displayQuantity = displayUnit === item.unit
                  ? item.quantity
                  : item.unit === 'kg' ? item.quantity * 1000 : item.quantity / 1000;
                const step = PRODUCT_CART_STEP[displayUnit];

                return (
                  <div className="cart-drawer-item" key={item.id}>
                    <button className="remove-from-cart-btn" onClick={() => removeFromCart(item.id)} title="Sacar producto">&times;</button>
                    <div className="cart-item-info">
                      <img src={item.image || PLACEHOLDER_IMAGE} alt={item.name} onError={(event) => { event.currentTarget.src = PLACEHOLDER_IMAGE; }} />
                      <div>
                        <strong>{item.name}</strong>
                        <p>${item.price.toFixed(2)} / {PRODUCT_UNIT_LABELS[item.unit]} — ${(item.price * item.quantity).toFixed(2)}</p>
                      </div>
                    </div>

                    <div className="cart-item-controls">
                      {item.unit !== 'unidad' ? (
                        <div className="unit-toggle">
                          <button type="button" className={displayUnit === 'kg' ? 'active' : ''} onClick={() => setUnitModes((current) => ({ ...current, [item.id]: 'kg' }))}>kg</button>
                          <button type="button" className={displayUnit === 'g' ? 'active' : ''} onClick={() => setUnitModes((current) => ({ ...current, [item.id]: 'g' }))}>g</button>
                        </div>
                      ) : null}
                      <div className="qty-controls">
                        <button type="button" onClick={() => updateCartQuantityInUnit(item.id, displayQuantity - step, displayUnit)}>-</button>
                        <input
                          type="number"
                          min={step}
                          step={step}
                          value={displayQuantity}
                          onChange={(event) => updateCartQuantityInUnit(item.id, Number(event.target.value), displayUnit)}
                        />
                        <button type="button" onClick={() => updateCartQuantityInUnit(item.id, displayQuantity + step, displayUnit)}>+</button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {relatedProducts.length > 0 ? (
              <div className="related-products">
                <h3>También te puede interesar</h3>
                <div className="related-products-list">
                  {relatedProducts.map((product) => (
                    <div className="related-product-card" key={product.id}>
                      <img src={product.image || PLACEHOLDER_IMAGE} alt={product.name} onError={(event) => { event.currentTarget.src = PLACEHOLDER_IMAGE; }} />
                      <div>
                        <strong>{product.name}</strong>
                        <p>${product.price.toFixed(2)} / {PRODUCT_UNIT_LABELS[product.unit]}</p>
                      </div>
                      <button type="button" onClick={() => addToCart(product.id)}>+ Agregar</button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="cart-drawer-footer">
            <div className="delivery-toggle">
              <button type="button" className={!isDelivery ? 'active' : ''} onClick={() => setIsDelivery(false)}>Retiro en el local</button>
              <button type="button" className={isDelivery ? 'active' : ''} onClick={() => setIsDelivery(true)}>Envío ({storeInfo.deliveryProviderName})</button>
            </div>
            <div className="delivery-notice">
              <i className="fa-solid fa-triangle-exclamation" />
              <span>Los precios y tiempos de envío están sujetos a variación, ya que las entregas se realizan mediante {storeInfo.deliveryProviderName}.</span>
            </div>
            {belowDeliveryMinimum ? (
              <div className="delivery-notice delivery-notice-warning">
                <i className="fa-solid fa-circle-exclamation" />
                <span>Para envío el pedido mínimo es ${storeInfo.deliveryMinPurchase.toFixed(2)} — te faltan ${(storeInfo.deliveryMinPurchase - cartTotal).toFixed(2)}, o elegí retiro en el local.</span>
              </div>
            ) : null}
            <div className="cart-total">Total: $<span>{cartTotal.toFixed(2)}</span></div>
            <button className="checkout-btn" onClick={handleCheckout} disabled={cart.length === 0 || belowDeliveryMinimum}>Pedir por transferencia</button>
          </div>
          </>
          )}
        </aside>
      </div>

      <button type="button" className={`cart-fab ${cartCount > 0 ? 'has-items' : ''}`} onClick={() => setIsCartOpen(true)} aria-label="Abrir carrito">
        <i className="fa-solid fa-cart-shopping" />
        {cartCount > 0 ? (
          <>
            <span className="cart-fab-summary">
              <span className="cart-fab-count-text">{cartCount} {cartCount === 1 ? 'producto' : 'productos'}</span>
              <span className="cart-fab-total">${cartTotal.toFixed(2)}</span>
            </span>
            <i className="fa-solid fa-chevron-up cart-fab-chevron" />
          </>
        ) : null}
      </button>

      {toastMessage ? (
        <div className="toast" role="status">
          <i className="fa-solid fa-circle-check" /> {toastMessage}
        </div>
      ) : null}

      <footer>
        <div className="container">
          <p>&copy; 2026 El Pampa. Verdulería y frutería en Barrio General Paz, Córdoba Capital.</p>
          <div className="footer-links">
            <Link href="/terminos">Términos y Condiciones</Link>
            <Link href="/privacidad">Política de Privacidad</Link>
          </div>
        </div>
      </footer>
    </>
  );
}
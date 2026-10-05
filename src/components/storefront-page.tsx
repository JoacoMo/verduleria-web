'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import type { OrderConfirmation, OrderItem, Product, StoreInfo } from '@/lib/types';
import type { ProductUnit } from '@/lib/product-units';
import { PRODUCT_CART_STEP, PRODUCT_DEFAULT_CART_QUANTITY, PRODUCT_UNIT_LABELS, formatProductQuantity, normalizeProductQuantity } from '@/lib/product-units';
import { matchesSearch } from '@/lib/search';
import { formatArs } from '@/lib/format-price';
import { ORDER_CUTOFF_LABEL, isPastOrderCutoff, isStoreOpenNow } from '@/lib/store-hours';
import { PRODUCT_CATEGORIES, type ProductCategory } from '@/lib/product-categories';
import { REPLACEMENT_POLICIES, REPLACEMENT_POLICY_LABELS, type ReplacementPolicy } from '@/lib/order-options';

type CartItem = Product & { quantity: number };
type CategoryFilter = ProductCategory | 'Todas';
/** Lo mínimo que se guarda del carrito: el precio siempre sale del catálogo vigente. */
type StoredCartLine = { id: number; quantity: number };

type CustomerForm = {
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  notes: string;
  replacementPolicy: ReplacementPolicy;
};

const EMPTY_CUSTOMER: CustomerForm = {
  customerName: '',
  customerPhone: '',
  customerAddress: '',
  notes: '',
  replacementPolicy: 'replace',
};

// Claves de localStorage. El carrito sobrevive a cerrar la pestaña (en el celular
// pasa todo el tiempo) y los datos de contacto se recuerdan para el próximo pedido.
const STORAGE_KEYS = {
  cart: 'elpampa:carrito',
  lastOrder: 'elpampa:ultimo-pedido',
  customer: 'elpampa:cliente',
} as const;

function readStorage<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // Modo incógnito, storage lleno o JSON viejo roto: se arranca de cero.
    return null;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sin storage la tienda funciona igual, solo no recuerda el carrito.
  }
}

function toStoredLines(value: unknown): StoredCartLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((line) => ({ id: Number(line?.id), quantity: Number(line?.quantity) }))
    .filter((line) => Number.isInteger(line.id) && line.id > 0 && Number.isFinite(line.quantity) && line.quantity > 0);
}

/** Arma las líneas del carrito a partir del catálogo; descarta lo que ya no existe. */
function linesToCart(lines: StoredCartLine[], products: Product[]): CartItem[] {
  return lines.flatMap((line) => {
    const product = products.find((item) => item.id === line.id);
    if (!product) return [];
    return [{ ...product, quantity: normalizeProductQuantity(line.quantity, product.unit) }];
  });
}

/** Cantidad en kilos de una línea, para estimar el peso del envío. */
function lineWeightKg(item: { unit: ProductUnit; quantity: number }) {
  if (item.unit === 'kg') return item.quantity;
  if (item.unit === 'g') return item.quantity / 1000;
  return 0;
}

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
  deliveryFreeThreshold: 20000,
  instagramUrl: '',
  contactEmail: 'gastaldo50@gmail.com',
  googleReviewUrl: '',
};

type StorefrontPageProps = {
  /**
   * Productos renderizados en el servidor. Sirven de estado inicial para que el
   * HTML ya venga con la lista: si esperamos al fetch del cliente, los buscadores
   * y sobre todo los crawlers de IA (que no ejecutan JavaScript) ven la tienda vacía.
   */
  initialProducts?: Product[];
  /** Bloque "Sobre el local" + preguntas frecuentes, renderizado en el servidor. */
  infoSection?: ReactNode;
};

export default function StorefrontPage({ initialProducts = [], infoSection }: StorefrontPageProps) {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [storeInfo, setStoreInfo] = useState<StoreInfo>(DEFAULT_STORE_INFO);
  const [orderConfirmation, setOrderConfirmation] = useState<OrderConfirmation | null>(null);
  const [isDelivery, setIsDelivery] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'transfer' | 'mercadopago'>('transfer');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  // Clave del intento de compra en curso. Sobrevive a los re-render (por eso ref
  // y no state) y se renueva solo cuando el pedido se registra bien.
  const checkoutKeyRef = useRef<string | null>(null);
  const [unitModes, setUnitModes] = useState<Record<number, ProductUnit>>({});
  const [gridQuantities, setGridQuantities] = useState<Record<number, number>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('Todas');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [storeStatus, setStoreStatus] = useState<{ open: boolean; pastCutoff: boolean } | null>(null);
  // El checkout tiene dos pasos dentro del mismo panel: revisar el carrito y
  // completar los datos de contacto/entrega.
  const [checkoutStep, setCheckoutStep] = useState<'cart' | 'details'>('cart');
  const [customer, setCustomer] = useState<CustomerForm>(EMPTY_CUSTOMER);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastOrderLines, setLastOrderLines] = useState<StoredCartLine[]>([]);
  // Hasta no leer localStorage no se escribe, para no pisar el carrito guardado
  // con el carrito vacío del primer render.
  const [storageLoaded, setStorageLoaded] = useState(false);

  useEffect(() => {
    const storedCart = toStoredLines(readStorage(STORAGE_KEYS.cart));
    if (storedCart.length > 0) {
      setCart(linesToCart(storedCart, initialProducts));
    }
    setLastOrderLines(toStoredLines(readStorage(STORAGE_KEYS.lastOrder)));
    const storedCustomer = readStorage<Partial<CustomerForm>>(STORAGE_KEYS.customer);
    if (storedCustomer && typeof storedCustomer === 'object') {
      setCustomer((current) => ({
        ...current,
        customerName: typeof storedCustomer.customerName === 'string' ? storedCustomer.customerName : '',
        customerPhone: typeof storedCustomer.customerPhone === 'string' ? storedCustomer.customerPhone : '',
        customerAddress: typeof storedCustomer.customerAddress === 'string' ? storedCustomer.customerAddress : '',
      }));
    }
    setStorageLoaded(true);
    // Solo al montar: initialProducts es el catálogo que vino del servidor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!storageLoaded) return;
    writeStorage(STORAGE_KEYS.cart, cart.map(({ id, quantity }) => ({ id, quantity })));
  }, [cart, storageLoaded]);

  // Si el carrito cambia, es otra compra: la clave de idempotencia anterior ya no
  // corresponde (si no, un reintento devolvería el pedido viejo con otros ítems).
  useEffect(() => {
    checkoutKeyRef.current = null;
  }, [cart, isDelivery]);

  // El aviso de "falta tal dato" se va apenas el cliente empieza a corregir.
  useEffect(() => {
    setFormError(null);
  }, [customer, isDelivery]);

  // Cuando llega el catálogo fresco, el carrito toma precio, nombre y stock
  // vigentes. Lo que se borró del catálogo se saca.
  useEffect(() => {
    setCart((currentCart) => {
      if (currentCart.length === 0) return currentCart;
      return linesToCart(currentCart.map(({ id, quantity }) => ({ id, quantity })), products);
    });
  }, [products]);

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
  const totalWeight = useMemo(() => cart.reduce((sum, item) => sum + lineWeightKg(item), 0), [cart]);

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
    if (!isMenuOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsMenuOpen(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMenuOpen]);

  /**
   * Lleva a una sección de la página y cierra el menú.
   *
   * Se usa scrollIntoView en vez de un href="#seccion" para poder cerrar el menú
   * en el mismo gesto y no dejar el hash colgado en la URL.
   */
  function goToSection(sectionId: string) {
    setIsMenuOpen(false);

    if (sectionId === 'inicio') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // El menú se cierra con una transición; se espera un toque para que el
    // scroll no compita con ella.
    window.setTimeout(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  useEffect(() => {
    // Se refresca igual en el cliente para tomar cambios de precio recientes,
    // pero si falla nos quedamos con los productos que vinieron del servidor.
    async function fetchProducts() {
      try {
        const response = await fetch('/api/products');
        if (!response.ok) throw new Error('No se pudieron cargar los productos.');
        const freshProducts = await response.json();
        if (Array.isArray(freshProducts) && freshProducts.length > 0) {
          setProducts(freshProducts);
        }
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
  const hasFreeShipping = cartTotal >= storeInfo.deliveryFreeThreshold;
  const missingForFreeShipping = Math.max(0, storeInfo.deliveryFreeThreshold - cartTotal);
  const unavailableInCart = cart.filter((item) => !item.available);
  const hasWeighedItems = cart.some((item) => item.unit !== 'unidad');
  const whatsappDisplay = storeInfo.whatsappNumber.replace(/^549/, '');

  function addToCart(productId: number, quantityToAdd?: number) {
    const product = products.find((item) => item.id === productId);
    if (!product) return;
    // Nada sin stock entra al carrito. El servidor lo vuelve a chequear igual.
    if (!product.available) return;

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
    // No se recomienda lo que no se puede comprar.
    return products.filter((product) => !cartIds.has(product.id) && product.available).slice(0, 4);
  }, [products, cart]);

  function buildWhatsappMessage(params: {
    items: OrderItem[];
    orderId: number;
    total: number;
    isDelivery: boolean;
    isCardPayment: boolean;
    customer: CustomerForm;
  }) {
    const { items, orderId, total, isDelivery, isCardPayment, customer } = params;
    const lines = items.map((item) => (
      `- ${formatProductQuantity(item.quantity, item.unit)} ${item.name}: ${formatArs(item.price * item.quantity)}`
    )).join('\n');

    const weight = items.reduce((sum, item) => sum + lineWeightKg(item), 0);
    const maxWeight = storeInfo.deliveryMaxWeightKg;
    const deliveryText = isDelivery
      ? `Envío por ${storeInfo.deliveryProviderName} a ${customer.customerAddress.trim()}.`
      : 'Retiro en el local.';
    const deliveryWarning = isDelivery && weight > maxWeight
      ? `\n⚠️ Nota: el pedido pesa más de ${maxWeight}kg, tené en cuenta que para ${storeInfo.deliveryProviderName} el máximo suele ser ${maxWeight}-${maxWeight + 1}kg.`
      : '';
    const freeShippingNote = isDelivery && total >= storeInfo.deliveryFreeThreshold
      ? `\n🚚 El pedido supera los ${formatArs(storeInfo.deliveryFreeThreshold)}, así que el envío es gratis.`
      : '';
    const notes = customer.notes.trim() ? `\nAclaraciones: ${customer.notes.trim()}` : '';
    const closing = isCardPayment
      ? 'Lo pagué con Mercado Pago.'
      : '¡Te envío el comprobante de la transferencia!';

    const text =
      `Hola! Soy ${customer.customerName.trim()} y quiero hacer el pedido #${orderId} de ${storeInfo.storeName}.\n\n` +
      `${lines}\n\n` +
      `Total: ${formatArs(total)}\n\n` +
      `Entrega: ${deliveryText}${deliveryWarning}${freeShippingNote}\n` +
      `Si falta algo: ${REPLACEMENT_POLICY_LABELS[customer.replacementPolicy]}.${notes}\n\n` +
      closing;
    return `https://wa.me/${storeInfo.whatsappNumber}?text=${encodeURIComponent(text)}`;
  }

  /** Validación rápida en el navegador; el servidor vuelve a validar todo. */
  function validateCustomerForm() {
    if (customer.customerName.trim().length < 2) return 'Ingresá tu nombre.';
    const phoneDigits = customer.customerPhone.replace(/\D/g, '');
    if (phoneDigits.length < 8 || phoneDigits.length > 15) return 'Ingresá un teléfono válido, con código de área.';
    if (isDelivery && customer.customerAddress.trim().length < 5) return 'Para el envío necesitamos la dirección.';
    return null;
  }

  function repeatLastOrder() {
    const lines = linesToCart(lastOrderLines, products).filter((item) => item.available);
    if (lines.length === 0) {
      setToastMessage('Los productos de tu último pedido no están disponibles hoy');
      return;
    }
    setCart(lines);
    setCheckoutStep('cart');
    setIsCartOpen(true);
    const missing = lastOrderLines.length - lines.length;
    setToastMessage(missing > 0
      ? `Cargamos tu último pedido (${missing} producto${missing === 1 ? '' : 's'} sin stock hoy)`
      : 'Cargamos tu último pedido');
  }

  async function handleCheckout() {
    if (cart.length === 0) return;
    if (unavailableInCart.length > 0) return;

    const validationMessage = validateCustomerForm();
    if (validationMessage) {
      setFormError(validationMessage);
      return;
    }
    setFormError(null);
    // Primera barrera contra el doble toque: mientras hay un pedido en curso no
    // se dispara otro. La segunda barrera (la que realmente garantiza que no se
    // dupliquen) es la clave de idempotencia que valida el servidor.
    if (isCheckoutLoading) return;

    // La clave se mantiene entre reintentos del MISMO intento de compra y se
    // renueva recién cuando el pedido sale bien. Así, si el cliente toca dos
    // veces o se le corta la conexión y reintenta, el servidor reconoce que es
    // el mismo pedido y no crea uno nuevo.
    if (!checkoutKeyRef.current) {
      checkoutKeyRef.current = crypto.randomUUID();
    }

    setIsCheckoutLoading(true);

    // Se abre una pestaña en blanco de forma síncrona (dentro del gesto del click)
    // para evitar que el navegador bloquee el popup al redirigirla después del fetch.
    // Con tarjeta redirigimos la pestaña actual a Mercado Pago, así que no hace falta.
    const isCardPayment = paymentMethod === 'mercadopago';
    const waTab = isCardPayment ? null : window.open('', '_blank');

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cart: cart.map((item) => ({ id: item.id, quantity: item.quantity })),
          isDelivery,
          paymentMethod,
          idempotencyKey: checkoutKeyRef.current,
          customer,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        waTab?.close();
        setFormError(result.error || 'Hubo un problema al procesar el pedido.');
        return;
      }

      // El pedido quedó registrado: el próximo checkout es una compra distinta y
      // necesita una clave nueva.
      checkoutKeyRef.current = null;

      // Ítems como los calculó el servidor (precio vigente). Si por algún motivo
      // no vienen (respuesta vieja), se usa el carrito.
      const items: OrderItem[] = Array.isArray(result.items) && result.items.length > 0
        ? result.items
        : cart.map(({ id, name, price, quantity, unit }) => ({ id, name, price, quantity, unit }));

      // Para "repetir último pedido" y para no volver a tipear los datos.
      const orderLines = items.map(({ id, quantity }) => ({ id, quantity }));
      writeStorage(STORAGE_KEYS.lastOrder, orderLines);
      setLastOrderLines(orderLines);
      writeStorage(STORAGE_KEYS.customer, {
        customerName: customer.customerName,
        customerPhone: customer.customerPhone,
        customerAddress: customer.customerAddress,
      });
      setCustomer((current) => ({ ...current, notes: '' }));

      // Pago con tarjeta: el cliente sigue en Mercado Pago y vuelve por back_urls.
      if (isCardPayment) {
        if (result.checkoutUrl) {
          setCart([]);
          setCheckoutStep('cart');
          window.location.href = result.checkoutUrl;
          return;
        }
        alert('No pudimos generar el link de pago. Podés pagar por transferencia.');
      }

      const waLink = buildWhatsappMessage({
        items,
        orderId: result.orderId,
        total: result.total,
        isDelivery,
        isCardPayment: false,
        customer,
      });
      setOrderConfirmation({ ...storeInfo, ...result, items, whatsappUrl: waLink });
      setCheckoutStep('cart');

      if (waTab) {
        waTab.location.href = waLink;
      } else if (!isCardPayment) {
        window.open(waLink, '_blank', 'noopener,noreferrer');
      }

      setCart([]);
    } catch (error) {
      waTab?.close();
      console.error('Error en el checkout:', error);
      // La clave NO se limpia acá a propósito: si el cliente reintenta, se manda
      // la misma y el servidor devuelve el pedido que quizás sí llegó a crearse.
      alert('No se pudo registrar el pedido. Inténtalo de nuevo.');
    } finally {
      setIsCheckoutLoading(false);
    }
  }

  return (
    <>
      {/* El nav va FUERA del <header> a propósito: position:sticky solo funciona
          dentro del contenedor del elemento, y el header es position:relative, así
          que al pasarlo la barra se iba con él. Como hermano del header, su
          contenedor es el body y queda fija en toda la página. */}
      <nav className="app-nav" aria-label="Menú principal">
          <div className="container app-nav-inner">
            <button
              type="button"
              className={`menu-toggle ${isMenuOpen ? 'open' : ''}`}
              onClick={() => setIsMenuOpen((open) => !open)}
              aria-expanded={isMenuOpen}
              aria-controls="menu-principal"
              aria-label={isMenuOpen ? 'Cerrar menú' : 'Abrir menú'}
            >
              {/* Tres barras que se transforman en una X al abrir. */}
              <span className="menu-bar" />
              <span className="menu-bar" />
              <span className="menu-bar" />
            </button>
            <span className="app-nav-title">El Pampa</span>
          </div>

          <div id="menu-principal" className={`app-menu ${isMenuOpen ? 'open' : ''}`}>
            <div className="container app-menu-items">
              <button type="button" onClick={() => goToSection('inicio')}>
                <i className="fa-solid fa-house" /> Inicio
              </button>
              <button type="button" onClick={() => goToSection('productos')}>
                <i className="fa-solid fa-carrot" /> Productos
              </button>
              <button type="button" onClick={() => goToSection('ubicacion')}>
                <i className="fa-solid fa-location-dot" /> Ubicación
              </button>
              <button type="button" onClick={() => goToSection('informacion')}>
                <i className="fa-solid fa-circle-info" /> Información
              </button>
              <a
                href={`https://wa.me/${storeInfo.whatsappNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setIsMenuOpen(false)}
              >
                <i className="fa-brands fa-whatsapp" /> WhatsApp
              </a>
              {storeInfo.instagramUrl ? (
                <a
                  href={storeInfo.instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setIsMenuOpen(false)}
                >
                  <i className="fa-brands fa-instagram" /> Instagram
                </a>
              ) : null}
            </div>
          </div>
      </nav>

      <header>
        <div className="container">
          <div className="hero-text">
            <h1><i className="fa-solid fa-carrot" />El Pampa</h1>
            <svg className="hero-underline" viewBox="0 0 260 14" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 9 C 40 2, 80 13, 120 7 S 200 1, 258 8" stroke="#C98A3E" strokeWidth="3" fill="none" strokeLinecap="round" />
            </svg>
            <p className="hero-tagline">Verdulería y frutería en Barrio General Paz, Córdoba Capital. Pedí por kilo, gramos o unidad y coordinamos retiro o envío.</p>
            <p className="hero-shipping-badge">
              <i className="fa-solid fa-truck-fast" /> Envío gratis en pedidos desde {formatArs(storeInfo.deliveryFreeThreshold)}
            </p>
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
        {/* Las "reglas del juego" a la vista antes de armar el carrito: es lo primero
            que muestran las verdulerías online que mejor venden en Córdoba. */}
        <ul className="store-rules" aria-label="Condiciones de compra">
          <li><i className="fa-solid fa-store" /> <span><strong>Retiro gratis</strong> en el local</span></li>
          <li><i className="fa-solid fa-motorcycle" /> <span>Envío con pedido mínimo de <strong>{formatArs(storeInfo.deliveryMinPurchase)}</strong></span></li>
          <li><i className="fa-solid fa-truck-fast" /> <span><strong>Envío gratis</strong> desde {formatArs(storeInfo.deliveryFreeThreshold)}</span></li>
          <li><i className="fa-solid fa-clock" /> <span>Pedidos hasta las <strong>{ORDER_CUTOFF_LABEL}</strong> salen en el día</span></li>
          <li>
            <i className="fa-solid fa-wallet" />{' '}
            <span>Pagás por <strong>transferencia</strong>{storeInfo.mercadoPagoEnabled ? <> o <strong>Mercado Pago</strong></> : null}</span>
          </li>
        </ul>

        <h2 id="productos"><i className="fa-solid fa-leaf" /> Nuestros Productos</h2>
        <p className="section-subtitle">Productos por kilo, gramos o unidad, listos para pedir online.</p>

        {lastOrderLines.length > 0 && cart.length === 0 ? (
          <button type="button" className="repeat-order-btn" onClick={repeatLastOrder}>
            <i className="fa-solid fa-rotate-right" /> Repetir mi último pedido
          </button>
        ) : null}

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
                <div className={`product-card ${product.available ? '' : 'product-card-unavailable'}`} key={product.id}>
                  <div className="product-card-image">
                    <img src={product.image || PLACEHOLDER_IMAGE} alt={product.name} onError={(event) => { event.currentTarget.src = PLACEHOLDER_IMAGE; }} />
                    <span className="price-tag">{formatArs(product.price)} / {PRODUCT_UNIT_LABELS[product.unit]}</span>
                    {product.available ? null : <span className="unavailable-overlay">Sin stock</span>}
                  </div>
                  <div className="product-info">
                    <h3>{product.name}</h3>
                    {product.available ? (
                      <p className="availability-note available">
                        <span className="status-dot" aria-hidden="true" />
                        Disponible
                      </p>
                    ) : (
                      <p className="availability-note unavailable">
                        <span className="status-dot" aria-hidden="true" />
                        No disponible por ahora
                      </p>
                    )}
                    <p className="stock-note">Se vende por {PRODUCT_UNIT_LABELS[product.unit]}</p>
                    {product.available ? (
                      <>
                        <div className="grid-qty-controls">
                          <button type="button" disabled={selectedQuantity <= step} onClick={() => adjustGridSelection(product.id, -1)} aria-label={`Restar cantidad de ${product.name}`}>-</button>
                          <span>{formatProductQuantity(selectedQuantity, product.unit)}</span>
                          <button type="button" onClick={() => adjustGridSelection(product.id, 1)} aria-label={`Sumar cantidad de ${product.name}`}>+</button>
                        </div>
                        <button className="add-to-cart-btn" onClick={() => addSelectedToCart(product.id)}>
                          <i className="fa-solid fa-cart-plus" /> Añadir al carrito
                        </button>
                      </>
                    ) : (
                      <button className="add-to-cart-btn" disabled>
                        Sin stock por ahora
                      </button>
                    )}
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

        <section className="contact-section" id="ubicacion">
          <div className="contact-heading">
            <h2 style={{ marginTop: 0 }}><i className="fa-solid fa-store" /> Dónde estamos</h2>
            {storeStatus ? (
              <span className={`store-status-badge ${storeStatus.open ? 'open' : 'closed'}`}>
                <span className="status-dot" aria-hidden="true" />
                {storeStatus.open ? 'Abierto ahora' : 'Cerrado ahora'}
              </span>
            ) : null}
          </div>
          <div className="contact-info">
            <p>
              <i className="fa-solid fa-location-dot" />{' '}
              <a href={MAP_DIRECTIONS_URL} target="_blank" rel="noopener noreferrer">{storeInfo.storeAddress}</a>
            </p>
            <p><i className="fa-brands fa-whatsapp" /> <a href={`https://wa.me/${storeInfo.whatsappNumber}`} target="_blank" rel="noopener noreferrer">WhatsApp: {whatsappDisplay}</a></p>
            <p><i className="fa-solid fa-envelope" /> <a href={`mailto:${storeInfo.contactEmail}`}>{storeInfo.contactEmail}</a></p>
            <p><i className="fa-solid fa-clock" /> {storeInfo.storeHours.weekday}</p>
            <p><i className="fa-solid fa-clock" /> {storeInfo.storeHours.sunday}</p>
            <p className="order-cutoff-note">
              <i className="fa-solid fa-triangle-exclamation" />{' '}
              {storeStatus?.pastCutoff
                ? `Ya pasaron las ${ORDER_CUTOFF_LABEL}, así que los pedidos de hoy se toman en cuenta recién mañana.`
                : `Los pedidos hechos después de las ${ORDER_CUTOFF_LABEL} se toman en cuenta a partir del día siguiente.`}
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

        {infoSection}
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
                <p>Transferí <strong>{formatArs(orderConfirmation.total)}</strong> a:</p>
                <ul className="transfer-details">
                  <li><strong>Alias:</strong> {orderConfirmation.transferAlias}</li>
                  {orderConfirmation.transferCbu ? <li><strong>CBU:</strong> {orderConfirmation.transferCbu}</li> : null}
                </ul>
                <p>Ya te abrimos WhatsApp con el detalle del pedido. Cuando hagas la transferencia, mandanos el comprobante por ahí.</p>
                <a className="whatsapp-btn" href={orderConfirmation.whatsappUrl} target="_blank" rel="noopener noreferrer">
                  <i className="fa-brands fa-whatsapp" /> Reenviar pedido por WhatsApp
                </a>
                {storeInfo.googleReviewUrl ? (
                  <p className="review-ask">
                    ¿Te gustó cómo te atendimos?{' '}
                    <a href={storeInfo.googleReviewUrl} target="_blank" rel="noopener noreferrer">Dejanos una reseña en Google</a>
                    {' '}— nos ayuda un montón a que nos encuentren otros vecinos.
                  </p>
                ) : null}
                <button type="button" className="continue-shopping-btn" onClick={() => { setOrderConfirmation(null); setIsCartOpen(false); }}>
                  ¿Querés hacer otro pedido? Seguir comprando
                </button>
              </div>
            </div>
          ) : (
          <>
          <div className="cart-drawer-body">
            {checkoutStep === 'details' && cart.length > 0 ? (
              <form
                className="checkout-form"
                id="checkout-form"
                onSubmit={(event) => { event.preventDefault(); void handleCheckout(); }}
                noValidate
              >
                <button type="button" className="checkout-back-btn" onClick={() => { setCheckoutStep('cart'); setFormError(null); }}>
                  <i className="fa-solid fa-arrow-left" /> Volver al carrito
                </button>
                <h3>Tus datos</h3>
                <p className="checkout-form-hint">Los usamos solo para coordinar este pedido.</p>
                <div className="form-group">
                  <label htmlFor="checkout-name">Nombre</label>
                  <input
                    id="checkout-name"
                    type="text"
                    autoComplete="name"
                    maxLength={80}
                    required
                    value={customer.customerName}
                    onChange={(event) => setCustomer((current) => ({ ...current, customerName: event.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="checkout-phone">Teléfono / WhatsApp</label>
                  <input
                    id="checkout-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="351 1234567"
                    maxLength={40}
                    required
                    value={customer.customerPhone}
                    onChange={(event) => setCustomer((current) => ({ ...current, customerPhone: event.target.value }))}
                  />
                </div>
                {isDelivery ? (
                  <div className="form-group">
                    <label htmlFor="checkout-address">Dirección de entrega</label>
                    <input
                      id="checkout-address"
                      type="text"
                      autoComplete="street-address"
                      placeholder="Calle, número, depto y barrio"
                      maxLength={200}
                      required
                      value={customer.customerAddress}
                      onChange={(event) => setCustomer((current) => ({ ...current, customerAddress: event.target.value }))}
                    />
                  </div>
                ) : null}
                <div className="form-group">
                  <label htmlFor="checkout-replacement">Si algo falta o no está lindo</label>
                  <select
                    id="checkout-replacement"
                    value={customer.replacementPolicy}
                    onChange={(event) => setCustomer((current) => ({ ...current, replacementPolicy: event.target.value as ReplacementPolicy }))}
                  >
                    {REPLACEMENT_POLICIES.map((policy) => (
                      <option key={policy} value={policy}>{REPLACEMENT_POLICY_LABELS[policy]}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="checkout-notes">Aclaraciones (opcional)</label>
                  <textarea
                    id="checkout-notes"
                    rows={3}
                    maxLength={500}
                    placeholder="Ej: tomates para ensalada, no muy maduros. Timbre 2B."
                    value={customer.notes}
                    onChange={(event) => setCustomer((current) => ({ ...current, notes: event.target.value }))}
                  />
                </div>
              </form>
            ) : cart.length === 0 ? (
              <>
                <p>Tu carrito está vacío.</p>
                {lastOrderLines.length > 0 ? (
                  <button type="button" className="repeat-order-btn" onClick={repeatLastOrder}>
                    <i className="fa-solid fa-rotate-right" /> Repetir mi último pedido
                  </button>
                ) : null}
              </>
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
                        <p>{formatArs(item.price)} / {PRODUCT_UNIT_LABELS[item.unit]} — {formatArs(item.price * item.quantity)}</p>
                        {item.available ? null : <p className="cart-item-unavailable">Se quedó sin stock: sacalo para seguir.</p>}
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

            {checkoutStep === 'cart' && hasWeighedItems ? (
              <p className="weight-disclaimer">
                <i className="fa-solid fa-scale-balanced" /> En lo que va por peso el total es aproximado: al pesar puede variar unos gramos.
              </p>
            ) : null}

            {checkoutStep === 'cart' && relatedProducts.length > 0 ? (
              <div className="related-products">
                <h3>También te puede interesar</h3>
                <div className="related-products-list">
                  {relatedProducts.map((product) => (
                    <div className="related-product-card" key={product.id}>
                      <img src={product.image || PLACEHOLDER_IMAGE} alt={product.name} onError={(event) => { event.currentTarget.src = PLACEHOLDER_IMAGE; }} />
                      <div>
                        <strong>{product.name}</strong>
                        <p>{formatArs(product.price)} / {PRODUCT_UNIT_LABELS[product.unit]}</p>
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
                <span>Para envío el pedido mínimo es {formatArs(storeInfo.deliveryMinPurchase)} — te faltan {formatArs(storeInfo.deliveryMinPurchase - cartTotal)}, o elegí retiro en el local.</span>
              </div>
            ) : null}
            {isDelivery && !belowDeliveryMinimum ? (
              hasFreeShipping ? (
                <div className="delivery-notice delivery-notice-free">
                  <i className="fa-solid fa-truck-fast" />
                  <span>¡Tenés envío gratis! Tu pedido supera los {formatArs(storeInfo.deliveryFreeThreshold)}.</span>
                </div>
              ) : (
                <div className="delivery-notice">
                  <i className="fa-solid fa-truck" />
                  <span>Sumá {formatArs(missingForFreeShipping)} más y el envío te sale gratis (desde {formatArs(storeInfo.deliveryFreeThreshold)}).</span>
                </div>
              )
            ) : null}
            {isDelivery && totalWeight > storeInfo.deliveryMaxWeightKg ? (
              <div className="delivery-notice">
                <i className="fa-solid fa-weight-hanging" />
                <span>Tu pedido pesa unos {totalWeight.toFixed(1)} kg. Para {storeInfo.deliveryProviderName} el máximo suele ser {storeInfo.deliveryMaxWeightKg} kg: puede que haya que dividirlo en dos viajes.</span>
              </div>
            ) : null}
            {unavailableInCart.length > 0 ? (
              <div className="delivery-notice delivery-notice-warning">
                <i className="fa-solid fa-circle-exclamation" />
                <span>Sin stock: {unavailableInCart.map((item) => item.name).join(', ')}. Sacalos del carrito para seguir.</span>
              </div>
            ) : null}
            {checkoutStep === 'details' && storeInfo.mercadoPagoEnabled ? (
              <div className="payment-toggle">
                <button type="button" className={paymentMethod === 'transfer' ? 'active' : ''} onClick={() => setPaymentMethod('transfer')}>
                  <i className="fa-solid fa-building-columns" /> Transferencia
                </button>
                <button type="button" className={paymentMethod === 'mercadopago' ? 'active' : ''} onClick={() => setPaymentMethod('mercadopago')}>
                  <i className="fa-solid fa-credit-card" /> Tarjeta / Mercado Pago
                </button>
              </div>
            ) : null}
            {formError ? (
              <div className="delivery-notice delivery-notice-warning" role="alert">
                <i className="fa-solid fa-circle-exclamation" />
                <span>{formError}</span>
              </div>
            ) : null}
            <div className="cart-total">Total{hasWeighedItems ? ' aprox.' : ''}: <span>{formatArs(cartTotal)}</span></div>
            {checkoutStep === 'cart' ? (
              <button
                type="button"
                className="checkout-btn"
                onClick={() => setCheckoutStep('details')}
                disabled={cart.length === 0 || belowDeliveryMinimum || unavailableInCart.length > 0}
              >
                Continuar
              </button>
            ) : (
              <button
                type="submit"
                form="checkout-form"
                className="checkout-btn"
                disabled={cart.length === 0 || belowDeliveryMinimum || unavailableInCart.length > 0 || isCheckoutLoading}
              >
                {isCheckoutLoading
                  ? 'Procesando...'
                  : paymentMethod === 'mercadopago' ? 'Pagar con Mercado Pago' : 'Pedir por transferencia'}
              </button>
            )}
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
              <span className="cart-fab-total">{formatArs(cartTotal)}</span>
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
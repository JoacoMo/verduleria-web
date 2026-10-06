'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { Leaf, RotateCw } from 'lucide-react';
import { computeTotals } from '@/lib/pricing';
import { PRODUCT_CATEGORIES, type CategoryFilter } from '@/lib/product-categories';
import {
  PRODUCT_CART_STEP,
  PRODUCT_DEFAULT_CART_QUANTITY,
  PRODUCT_MAX_CART_QUANTITY,
  isWeightUnit,
  lineWeightKg,
  normalizeProductQuantity,
  type ProductUnit,
} from '@/lib/product-units';
import { matchesSearch } from '@/lib/search';
import { describePickupReady, isStoreOpenNow } from '@/lib/store-hours';
import type { CheckoutResponse, OrderItem, Product, StoreInfo } from '@/lib/types';
import { buildWhatsappUrl } from '@/lib/whatsapp';
import BolsonesSection from './storefront/bolsones-section';
import type { CartDrawerProps } from './storefront/cart-drawer';
import CartDrawerUnavailable from './storefront/cart-drawer-unavailable';
import CartFab from './storefront/cart-fab';
import CatalogFilters from './storefront/catalog-filters';
import { applyPriceChanges, markUnavailable } from './storefront/catalog-updates';
import type { CheckoutOutcome } from './storefront/checkout-api';
import { focusCheckoutField } from './storefront/checkout-focus';
import ContactSection from './storefront/contact-section';
import { pluralize } from './storefront/format';
import Hero, { type StorefrontHeading } from './storefront/hero';
import type { buildOrderWhatsappUrl } from './storefront/order-message';
import ProductGrid from './storefront/product-grid';
import SiteFooter from './storefront/site-footer';
import SiteNav from './storefront/site-nav';
import StoreRules from './storefront/store-rules';
import { Toast, useToast } from './storefront/toast';
import { useCart } from './storefront/use-cart';
import { useCheckoutForm } from './storefront/use-checkout-form';
import { correctedNow, useClientClock } from './storefront/use-client-clock';
import { useDeliverySlots } from './storefront/use-delivery-slots';
import { useProductPricing } from './storefront/use-product-pricing';
import type { CheckoutNotice, CheckoutStep, OrderConfirmationData, ProductPriceView } from './storefront/types';

export type StorefrontPageProps = {
  /**
   * Productos renderizados en el servidor. Son el catálogo de la tienda: el HTML
   * ya viene con la lista (los buscadores y los crawlers de IA no ejecutan
   * JavaScript) y el navegador no vuelve a pedirla.
   */
  initialProducts: Product[];
  /** Datos públicos del local (getPublicStoreInfo()). */
  storeInfo: StoreInfo;
  /** Filtro preseleccionado en las páginas de categoría (/frutas, /bolsones, /ofertas...). */
  initialCategory?: CategoryFilter;
  /** h1 y bajada propios de la página; sin esto, los de la home. */
  heading?: StorefrontHeading;
  /** Contenido de servidor que va después del catálogo (sobre el local, preguntas frecuentes). */
  infoSection?: ReactNode;
  /**
   * Hora (ms) con la que el servidor armó la página. El primer render del
   * navegador usa esta misma hora, así el HTML coincide aunque el reloj del
   * celular esté corrido (si no, React tira el error #418 y vuelve a dibujar
   * todo), y sirve para corregir ese reloj (useClientClock).
   */
  renderedAt?: number;
};

const INITIAL_VISIBLE_PRODUCTS = 8;
const RELATED_LIMIT = 4;
const CATEGORY_FILTERS: CategoryFilter[] = ['Todas', ...PRODUCT_CATEGORIES];

function matchesCategory(product: Product, category: CategoryFilter, price: ProductPriceView | undefined) {
  if (category === 'Todas') return true;
  // "Ofertas" es la categoría vieja más cualquier producto con oferta vigente.
  if (category === 'Ofertas') return product.category === 'Ofertas' || Boolean(price?.onOffer);
  return product.category === category;
}

/**
 * Abre la pestaña de WhatsApp en blanco, dentro del gesto del toque: si se
 * abriera después del fetch, el navegador la bloquearía como popup. Se le corta
 * el acceso a esta pestaña (opener) antes de mandarla a wa.me.
 */
function openBlankTab() {
  try {
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    return tab;
  } catch {
    return null;
  }
}

/**
 * El carrito y el checkout van en un chunk aparte (cart-drawer-chunk.ts): son
 * casi la mitad del JS propio de la página y no se usan hasta abrir el carrito.
 * Se precargan con el primer producto agregado o al acercarse al botón.
 *
 * Si el chunk no se puede bajar (sin señal, o una versión nueva de la tienda
 * borró el archivo de la anterior), en vez de romper la página se muestra un
 * aviso para recargar: el carrito está guardado en el navegador.
 */
const loadCartChunk = () => import('./storefront/cart-drawer-chunk');

const CartDrawer = dynamic<CartDrawerProps>(
  () => import('./storefront/cart-drawer-chunk').catch((error: unknown) => {
    console.error('No se pudo cargar el carrito:', error);
    return { default: CartDrawerUnavailable };
  }),
  { ssr: false },
);

const CONTACT_MESSAGE = '¡Hola! Quise hacer un pedido por la web y no me dejó confirmarlo.';

const NETWORK_ERROR_MESSAGE = 'Parece que se cortó la conexión. Revisá la señal y tocá «Confirmar pedido» de nuevo: si el pedido ya había llegado, no se duplica.';
const SERVER_ERROR_MESSAGE = 'Tuvimos un problema al registrar el pedido. Probá de nuevo en un ratito o escribinos por WhatsApp.';

/**
 * Tienda pública. Este componente solo orquesta: el estado vive en hooks
 * (carrito, formulario, turnos) y la interfaz en los componentes de
 * src/components/storefront/.
 */
export default function StorefrontPage({
  initialProducts,
  storeInfo,
  initialCategory = 'Todas',
  heading,
  infoSection,
  renderedAt,
}: StorefrontPageProps) {
  // Catálogo en memoria: arranca con lo que vino del servidor y solo cambia si el
  // checkout avisa que cambió un precio o que algo se quedó sin stock.
  const [products, setProducts] = useState<Product[]>(initialProducts);

  // La hora para las ofertas: en el primer render, la del servidor (renderedAt),
  // así el navegador dibuja exactamente el mismo HTML aunque su reloj esté mal;
  // ya montado, la del reloj del cliente (corregido si estaba corrido), que se
  // actualiza cada minuto.
  const clientNow = useClientClock(renderedAt);
  const [renderNow] = useState(() => new Date(renderedAt ?? Date.now()));
  const now = clientNow ?? renderNow;

  const pricing = useProductPricing(products, now);
  const cart = useCart(products, now);
  const slots = useDeliverySlots(clientNow);
  const form = useCheckoutForm({ hasSelectedSlot: slots.selectedSlot !== null });
  const { toast, showToast } = useToast();

  const [isCartOpen, setIsCartOpen] = useState(false);
  // El panel se monta (cerrado) cuando su chunk ya está, o al abrirlo.
  const [drawerRequested, setDrawerRequested] = useState(false);
  const cartChunkRequestedRef = useRef(false);
  const [checkoutStep, setCheckoutStep] = useState<CheckoutStep>('cart');
  const [searchQuery, setSearchQuery] = useState('');
  // El filtrado usa el valor diferido: en un celular lento escribir en el
  // buscador no se traba mientras se redibuja la grilla.
  const deferredQuery = useDeferredValue(searchQuery);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>(initialCategory);
  const [gridQuantities, setGridQuantities] = useState<Record<number, number>>({});
  const [confirmation, setConfirmation] = useState<OrderConfirmationData | null>(null);
  const [notice, setNotice] = useState<CheckoutNotice | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Primera barrera contra el doble toque (el estado tarda un render en verse).
  // La que de verdad evita pedidos duplicados es la clave de idempotencia.
  const submittingRef = useRef(false);
  // Clave del intento de compra en curso. Sobrevive a los re-render (por eso ref
  // y no state) y se renueva cuando cambia el carrito o se registra el pedido.
  const checkoutKeyRef = useRef<string | null>(null);

  const { items, lines } = cart;
  const { deliveryMethod, isDelivery } = form;

  // Si el carrito o la forma de entrega cambian, es otra compra: la clave
  // anterior ya no corresponde (si no, un reintento devolvería el pedido viejo).
  useEffect(() => {
    checkoutKeyRef.current = null;
  }, [lines, deliveryMethod]);

  // Un aviso del checkout deja de tener sentido apenas el cliente toca el carrito.
  useEffect(() => {
    setNotice(null);
  }, [lines, deliveryMethod]);

  // Si se vació el carrito estando en "Tus datos", se vuelve al primer paso.
  useEffect(() => {
    if (items.length === 0 && cart.storageLoaded) setCheckoutStep('cart');
  }, [items.length, cart.storageLoaded]);

  const totals = useMemo(
    () => computeTotals(items.map((item) => ({ price: item.unitPrice, quantity: item.quantity })), isDelivery, storeInfo),
    [items, isDelivery, storeInfo],
  );
  const hasWeightItems = useMemo(() => items.some((item) => isWeightUnit(item.unit)), [items]);
  const totalWeightKg = useMemo(() => items.reduce((sum, item) => sum + lineWeightKg(item), 0), [items]);

  const storeStatus = useMemo(
    () => (clientNow ? { open: isStoreOpenNow(clientNow), pickupReady: describePickupReady(clientNow) } : null),
    [clientNow],
  );

  const imagesById = useMemo(() => new Map(products.map((product) => [product.id, product.image])), [products]);

  // ---- Catálogo: bolsones, filtros y búsqueda ----

  const query = deferredQuery.trim();
  const isSearching = query.length > 0;
  const bolsones = useMemo(() => products.filter((product) => product.category === 'Bolsones'), [products]);
  const showBolsonesSection = bolsones.length > 0 && activeCategory === 'Todas' && !isSearching;

  // Solo se muestran los filtros que tienen algo (más "Todas" y el elegido).
  const visibleCategories = useMemo(() => CATEGORY_FILTERS.filter((category) => (
    category === 'Todas'
    || category === activeCategory
    || products.some((product) => matchesCategory(product, category, pricing.get(product.id)))
  )), [products, pricing, activeCategory]);

  const filteredProducts = useMemo(() => products.filter((product) => {
    // Con la sección de bolsones a la vista, no se repiten en la grilla.
    if (showBolsonesSection && product.category === 'Bolsones') return false;
    if (!matchesCategory(product, activeCategory, pricing.get(product.id))) return false;
    if (!query) return true;
    return matchesSearch(product.name, query) || (product.description ? matchesSearch(product.description, query) : false);
  }), [products, pricing, activeCategory, query, showBolsonesSection]);

  // Se dibujan todos (el HTML trae el catálogo completo); los que pasan del
  // límite van plegados hasta "Ver todos los productos".
  const collapseAfter = isSearching || showAllProducts ? null : INITIAL_VISIBLE_PRODUCTS;
  const hasMoreProducts = !isSearching && !showAllProducts && filteredProducts.length > INITIAL_VISIBLE_PRODUCTS;

  // ---- Sugerencias del carrito ----

  const cartIds = useMemo(() => new Set(lines.map((line) => line.id)), [lines]);
  const hasBolsonInCart = items.some((item) => item.category === 'Bolsones');

  const suggestedBolson = useMemo(() => {
    if (items.length === 0 || hasBolsonInCart) return null;
    return bolsones.find((product) => product.available && !cartIds.has(product.id)) ?? null;
  }, [items.length, hasBolsonInCart, bolsones, cartIds]);

  // Primero bolsones, después ofertas, después el resto (sort es estable).
  const relatedProducts = useMemo(() => {
    if (items.length === 0) return [];
    const rank = (product: Product) => {
      if (product.category === 'Bolsones') return 0;
      return pricing.get(product.id)?.onOffer ? 1 : 2;
    };
    return products
      .filter((product) => product.available && !cartIds.has(product.id) && product.id !== suggestedBolson?.id)
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, RELATED_LIMIT);
  }, [items.length, products, pricing, cartIds, suggestedBolson]);

  // ---- Acciones (estables: bajan a tarjetas memorizadas) ----

  /** Baja el chunk del carrito (una vez) y, cuando está, monta el panel cerrado. */
  const preloadCart = useCallback(() => {
    if (cartChunkRequestedRef.current) return;
    cartChunkRequestedRef.current = true;
    loadCartChunk().then(
      () => setDrawerRequested(true),
      () => {
        // Se reintenta en el próximo gesto; si al abrir sigue fallando, el
        // panel muestra el aviso para recargar.
        cartChunkRequestedRef.current = false;
      },
    );
  }, []);

  // Con el primer producto en el carrito (o un carrito guardado) se precarga,
  // sin competir con la carga de la página.
  const hasItems = items.length > 0;
  useEffect(() => {
    if (!hasItems) return;
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(preloadCart, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(preloadCart, 200);
    return () => window.clearTimeout(id);
  }, [hasItems, preloadCart]);

  const openCart = useCallback(() => {
    setDrawerRequested(true);
    setIsCartOpen(true);
  }, []);
  const closeCart = useCallback(() => setIsCartOpen(false), []);

  const handleAdjustGrid = useCallback((productId: number, unit: ProductUnit, direction: 1 | -1) => {
    const step = PRODUCT_CART_STEP[unit];
    setGridQuantities((current) => {
      const currentQuantity = current[productId] ?? PRODUCT_DEFAULT_CART_QUANTITY[unit];
      const next = normalizeProductQuantity(currentQuantity + direction * step, unit);
      if (next < step || next > PRODUCT_MAX_CART_QUANTITY[unit]) return current;
      return { ...current, [productId]: next };
    });
  }, []);

  const { addToCart } = cart;
  const handleAdd = useCallback((product: Product, quantity?: number) => {
    if (!addToCart(product, quantity)) return;
    // Si quedaba a la vista la confirmación del pedido anterior, esto ya es otra
    // compra: al abrir el carrito tiene que verse el carrito, no el pedido viejo.
    setConfirmation(null);
    showToast(`${product.name} agregado al carrito`);
  }, [addToCart, showToast]);

  const handleAddSuggestion = useCallback((product: Product) => handleAdd(product), [handleAdd]);

  const handleCategoryChange = useCallback((category: CategoryFilter) => {
    setActiveCategory(category);
    setShowAllProducts(false);
  }, []);

  function handleRepeatLastOrder() {
    const result = cart.repeatLastOrder();
    if (result.loaded === 0) {
      showToast('Los productos de tu último pedido no están disponibles hoy');
      return;
    }
    setConfirmation(null);
    setCheckoutStep('cart');
    setDrawerRequested(true);
    setIsCartOpen(true);
    showToast(result.missing > 0
      ? `Cargamos tu último pedido (${result.missing} ${pluralize(result.missing, 'producto', 'productos')} sin stock hoy)`
      : 'Cargamos tu último pedido');
  }

  function handleFinishConfirmation() {
    setConfirmation(null);
    setIsCartOpen(false);
  }

  // ---- Checkout ----

  function handleCheckoutFailure(outcome: Exclude<CheckoutOutcome, { kind: 'ok' }>) {
    switch (outcome.kind) {
      case 'price-changed':
        // Solo llega si algo SUBIÓ (si bajó, el pedido se crea con el precio menor).
        // El carrito toma el precio del catálogo, así que con actualizar el
        // catálogo ya se ve el total nuevo. No se registró nada: confirma de nuevo.
        setProducts((current) => applyPriceChanges(current, outcome.changes, correctedNow()));
        setNotice({ kind: 'price-changed', changes: outcome.changes });
        break;
      case 'unavailable':
        setProducts((current) => markUnavailable(current, outcome.ids));
        setNotice({ kind: 'unavailable', ids: outcome.ids });
        break;
      case 'slot':
        slots.replaceWithServerSlots(outcome.availableSlots);
        setNotice({ kind: 'slot' });
        window.requestAnimationFrame(() => focusCheckoutField('deliverySlot'));
        break;
      case 'rate-limited':
      case 'busy':
        // Topes contra el spam (muchos intentos, muchos pedidos con el mismo
        // teléfono o demasiados pedidos en la última hora): el mensaje del
        // servidor y WhatsApp a mano, para no perder un pedido de verdad.
        setNotice({
          kind: 'error',
          message: outcome.message,
          contactUrl: buildWhatsappUrl(storeInfo.whatsappNumber, CONTACT_MESSAGE),
        });
        break;
      case 'invalid':
        setNotice({ kind: 'error', message: outcome.message });
        break;
      case 'network':
        // La clave NO se limpia: al reintentar se manda la misma y, si el pedido
        // llegó a crearse, el servidor devuelve ese en vez de crear otro.
        setNotice({ kind: 'error', message: NETWORK_ERROR_MESSAGE });
        break;
      case 'server-error':
        setNotice({ kind: 'error', message: SERVER_ERROR_MESSAGE });
        break;
    }
  }

  function handleCheckoutSuccess(
    order: CheckoutResponse,
    waTab: Window | null,
    buildWhatsappLink: typeof buildOrderWhatsappUrl,
  ) {
    // El pedido quedó registrado: el próximo checkout es otra compra.
    checkoutKeyRef.current = null;

    // Ítems como los calculó el servidor. Si por algún motivo no vienen, el carrito.
    const orderItems: OrderItem[] = order.items.length > 0
      ? order.items
      : items.map(({ id, name, unitPrice, quantity, unit }) => ({ id, name, price: unitPrice, quantity, unit }));
    const finalOrder: CheckoutResponse = { ...order, items: orderItems };
    const hasWeight = orderItems.some((item) => isWeightUnit(item.unit));
    const isDeliveryOrder = finalOrder.deliveryMethod === 'delivery';
    const customerAddress = isDeliveryOrder ? form.values.customerAddress.trim() : null;
    const orderTime = correctedNow();
    // Cuándo está listo un retiro ("mañana desde las 8:00"), con la hora de ahora:
    // se fija acá y no cambia mientras el cliente mira la confirmación.
    const pickupReady = isDeliveryOrder ? null : describePickupReady(orderTime);
    const { priceDrops } = finalOrder;

    const whatsappUrl = buildWhatsappLink(finalOrder.whatsappNumber || storeInfo.whatsappNumber, {
      orderId: finalOrder.orderId,
      storeName: finalOrder.storeName || storeInfo.storeName,
      customerName: form.values.customerName,
      items: orderItems,
      subtotal: finalOrder.subtotal,
      shippingCost: finalOrder.shippingCost,
      total: finalOrder.total,
      deliveryMethod: finalOrder.deliveryMethod,
      customerAddress,
      deliverySlotId: finalOrder.deliverySlot?.id ?? null,
      deliverySlotLabel: finalOrder.deliverySlot?.label ?? null,
      pickupReady,
      paymentMethod: finalOrder.paymentMethod,
      replacementPolicy: form.values.replacementPolicy,
      notes: form.values.notes,
    });

    // Para "repetir último pedido" y para no volver a tipear los datos.
    cart.saveLastOrder(orderItems.map(({ id, quantity }) => ({ id, quantity })));
    form.rememberAndReset();
    slots.clearSelection();

    // Si algo bajó de precio, el catálogo en memoria pasa a mostrar el precio
    // con el que se cobró (la confirmación lo avisa).
    if (priceDrops.length > 0) {
      setProducts((current) => applyPriceChanges(current, priceDrops, orderTime));
    }

    setConfirmation({ order: finalOrder, whatsappUrl, hasWeightItems: hasWeight, customerAddress, pickupReady });
    setCheckoutStep('cart');
    cart.clearCart();

    if (waTab) {
      waTab.location.href = whatsappUrl;
    } else {
      // Si el navegador bloqueó la pestaña, queda el botón en la confirmación.
      window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    if (items.length === 0 || totals.belowDeliveryMinimum || items.some((item) => !item.available)) return;

    // Validación rápida en el navegador; el servidor vuelve a validar todo.
    const invalidField = form.validateAll();
    if (invalidField) {
      focusCheckoutField(invalidField);
      return;
    }

    setNotice(null);
    // La pestaña de WhatsApp se abre ACÁ, en el mismo gesto del toque y antes de
    // cualquier await (después el navegador la bloquearía como popup).
    const waTab = openBlankTab();

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      // El formulario vive en el chunk del carrito, así que ya está cargado:
      // esto no agrega ningún viaje de red.
      const checkout = await loadCartChunk();
      if (!checkoutKeyRef.current) checkoutKeyRef.current = checkout.createIdempotencyKey();
      const idempotencyKey = checkoutKeyRef.current;

      const outcome = await checkout.postCheckout({
        cart: items.map((item) => ({ id: item.id, quantity: item.quantity, price: item.unitPrice })),
        deliveryMethod: form.deliveryMethod,
        deliverySlot: form.isDelivery ? slots.selectedSlot?.id ?? null : null,
        paymentMethod: form.paymentMethod,
        customer: form.values,
        idempotencyKey,
      });

      if (outcome.kind === 'ok') {
        handleCheckoutSuccess(outcome.data, waTab, checkout.buildOrderWhatsappUrl);
      } else {
        waTab?.close();
        handleCheckoutFailure(outcome);
      }
    } catch (error) {
      // No debería pasar (postCheckout no lanza), pero si pasa, que no quede colgado.
      console.error('Error en el checkout:', error);
      waTab?.close();
      setNotice({ kind: 'error', message: SERVER_ERROR_MESSAGE });
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <SiteNav storeInfo={storeInfo} />
      <Hero
        storeInfo={storeInfo}
        heading={heading}
        cartCount={items.length}
        onOpenCart={openCart}
        onCartIntent={preloadCart}
      />

      <main className="container">
        <StoreRules storeInfo={storeInfo} nextSlot={slots.nextSlot} />

        {/* Sale de localStorage (después de montar): va flotando junto al botón
            del carrito (position: fixed) para no empujar la página al aparecer. */}
        {cart.lastOrderLines.length > 0 && items.length === 0 ? (
          <button
            type="button"
            className="repeat-order-btn repeat-order-chip"
            onClick={handleRepeatLastOrder}
            onPointerEnter={preloadCart}
            onPointerDown={preloadCart}
            onFocus={preloadCart}
          >
            <RotateCw size={18} aria-hidden="true" /> Repetir mi último pedido
          </button>
        ) : null}

        {showBolsonesSection ? (
          <BolsonesSection
            products={bolsones}
            pricing={pricing}
            now={now}
            gridQuantities={gridQuantities}
            inCart={cart.quantitiesById}
            onAdjust={handleAdjustGrid}
            onAdd={handleAdd}
          />
        ) : null}

        <section className="catalog-section" aria-labelledby="productos">
          <h2 id="productos">
            <Leaf size={30} aria-hidden="true" /> Nuestros productos
          </h2>
          <p className="section-subtitle">
            Frutas, verduras, bolsones y almacén. Elegí la cantidad y sumalo al carrito: no hace falta registrarse.
          </p>

          <CatalogFilters
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            categories={visibleCategories}
            activeCategory={activeCategory}
            onCategoryChange={handleCategoryChange}
          />

          {filteredProducts.length === 0 ? (
            <p className="no-results">
              {isSearching
                ? `No encontramos productos con "${query}".`
                : activeCategory === 'Ofertas'
                  ? 'No hay ofertas vigentes por ahora. ¡Volvé a fijarte en unos días!'
                  : `No hay productos en "${activeCategory}" por ahora.`}
            </p>
          ) : (
            <ProductGrid
              products={filteredProducts}
              collapseAfter={collapseAfter}
              pricing={pricing}
              now={now}
              gridQuantities={gridQuantities}
              inCart={cart.quantitiesById}
              imageOffset={showBolsonesSection ? bolsones.length : 0}
              onAdjust={handleAdjustGrid}
              onAdd={handleAdd}
            />
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
        </section>

        <ContactSection storeInfo={storeInfo} storeStatus={storeStatus} />

        {infoSection}
      </main>

      {drawerRequested || isCartOpen ? (
        <CartDrawer
          isOpen={isCartOpen}
          onClose={closeCart}
          step={checkoutStep}
          onStepChange={setCheckoutStep}
          storeInfo={storeInfo}
          items={items}
          totals={totals}
          hasWeightItems={hasWeightItems}
          totalWeightKg={totalWeightKg}
          form={form}
          slots={slots}
          pricing={pricing}
          suggestedBolson={suggestedBolson}
          relatedProducts={relatedProducts}
          onAddSuggestion={handleAddSuggestion}
          onSetQuantity={cart.setQuantity}
          onRemove={cart.removeFromCart}
          hasLastOrder={cart.lastOrderLines.length > 0}
          onRepeatLastOrder={handleRepeatLastOrder}
          notice={notice}
          isSubmitting={isSubmitting}
          onSubmit={handleSubmit}
          confirmation={confirmation}
          onFinishConfirmation={handleFinishConfirmation}
          imagesById={imagesById}
        />
      ) : null}

      <CartFab count={items.length} subtotal={totals.subtotal} onOpen={openCart} onIntent={preloadCart} />

      <Toast toast={toast} overCart={isCartOpen} />

      <SiteFooter storeInfo={storeInfo} />
    </>
  );
}

'use client';

import './admin/admin.css';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardList, LogOut, Package, Plus, RefreshCw } from 'lucide-react';
import { ADMIN_API, ADMIN_ROUTES } from '@/lib/routes';
import type { OrderRecord, Product, StoreInfo } from '@/lib/types';
import { formatArs } from '@/lib/format-price';
import { createAdminClient } from './admin/api';
import { InlineAlert, NoticeStack, useNotices } from './admin/notices';
import { Spinner } from './admin/fields';
import { ProductForm } from './admin/product-form';
import { ProductList } from './admin/product-list';
import { OrdersSection } from './admin/orders-section';
import type { AdjustedItem } from './admin/order-adjust-model';
import { getArgentinaToday } from './admin/format';
import { isAwaitingWeights, isOpenOrder, visibleOverdueOrders } from './admin/orders-model';
import { clearAdjustDraft, describeHiddenDrafts, findHiddenDraftIds, listAdjustDraftOrderIds } from './admin/adjust-drafts';

/**
 * Panel del dueño (/trastienda/gestion).
 *
 * Este componente solo orquesta: sesión, carga de datos y las acciones que
 * cambian el servidor. La interfaz de cada parte vive en src/components/admin/.
 *
 * Sesión: la cookie httpOnly viaja sola en cada fetch same-origin. Al montar se
 * pregunta a /api/gestion/session si sigue vigente, y cualquier 401 posterior
 * (vencida, revocada) manda al login desde el cliente de API, con
 * ?motivo=sesion para que el login diga que la sesión venció (antes volvía al
 * login sin ningún mensaje). Los pesos que se estaban cargando quedan en
 * sessionStorage (admin/adjust-drafts.ts) y se recuperan al volver.
 *
 * Pedidos: los del día elegido (GET /api/gestion/orders?date=) y, aparte, los
 * pendientes de días anteriores (GET /api/gestion/orders/atrasados), que antes
 * no se veían en ningún lado hasta que el cron los cancelaba.
 */

/** Cada cuánto se refrescan solos los pedidos (con la pestaña visible). */
const ORDERS_POLL_MS = 60_000;

type Tab = 'pedidos' | 'productos';
const TABS: Tab[] = ['pedidos', 'productos'];
type LoadStatus = 'loading' | 'ready' | 'error';
type SessionState = { status: 'checking' } | { status: 'ok' } | { status: 'error'; error: string };
/** null = formulario cerrado; product null = producto nuevo. */
type FormTarget = { product: Product | null } | null;

/**
 * Marca (por pestaña) de que acá hubo una sesión abierta. Sirve para distinguir
 * "la sesión venció" de "nunca entró" cuando el 401 llega en la verificación
 * inicial: en el celular, el navegador suele descartar la pestaña en segundo
 * plano y la recarga al volver, horas después. Se borra al cerrar sesión.
 */
const SESSION_MARK_KEY = 'adm-sesion';

function setSessionMark(active: boolean) {
  try {
    if (active) window.sessionStorage.setItem(SESSION_MARK_KEY, '1');
    else window.sessionStorage.removeItem(SESSION_MARK_KEY);
  } catch {
    // Sin almacenamiento: el login no sabrá que venció, nada más.
  }
}

function hadSessionInThisTab() {
  try {
    return window.sessionStorage.getItem(SESSION_MARK_KEY) === '1';
  } catch {
    return false;
  }
}

function upsertProduct(list: Product[], product: Product) {
  return list.some((item) => item.id === product.id)
    ? list.map((item) => (item.id === product.id ? product : item))
    : [product, ...list];
}

export default function AdminPanelPage() {
  const router = useRouter();
  const redirecting = useRef(false);
  // La sesión ya se verificó en esta carga (o en esta pestaña antes de que el
  // navegador la recargara): un 401 es que venció o se revocó mientras el dueño
  // usaba el panel, y el login lo dice. Si nunca hubo sesión acá, va al login a secas.
  const sessionVerified = useRef(false);
  const goToLogin = useCallback(() => {
    if (redirecting.current) return;
    redirecting.current = true;
    const expired = sessionVerified.current || hadSessionInThisTab();
    router.replace(expired ? `${ADMIN_ROUTES.login}?motivo=sesion` : ADMIN_ROUTES.login);
  }, [router]);
  const client = useMemo(() => createAdminClient(goToLogin), [goToLogin]);
  const { notices, notify, dismiss } = useNotices();

  const [session, setSession] = useState<SessionState>({ status: 'checking' });
  const [tab, setTab] = useState<Tab>('pedidos');
  const [storeInfo, setStoreInfo] = useState<StoreInfo | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [productsStatus, setProductsStatus] = useState<LoadStatus>('loading');
  const [productsError, setProductsError] = useState('');
  const [formTarget, setFormTarget] = useState<FormTarget>(null);
  // Último pedido de disponibilidad por producto: si el dueño toca dos veces
  // seguidas, la respuesta vieja que llegue tarde no pisa a la nueva.
  const availabilitySeq = useRef(new Map<number, number>());

  const [today, setToday] = useState(() => getArgentinaToday());
  const [selectedDate, setSelectedDate] = useState(() => getArgentinaToday());
  const selectedDateRef = useRef(selectedDate);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [ordersStatus, setOrdersStatus] = useState<LoadStatus>('loading');
  const [ordersError, setOrdersError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [busyOrderIds, setBusyOrderIds] = useState<ReadonlySet<number>>(() => new Set());
  const ordersRequest = useRef(0);

  const [overdueOrders, setOverdueOrders] = useState<OrderRecord[]>([]);
  const [overdueStatus, setOverdueStatus] = useState<LoadStatus>('loading');
  const [overdueError, setOverdueError] = useState('');
  const overdueRequest = useRef(0);
  // Pedidos con pesos tipeados sin guardar (sesión vencida, por ejemplo) que no
  // están en pantalla al entrar: se avisa dónde buscarlos.
  const [hiddenDraftIds, setHiddenDraftIds] = useState<number[]>([]);

  /* ------------------------------------------------------------------------ */
  /* Carga de datos                                                           */
  /* ------------------------------------------------------------------------ */

  const checkSession = useCallback(async () => {
    setSession({ status: 'checking' });
    const result = await client.get<{ ok: boolean }>(`${ADMIN_API}/session`, 'No se pudo verificar la sesión.');
    if (result.ok) {
      sessionVerified.current = true;
      setSessionMark(true);
      setSession({ status: 'ok' });
    } else if (result.status !== 401) {
      // 401 ya está yendo al login. Cualquier otra cosa (sin conexión, 429, 500)
      // no significa que la sesión no valga: se ofrece reintentar.
      setSession({ status: 'error', error: result.error });
    }
  }, [client]);

  /** Carga los pedidos del día. Devuelve la lista, o null si falló o quedó vieja. */
  const loadOrders = useCallback(async (date: string): Promise<OrderRecord[] | null> => {
    ordersRequest.current += 1;
    const requestId = ordersRequest.current;
    setRefreshing(true);
    const result = await client.get<OrderRecord[]>(
      `${ADMIN_API}/orders?date=${encodeURIComponent(date)}`,
      'No se pudieron cargar los pedidos.',
    );
    // Si mientras tanto se pidió otro día (o se refrescó de nuevo), esta
    // respuesta ya no sirve: mostrarla pondría pedidos de otro día en pantalla.
    if (requestId !== ordersRequest.current) return null;
    setRefreshing(false);

    if (!result.ok) {
      if (result.status === 401) return null;
      setOrdersError(result.error);
      setOrdersStatus('error');
      return null;
    }
    const list = Array.isArray(result.data) ? result.data : [];
    setOrders(list);
    setOrdersStatus('ready');
    setOrdersError('');
    setLastUpdated(new Date());
    // Si apareció un pedido con pesos sin guardar, su tarjeta ya abre el editor: no hace falta el aviso.
    setHiddenDraftIds((current) => (current.length ? findHiddenDraftIds(current, list) : current));
    return list;
  }, [client]);

  /** Carga los pendientes de días anteriores. Devuelve la lista, o null si falló o quedó vieja. */
  const loadOverdue = useCallback(async (): Promise<OrderRecord[] | null> => {
    overdueRequest.current += 1;
    const requestId = overdueRequest.current;
    const result = await client.get<OrderRecord[]>(
      `${ADMIN_API}/orders/atrasados`,
      'No se pudieron cargar los pedidos pendientes de días anteriores.',
    );
    if (requestId !== overdueRequest.current) return null;
    if (!result.ok) {
      if (result.status === 401) return null;
      // Se deja la lista que había: un corte de un minuto no la vacía.
      setOverdueError(result.error);
      setOverdueStatus('error');
      return null;
    }
    const list = Array.isArray(result.data) ? result.data : [];
    setOverdueOrders(list);
    setOverdueStatus('ready');
    setOverdueError('');
    return list;
  }, [client]);

  const loadProducts = useCallback(async () => {
    setProductsStatus('loading');
    const result = await client.get<Product[]>('/api/products', 'No se pudo cargar el catálogo.');
    if (!result.ok) {
      if (result.status === 401) return;
      setProductsError(result.error);
      setProductsStatus('error');
      return;
    }
    setProducts(Array.isArray(result.data) ? result.data : []);
    setProductsStatus('ready');
    setProductsError('');
  }, [client]);

  const loadStoreInfo = useCallback(async () => {
    const result = await client.get<StoreInfo>('/api/store-info', 'No se pudieron cargar los datos del local.');
    if (result.ok) {
      setStoreInfo(result.data);
    } else if (result.status !== 401) {
      notify('error', 'No se pudieron cargar los datos del local (alias, link de reseñas): los botones de WhatsApp aparecen cuando se cargan. Recargá la página.');
    }
  }, [client, notify]);

  useEffect(() => {
    // Antes la sesión era un token en localStorage. Ya no se usa: se borra el que
    // haya quedado para que no ande dando vueltas en el navegador.
    try {
      window.localStorage.removeItem('adminToken');
    } catch {
      // Almacenamiento bloqueado (modo privado estricto): no hay nada que limpiar.
    }
    void checkSession();
  }, [checkSession]);

  useEffect(() => {
    if (session.status !== 'ok') return;
    void loadProducts();
    void loadStoreInfo();
    // Al entrar (por ejemplo, después de que venció la sesión): los pesos sin
    // guardar de un pedido que está en pantalla se recuperan solos en su
    // tarjeta; los de uno que no está (otro día) se avisan.
    void Promise.all([loadOrders(selectedDateRef.current), loadOverdue()]).then(([dayOrders, overdue]) => {
      if (!dayOrders || !overdue) return;
      setHiddenDraftIds(findHiddenDraftIds(listAdjustDraftOrderIds(), [...dayOrders, ...overdue]));
    });
  }, [session.status, loadProducts, loadStoreInfo, loadOrders, loadOverdue]);

  // Los pedidos entran solos durante el día: se refrescan cada minuto y al
  // volver a la pestaña (por ejemplo, después de mandar un WhatsApp).
  useEffect(() => {
    if (session.status !== 'ok') return;
    const refreshIfVisible = () => {
      if (document.visibilityState !== 'visible') return;
      setToday(getArgentinaToday());
      void loadOrders(selectedDateRef.current);
      void loadOverdue();
    };
    const interval = window.setInterval(refreshIfVisible, ORDERS_POLL_MS);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [session.status, loadOrders, loadOverdue]);

  function changeDate(date: string) {
    selectedDateRef.current = date;
    setSelectedDate(date);
    setOrders([]);
    setOrdersStatus('loading');
    setLastUpdated(null);
    void loadOrders(date);
  }

  function refreshOrders() {
    setToday(getArgentinaToday());
    reloadOrders();
  }

  /** Vuelve a pedir el día elegido y los pendientes de días anteriores. */
  function reloadOrders() {
    void loadOrders(selectedDateRef.current);
    void loadOverdue();
  }

  /** Descarta los pesos sin guardar de pedidos que no están en pantalla. */
  function discardHiddenDrafts() {
    for (const id of hiddenDraftIds) clearAdjustDraft(id);
    setHiddenDraftIds([]);
  }

  /* ------------------------------------------------------------------------ */
  /* Pedidos                                                                  */
  /* ------------------------------------------------------------------------ */

  function setOrderBusy(orderId: number, busy: boolean) {
    setBusyOrderIds((current) => {
      const next = new Set(current);
      if (busy) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }

  function patchOrder(orderId: number, patch: Partial<OrderRecord>) {
    setOrders((current) => current.map((order) => (order.id === orderId ? { ...order, ...patch } : order)));
    // Los pendientes de días anteriores son solo los abiertos: si se cerró, sale de la lista.
    setOverdueOrders((current) => current.flatMap((order) => {
      if (order.id !== orderId) return [order];
      const next = { ...order, ...patch };
      return isOpenOrder(next) ? [next] : [];
    }));
  }

  function replaceOrder(updated: OrderRecord) {
    setOrders((current) => current.map((order) => (order.id === updated.id ? updated : order)));
    setOverdueOrders((current) => current.map((order) => (order.id === updated.id ? updated : order)));
  }

  function removeOrder(orderId: number) {
    setOrders((current) => current.filter((order) => order.id !== orderId));
    setOverdueOrders((current) => current.filter((order) => order.id !== orderId));
  }

  async function changeOrderStatus(order: OrderRecord, action: 'confirm' | 'cancel') {
    setOrderBusy(order.id, true);
    const result = await client.send(
      `${ADMIN_API}/orders/${order.id}/${action}`,
      'PUT',
      undefined,
      action === 'confirm' ? 'No se pudo confirmar el pago.' : 'No se pudo cancelar el pedido.',
    );
    setOrderBusy(order.id, false);

    if (!result.ok) {
      if (result.status === 401) return;
      notify('error', `Pedido #${order.id}: ${result.error}`);
      // 409/404: el pedido cambió o ya no existe; se recarga para ver cómo quedó.
      if (result.status === 409 || result.status === 404) reloadOrders();
      return;
    }

    patchOrder(order.id, { status: action === 'confirm' ? 'paid' : 'cancelled' });
    notify('success', action === 'confirm' ? `Pedido #${order.id} marcado como pagado.` : `Pedido #${order.id} cancelado.`);
    reloadOrders();
  }

  function handleConfirmOrder(order: OrderRecord) {
    const question = order.paymentMethod === 'cash'
      ? `¿Ya cobraste en efectivo el pedido #${order.id} (${formatArs(order.total)})?`
      : `¿Llegó la transferencia del pedido #${order.id} (${formatArs(order.total)})?`;
    const warning = isAwaitingWeights(order)
      ? '\n\nOjo: todavía no cargaste los pesos reales, ese total es estimado.'
      : '';
    if (!window.confirm(question + warning)) return;
    void changeOrderStatus(order, 'confirm');
  }

  function handleCancelOrder(order: OrderRecord) {
    const who = order.customerName?.trim() ? ` de ${order.customerName.trim()}` : '';
    if (!window.confirm(`¿Cancelar el pedido #${order.id}${who}?`)) return;
    void changeOrderStatus(order, 'cancel');
  }

  async function handleDeleteOrder(order: OrderRecord) {
    if (!window.confirm(`¿Eliminar el pedido #${order.id}? Esta acción no se puede deshacer.`)) return;
    setOrderBusy(order.id, true);
    const result = await client.send(`${ADMIN_API}/orders/${order.id}`, 'DELETE', undefined, 'No se pudo eliminar el pedido.');
    setOrderBusy(order.id, false);

    // 404 = ya lo había borrado otra pestaña: el resultado es el mismo.
    if (!result.ok && result.status !== 404) {
      if (result.status !== 401) notify('error', `Pedido #${order.id}: ${result.error}`);
      return;
    }
    removeOrder(order.id);
    notify('success', `Pedido #${order.id} eliminado.`);
  }

  /**
   * Ajuste de pesos. `expectedUpdatedAt` es la versión del pedido sobre la que
   * el dueño cargó los pesos (la que tenía al abrir el editor): si el pedido
   * cambió desde entonces, el servidor responde 409 sin pisar nada. Ahí se
   * recarga, y el editor (que conserva lo tipeado) muestra qué cambió.
   */
  async function handleAdjustOrder(order: OrderRecord, items: AdjustedItem[], expectedUpdatedAt: string | null): Promise<string | null> {
    const result = await client.send<OrderRecord>(
      `${ADMIN_API}/orders/${order.id}`,
      'PUT',
      { items, expectedUpdatedAt },
      'No se pudo guardar el ajuste.',
    );
    if (!result.ok) {
      if (result.status === 404) {
        // Lo borraron desde otro lado: la tarjeta (y el editor) desaparecen al recargar.
        notify('error', `Pedido #${order.id}: ${result.error}`);
        reloadOrders();
      } else if (result.status === 409) {
        // Si lo cerraron desde otro lado, al recargar el editor se desmonta y
        // el error que muestra adentro se pierde: se avisa también arriba.
        notify('error', `Pedido #${order.id}: ${result.error}`);
        reloadOrders();
      }
      return result.error;
    }
    replaceOrder(result.data);
    notify('success', `Pedido #${order.id} ajustado. Total final: ${formatArs(result.data.total)}. Ya le podés avisar al cliente.`);
    reloadOrders();
    return null;
  }

  /* ------------------------------------------------------------------------ */
  /* Productos                                                                */
  /* ------------------------------------------------------------------------ */

  function openNewProduct() {
    setFormTarget({ product: null });
  }

  function handleProductSaved(product: Product, mode: 'created' | 'updated') {
    setProducts((current) => upsertProduct(current, product));
    setFormTarget(null);
    notify('success', mode === 'created' ? `${product.name} se agregó al catálogo.` : `${product.name} se actualizó.`);
  }

  function handleProductUpdated(product: Product, message: string) {
    setProducts((current) => upsertProduct(current, product));
    notify('success', message);
  }

  async function handleDeleteProduct(product: Product) {
    if (!window.confirm(`¿Eliminar "${product.name}" del catálogo? Los pedidos que ya lo tienen no se tocan.`)) return;
    const result = await client.send(`${ADMIN_API}/products/${product.id}`, 'DELETE', undefined, 'No se pudo eliminar el producto.');
    if (!result.ok && result.status !== 404) {
      if (result.status !== 401) notify('error', `${product.name}: ${result.error}`);
      return;
    }
    setProducts((current) => current.filter((item) => item.id !== product.id));
    setFormTarget((current) => (current?.product?.id === product.id ? null : current));
    notify('success', `${product.name} se eliminó del catálogo.`);
  }

  async function handleToggleAvailability(product: Product) {
    const nextAvailable = !product.available;
    const seq = (availabilitySeq.current.get(product.id) ?? 0) + 1;
    availabilitySeq.current.set(product.id, seq);

    // Se cambia en pantalla al toque y se revierte si el servidor rechaza: el
    // dueño aprieta esto varias veces seguidas y esperar el ida y vuelta molesta.
    setProducts((current) => current.map((item) => (item.id === product.id ? { ...item, available: nextAvailable } : item)));

    const result = await client.send<Product>(
      `${ADMIN_API}/products/${product.id}/availability`,
      'PUT',
      { available: nextAvailable },
      'No se pudo cambiar la disponibilidad.',
    );
    if (availabilitySeq.current.get(product.id) !== seq) return;

    if (!result.ok) {
      setProducts((current) => current.map((item) => (item.id === product.id ? { ...item, available: product.available } : item)));
      if (result.status !== 401) notify('error', `${product.name}: ${result.error}`);
      return;
    }
    setProducts((current) => upsertProduct(current, result.data));
  }

  /* ------------------------------------------------------------------------ */
  /* Sesión y navegación                                                      */
  /* ------------------------------------------------------------------------ */

  async function handleLogout() {
    setLoggingOut(true);
    const result = await client.send(`${ADMIN_API}/logout`, 'POST', undefined, 'No se pudo cerrar la sesión.');
    if (!result.ok) {
      setLoggingOut(false);
      notify('error', result.error);
      return;
    }
    // Salió a propósito: el login no tiene que decir que la sesión venció.
    setSessionMark(false);
    redirecting.current = true;
    router.replace(ADMIN_ROUTES.login);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = TABS.indexOf(tab);
    const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length];
    setTab(next);
    document.getElementById(`adm-tab-${next}`)?.focus();
  }

  const storeName = storeInfo?.storeName ?? 'El Pampa';
  // Sin cobrar: los del día elegido más los pendientes de días anteriores (sin contar dos veces).
  const openOrdersCount = orders.filter(isOpenOrder).length
    + (selectedDate === today ? visibleOverdueOrders(overdueOrders, orders).length : 0);

  if (session.status !== 'ok') {
    return (
      <main className="adm-page adm-page--center">
        <div className="adm-card adm-card--narrow">
          {session.status === 'checking' ? (
            <p className="adm-empty"><Spinner /> Verificando sesión…</p>
          ) : (
            <InlineAlert
              action={(
                <button type="button" className="adm-btn adm-btn--secondary adm-btn--small" onClick={() => void checkSession()}>
                  <RefreshCw size={16} aria-hidden="true" /> Reintentar
                </button>
              )}
            >
              {session.error}
            </InlineAlert>
          )}
        </div>
        <NoticeStack notices={notices} onDismiss={dismiss} />
      </main>
    );
  }

  return (
    <div className="adm-page">
      <header className="adm-topbar">
        <div className="adm-topbar__inner">
          <h1 className="adm-topbar__title">
            <span className="adm-brand">{storeName}</span>
            <span className="adm-topbar__subtitle">Gestión</span>
          </h1>
          <button type="button" className="adm-btn adm-btn--on-dark adm-btn--small" onClick={() => void handleLogout()} disabled={loggingOut}>
            {loggingOut ? <Spinner size={16} /> : <LogOut size={16} aria-hidden="true" />} Cerrar sesión
          </button>
        </div>
        <div className="adm-tabs" role="tablist" aria-label="Secciones del panel">
          <button
            type="button"
            role="tab"
            id="adm-tab-pedidos"
            className="adm-tab"
            aria-selected={tab === 'pedidos'}
            aria-controls="adm-panel-pedidos"
            tabIndex={tab === 'pedidos' ? 0 : -1}
            onClick={() => setTab('pedidos')}
            onKeyDown={handleTabKeyDown}
          >
            <ClipboardList size={18} aria-hidden="true" /> Pedidos
            {openOrdersCount ? <span className="adm-count" aria-label={`${openOrdersCount} sin cobrar`}>{openOrdersCount}</span> : null}
          </button>
          <button
            type="button"
            role="tab"
            id="adm-tab-productos"
            className="adm-tab"
            aria-selected={tab === 'productos'}
            aria-controls="adm-panel-productos"
            tabIndex={tab === 'productos' ? 0 : -1}
            onClick={() => setTab('productos')}
            onKeyDown={handleTabKeyDown}
          >
            <Package size={18} aria-hidden="true" /> Productos
          </button>
        </div>
      </header>

      <main className="adm-shell">
        {/* Los dos paneles quedan montados (hidden): cambiar de pestaña no pierde
            un formulario a medio cargar ni un ajuste de pesos sin guardar. */}
        <div role="tabpanel" id="adm-panel-pedidos" aria-labelledby="adm-tab-pedidos" hidden={tab !== 'pedidos'}>
          {hiddenDraftIds.length ? (
            <InlineAlert
              kind="info"
              action={(
                <button type="button" className="adm-btn adm-btn--ghost adm-btn--small" onClick={discardHiddenDrafts}>
                  Descartar
                </button>
              )}
            >
              {describeHiddenDrafts(hiddenDraftIds)}
            </InlineAlert>
          ) : null}
          <OrdersSection
            orders={orders}
            status={ordersStatus}
            error={ordersError}
            overdue={overdueOrders}
            overdueStatus={overdueStatus}
            overdueError={overdueError}
            selectedDate={selectedDate}
            today={today}
            refreshing={refreshing}
            lastUpdated={lastUpdated}
            storeInfo={storeInfo}
            busyOrderIds={busyOrderIds}
            onChangeDate={changeDate}
            onRefresh={refreshOrders}
            onConfirm={handleConfirmOrder}
            onCancel={handleCancelOrder}
            onDelete={(order) => void handleDeleteOrder(order)}
            onAdjust={handleAdjustOrder}
          />
        </div>

        <div role="tabpanel" id="adm-panel-productos" aria-labelledby="adm-tab-productos" hidden={tab !== 'productos'}>
          <section className="adm-section" aria-labelledby="adm-products-title">
            <div className="adm-section__head adm-section__head--row">
              <div>
                <h2 id="adm-products-title">Productos</h2>
                <p className="adm-section__lead">
                  Cuando se termina algo, tocá &quot;Sin stock&quot;: deja de poder pedirse al instante.
                </p>
              </div>
              {formTarget === null ? (
                <button type="button" className="adm-btn adm-btn--primary" onClick={openNewProduct}>
                  <Plus size={18} aria-hidden="true" /> Nuevo producto
                </button>
              ) : null}
            </div>

            {formTarget !== null ? (
              <ProductForm
                key={formTarget.product?.id ?? 'nuevo'}
                product={formTarget.product}
                client={client}
                onSaved={handleProductSaved}
                onCancel={() => setFormTarget(null)}
              />
            ) : null}

            <ProductList
              products={products}
              status={productsStatus}
              error={productsError}
              onRetry={() => void loadProducts()}
              client={client}
              editingProductId={formTarget?.product?.id ?? null}
              onEdit={(product) => setFormTarget({ product })}
              onDelete={(product) => void handleDeleteProduct(product)}
              onToggleAvailability={(product) => void handleToggleAvailability(product)}
              onProductUpdated={handleProductUpdated}
            />
          </section>
        </div>
      </main>

      <NoticeStack notices={notices} onDismiss={dismiss} />
    </div>
  );
}

'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, RotateCw, Scale, ShoppingCart, X } from 'lucide-react';
import { formatArs } from '@/lib/format-price';
import type { OrderTotals } from '@/lib/pricing';
import type { ProductUnit } from '@/lib/product-units';
import type { Product, StoreInfo } from '@/lib/types';
import CartItemRow from './cart-item-row';
import CartSuggestions from './cart-suggestions';
import CheckoutForm, { CHECKOUT_FORM_ID } from './checkout-form';
import CheckoutNoticeBox, { UnavailableItemsNotice } from './checkout-notice';
import { DeliveryMethodPicker, DeliveryNotices } from './delivery-options';
import OrderConfirmation from './order-confirmation';
import OrderSummary from './order-summary';
import { resolveDisplayUnit } from './quantity';
import type { CheckoutFormState } from './use-checkout-form';
import type { DeliverySlotsState } from './use-delivery-slots';
import type {
  CartItem,
  CheckoutNotice,
  CheckoutStep,
  OrderConfirmationData,
  ProductPriceView,
} from './types';

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type CartDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  step: CheckoutStep;
  onStepChange: (step: CheckoutStep) => void;
  storeInfo: StoreInfo;
  items: CartItem[];
  totals: OrderTotals;
  hasWeightItems: boolean;
  totalWeightKg: number;
  form: CheckoutFormState;
  slots: DeliverySlotsState;
  pricing: Map<number, ProductPriceView>;
  suggestedBolson: Product | null;
  relatedProducts: Product[];
  onAddSuggestion: (product: Product) => void;
  onSetQuantity: (item: Pick<CartItem, 'id' | 'unit'>, quantity: number) => void;
  onRemove: (productId: number) => void;
  hasLastOrder: boolean;
  onRepeatLastOrder: () => void;
  notice: CheckoutNotice | null;
  isSubmitting: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  confirmation: OrderConfirmationData | null;
  onFinishConfirmation: () => void;
  imagesById: Map<number, string>;
};

/**
 * Panel lateral del carrito, con sus tres momentos: revisar el carrito, completar
 * los datos y la confirmación del pedido.
 *
 * Es un diálogo modal: atrapa el foco mientras está abierto, se cierra con Escape
 * o tocando afuera, y al cerrarse devuelve el foco al botón que lo abrió.
 *
 * No va en el JS inicial de la página: la tienda lo carga con next/dynamic
 * (cart-drawer-chunk.ts) recién con el primer producto agregado o al acercarse
 * al botón del carrito.
 */
function CartDrawerComponent(props: CartDrawerProps) {
  const {
    isOpen,
    onClose,
    step,
    onStepChange,
    storeInfo,
    items,
    totals,
    hasWeightItems,
    totalWeightKg,
    form,
    slots,
    notice,
    isSubmitting,
    confirmation,
  } = props;

  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const detailsHeadingRef = useRef<HTMLHeadingElement>(null);
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null);
  // Cómo ve cada línea por peso el cliente (kg o g). Es solo de la vista.
  const [unitModes, setUnitModes] = useState<Record<number, ProductUnit>>({});

  // onClose puede cambiar en cada render del padre; se guarda en un ref para que
  // el efecto de apertura no se vuelva a correr (y no robe el foco) por eso.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    // Se espera a que arranque la transición para que el foco no haga saltar el panel.
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 60);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusables = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((element) => element.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!drawerRef.current.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [isOpen]);

  // Al cambiar de paso se vuelve arriba y el foco va al título del paso nuevo,
  // así el lector de pantalla anuncia dónde está.
  useEffect(() => {
    if (!isOpen) return;
    bodyRef.current?.scrollTo({ top: 0 });
    if (step === 'details') detailsHeadingRef.current?.focus({ preventScroll: true });
    // Solo cuando cambia el paso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (!confirmation) return;
    bodyRef.current?.scrollTo({ top: 0 });
    confirmationHeadingRef.current?.focus({ preventScroll: true });
  }, [confirmation]);

  const handleDisplayUnitChange = useCallback((productId: number, unit: ProductUnit) => {
    setUnitModes((current) => ({ ...current, [productId]: unit }));
  }, []);

  const unavailableItems = items.filter((item) => !item.available);
  const blocked = items.length === 0 || totals.belowDeliveryMinimum || unavailableItems.length > 0;
  const summaryLines = items.map((item) => ({
    id: item.id,
    name: item.name,
    unit: item.unit,
    quantity: item.quantity,
    price: item.unitPrice,
    image: item.image,
  }));

  const unavailableNotice = (
    <UnavailableItemsNotice
      items={unavailableItems}
      justHappened={notice?.kind === 'unavailable'}
      onRemove={props.onRemove}
    />
  );

  const noticeBox = notice ? <CheckoutNoticeBox notice={notice} /> : null;

  return (
    <div
      className={`cart-drawer-overlay ${isOpen ? 'open' : ''}`}
      onClick={onClose}
      inert={!isOpen}
    >
      <div
        ref={drawerRef}
        className="cart-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-drawer-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="cart-drawer-header">
          <h2 id="cart-drawer-title">
            <ShoppingCart size={26} aria-hidden="true" /> {confirmation ? 'Tu pedido' : 'Tu carrito'}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="cart-drawer-close"
            onClick={onClose}
            aria-label="Cerrar carrito"
          >
            <X size={26} aria-hidden="true" />
          </button>
        </div>

        {confirmation ? (
          <div className="cart-drawer-body" ref={bodyRef}>
            <OrderConfirmation
              confirmation={confirmation}
              storeInfo={storeInfo}
              imagesById={props.imagesById}
              headingRef={confirmationHeadingRef}
              onContinue={props.onFinishConfirmation}
            />
          </div>
        ) : step === 'details' && items.length > 0 ? (
          <>
            <div className="cart-drawer-body" ref={bodyRef}>
              <button type="button" className="checkout-back-btn" onClick={() => onStepChange('cart')}>
                <ArrowLeft size={18} aria-hidden="true" /> Volver al carrito
              </button>
              <CheckoutForm
                form={form}
                slots={slots}
                storeInfo={storeInfo}
                hasWeightItems={hasWeightItems}
                total={totals.total}
                headingRef={detailsHeadingRef}
                onSubmit={props.onSubmit}
              />
              <OrderSummary
                title="Revisá tu pedido"
                lines={summaryLines}
                subtotal={totals.subtotal}
                shippingCost={totals.shippingCost}
                total={totals.total}
                isDelivery={form.isDelivery}
                approximate={hasWeightItems}
              />
            </div>

            <div className="cart-drawer-footer">
              <DeliveryNotices
                isDelivery={form.isDelivery}
                totals={totals}
                totalWeightKg={totalWeightKg}
                storeInfo={storeInfo}
                compact
              />
              {unavailableNotice}
              {noticeBox}
              <div className="cart-total">
                Total{hasWeightItems ? ' aprox.' : ''}: <span>{formatArs(totals.total)}</span>
              </div>
              <button
                type="submit"
                form={CHECKOUT_FORM_ID}
                className="checkout-btn"
                disabled={blocked || isSubmitting}
                aria-busy={isSubmitting || undefined}
              >
                {isSubmitting ? 'Enviando pedido…' : 'Confirmar pedido'}
              </button>
              <p className="checkout-footnote">Al confirmar te abrimos WhatsApp con el detalle para mandárnoslo.</p>
            </div>
          </>
        ) : (
          <>
            <div className="cart-drawer-body" ref={bodyRef}>
              {items.length === 0 ? (
                <div className="cart-empty">
                  <p>Tu carrito está vacío.</p>
                  {props.hasLastOrder ? (
                    <button type="button" className="repeat-order-btn" onClick={props.onRepeatLastOrder}>
                      <RotateCw size={18} aria-hidden="true" /> Repetir mi último pedido
                    </button>
                  ) : null}
                  <button type="button" className="continue-shopping-btn" onClick={onClose}>
                    Ver productos
                  </button>
                </div>
              ) : (
                <>
                  <ul className="cart-items">
                    {items.map((item) => (
                      <CartItemRow
                        key={item.id}
                        item={item}
                        displayUnit={resolveDisplayUnit(item.unit, unitModes[item.id])}
                        onDisplayUnitChange={handleDisplayUnitChange}
                        onSetQuantity={props.onSetQuantity}
                        onRemove={props.onRemove}
                      />
                    ))}
                  </ul>
                  {hasWeightItems ? (
                    <p className="weight-disclaimer">
                      <Scale size={16} aria-hidden="true" />
                      <span>
                        En lo que va por peso el total es aproximado: cuando armemos tu pedido te mandamos el total
                        exacto por WhatsApp.
                      </span>
                    </p>
                  ) : null}
                  <CartSuggestions
                    bolson={props.suggestedBolson}
                    related={props.relatedProducts}
                    pricing={props.pricing}
                    onAdd={props.onAddSuggestion}
                  />
                </>
              )}
            </div>

            {items.length > 0 ? (
              <div className="cart-drawer-footer">
                <DeliveryMethodPicker
                  name="cart-delivery-method"
                  value={form.deliveryMethod}
                  onChange={form.setDeliveryMethod}
                  storeInfo={storeInfo}
                  compact
                />
                <DeliveryNotices
                  isDelivery={form.isDelivery}
                  totals={totals}
                  totalWeightKg={totalWeightKg}
                  storeInfo={storeInfo}
                />
                {unavailableNotice}
                {noticeBox}
                <OrderSummary
                  subtotal={totals.subtotal}
                  shippingCost={totals.shippingCost}
                  total={totals.total}
                  isDelivery={form.isDelivery}
                  approximate={hasWeightItems}
                  hideNote
                />
                <button
                  type="button"
                  className="checkout-btn"
                  onClick={() => onStepChange('details')}
                  disabled={blocked}
                >
                  Continuar
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Cerrado, el panel no se vuelve a dibujar: está fuera de la pantalla e inert, y
 * antes se redibujaba entero (unos 200 nodos y sus fotos) en cada «Agregar al
 * carrito». Al abrirse cambia isOpen y se dibuja con los datos de ese momento;
 * al cerrarse también, para la transición de salida.
 */
function areClosedDrawerPropsEqual(previous: Pick<CartDrawerProps, 'isOpen'>, next: Pick<CartDrawerProps, 'isOpen'>) {
  return !previous.isOpen && !next.isOpen;
}

const CartDrawer = memo(CartDrawerComponent, areClosedDrawerPropsEqual);
export default CartDrawer;

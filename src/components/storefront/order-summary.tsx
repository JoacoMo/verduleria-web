import { formatArs } from '@/lib/format-price';
import { lineTotal } from '@/lib/pricing';
import { formatProductQuantity, type ProductUnit } from '@/lib/product-units';
import { PLACEHOLDER_IMAGE, handleImageError } from './format';

export type SummaryLine = {
  id: number;
  name: string;
  unit: ProductUnit;
  quantity: number;
  /** Precio unitario cobrado. */
  price: number;
  image?: string;
};

type OrderSummaryProps = {
  /** Si viene vacío o no viene, se muestran solo los totales. */
  lines?: SummaryLine[];
  subtotal: number;
  shippingCost: number;
  total: number;
  isDelivery: boolean;
  /** Hay algo por peso: el total es estimado hasta pesar. */
  approximate: boolean;
  title?: string;
  /** Sin la aclaración de "se ajusta al pesar" (cuando ya se muestra en otro lado). */
  hideNote?: boolean;
};

/**
 * Resumen del pedido: foto, cantidad y subtotal de cada línea, y después
 * subtotal, envío y total. Se usa antes de confirmar y en la confirmación, así el
 * cliente ve exactamente lo mismo en los dos momentos.
 */
export default function OrderSummary({
  lines = [],
  subtotal,
  shippingCost,
  total,
  isDelivery,
  approximate,
  title,
  hideNote = false,
}: OrderSummaryProps) {
  return (
    <div className="order-summary">
      {title ? <h4 className="order-summary-title">{title}</h4> : null}
      {lines.length > 0 ? (
        <ul className="summary-lines">
          {lines.map((line) => (
            <li key={line.id}>
              <img
                src={line.image || PLACEHOLDER_IMAGE}
                alt=""
                width={44}
                height={44}
                loading="lazy"
                decoding="async"
                onError={handleImageError}
              />
              <span className="summary-line-name">
                <strong>{line.name}</strong>
                <span>{formatProductQuantity(line.quantity, line.unit)} × {formatArs(line.price)}</span>
              </span>
              <span className="summary-line-total">{formatArs(lineTotal(line))}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="summary-totals">
        <div>
          <dt>Subtotal</dt>
          <dd>{formatArs(subtotal)}</dd>
        </div>
        <div>
          <dt>{isDelivery ? 'Envío a domicilio' : 'Retiro en el local'}</dt>
          <dd>{isDelivery ? (shippingCost > 0 ? formatArs(shippingCost) : 'Gratis') : 'Sin costo'}</dd>
        </div>
        <div className="summary-total">
          <dt>Total{approximate ? ' aprox.' : ''}</dt>
          <dd>{formatArs(total)}</dd>
        </div>
      </dl>
      {approximate && !hideNote ? (
        <p className="summary-note">
          Lo que va por peso se ajusta al pesar: cuando armemos tu pedido te mandamos el total exacto por WhatsApp.
        </p>
      ) : null}
    </div>
  );
}

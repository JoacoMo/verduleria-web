import { Clock, Mail, MapPin, Store, TriangleAlert, Truck } from 'lucide-react';
import { WhatsAppIcon } from '@/components/brand-icons';
import { DELIVERY_WINDOWS_TEXT } from '@/lib/delivery-slots';
import { ORDER_CUTOFF_LABEL } from '@/lib/store-hours';
import type { StoreInfo } from '@/lib/types';
import { buildWhatsappUrl } from '@/lib/whatsapp';
import { formatPhoneForDisplay } from './format';

const MAP_DIRECTIONS_URL = 'https://maps.google.com/?cid=899078826367002557';
const MAP_EMBED_URL = 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d4211.8315560727915!2d-64.16876892364488!3d-31.41596097426193!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x9432a2a385140651%3A0xc7a2b6dd6ae27bd!2sEl%20Pampa!5e1!3m2!1ses!2sar!4v1785775498093!5m2!1ses!2sar';
const ICON_SIZE = 20;

type ContactSectionProps = {
  storeInfo: StoreInfo;
  /** null hasta montar: "Abierto ahora" depende de la hora del navegador. */
  storeStatus: { open: boolean; pastCutoff: boolean } | null;
};

/** "Dónde estamos": dirección, contacto, horarios y mapa. */
export default function ContactSection({ storeInfo, storeStatus }: ContactSectionProps) {
  return (
    <section className="contact-section" id="ubicacion" aria-labelledby="ubicacion-title">
      <div className="contact-heading">
        <h2 id="ubicacion-title">
          <Store size={30} aria-hidden="true" /> Dónde estamos
        </h2>
        {storeStatus ? (
          <span className={`store-status-badge ${storeStatus.open ? 'open' : 'closed'}`}>
            <span className="status-dot" aria-hidden="true" />
            {storeStatus.open ? 'Abierto ahora' : 'Cerrado ahora'}
          </span>
        ) : null}
      </div>

      <div className="contact-info">
        <p>
          <MapPin size={ICON_SIZE} aria-hidden="true" />
          <a href={MAP_DIRECTIONS_URL} target="_blank" rel="noopener noreferrer">{storeInfo.storeAddress}</a>
        </p>
        <p>
          <WhatsAppIcon size={ICON_SIZE} />
          <a href={buildWhatsappUrl(storeInfo.whatsappNumber)} target="_blank" rel="noopener noreferrer">
            WhatsApp: {formatPhoneForDisplay(storeInfo.whatsappNumber)}
          </a>
        </p>
        {storeInfo.contactEmail ? (
          <p>
            <Mail size={ICON_SIZE} aria-hidden="true" />
            <a href={`mailto:${storeInfo.contactEmail}`}>{storeInfo.contactEmail}</a>
          </p>
        ) : null}
        <p>
          <Clock size={ICON_SIZE} aria-hidden="true" />
          <span>{storeInfo.storeHours.weekday}</span>
        </p>
        <p>
          <Clock size={ICON_SIZE} aria-hidden="true" />
          <span>{storeInfo.storeHours.sunday}</span>
        </p>
        <p>
          <Truck size={ICON_SIZE} aria-hidden="true" />
          <span>Envíos a domicilio en dos turnos: de {DELIVERY_WINDOWS_TEXT}.</span>
        </p>
        <p className="order-cutoff-note">
          <TriangleAlert size={18} aria-hidden="true" />
          <span>
            {storeStatus?.pastCutoff
              ? `Ya pasaron las ${ORDER_CUTOFF_LABEL}: si pedís para retirar, lo preparamos mañana. Para envío elegís el turno al hacer el pedido.`
              : `Los pedidos para retirar que lleguen después de las ${ORDER_CUTOFF_LABEL} se preparan al día siguiente. Para envío elegís el turno al hacer el pedido.`}
          </span>
        </p>
      </div>

      <div className="map-container">
        <iframe
          src={MAP_EMBED_URL}
          width="600"
          height="450"
          style={{ border: 0 }}
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          title={`Ubicación de ${storeInfo.storeName} en el mapa`}
        />
      </div>
    </section>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, X, type LucideIcon } from 'lucide-react';

/**
 * Avisos del panel. Reemplazan a los alert() de antes, que en el celular tapan
 * todo, cortan lo que el dueño estaba haciendo y obligan a tocar "Aceptar".
 *
 * - NoticeStack: avisos flotantes que se van solos ("Producto guardado").
 * - InlineAlert: mensaje fijo al lado de lo que falló (errores de un formulario).
 */

export type NoticeKind = 'success' | 'error' | 'info';
export type Notice = { id: number; kind: NoticeKind; text: string };

const MAX_NOTICES = 4;
// Los errores quedan más tiempo: hay que llegar a leerlos.
const DURATION_MS: Record<NoticeKind, number> = { success: 4000, info: 5000, error: 9000 };

export function useNotices() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const counter = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const notify = useCallback((kind: NoticeKind, text: string) => {
    counter.current += 1;
    const id = counter.current;
    setNotices((current) => [...current, { id, kind, text }].slice(-MAX_NOTICES));
    timers.current.set(id, window.setTimeout(() => dismiss(id), DURATION_MS[kind]));
  }, [dismiss]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return { notices, notify, dismiss };
}

const ICONS: Record<NoticeKind, LucideIcon> = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
};

export function NoticeStack({ notices, onDismiss }: { notices: Notice[]; onDismiss: (id: number) => void }) {
  // La región queda siempre montada: los lectores de pantalla solo anuncian
  // cambios dentro de una región que ya existía.
  return (
    <div className="adm-notices" role="status" aria-live="polite">
      {notices.map((notice) => {
        const Icon = ICONS[notice.kind];
        return (
          <div key={notice.id} className={`adm-notice adm-notice--${notice.kind}`}>
            <Icon size={18} aria-hidden="true" className="adm-notice__icon" />
            <span className="adm-notice__text">{notice.text}</span>
            <button type="button" className="adm-notice__close" onClick={() => onDismiss(notice.id)} aria-label="Cerrar aviso">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function InlineAlert({ kind = 'error', children, action }: { kind?: NoticeKind; children: ReactNode; action?: ReactNode }) {
  const Icon = ICONS[kind];
  return (
    <div className={`adm-alert adm-alert--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden="true" className="adm-alert__icon" />
      <div className="adm-alert__body">{children}</div>
      {action ? <div className="adm-alert__action">{action}</div> : null}
    </div>
  );
}

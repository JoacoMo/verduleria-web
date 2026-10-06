'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleCheck } from 'lucide-react';

const TOAST_DURATION_MS = 2500;

type ToastState = { id: number; text: string } | null;

/**
 * Aviso corto ("Tomate agregado al carrito"). Cada aviso tiene un id para que la
 * animación arranque de nuevo aunque el texto se repita (sumar dos veces lo mismo).
 */
export function useToast() {
  const [toast, setToast] = useState<ToastState>(null);
  const counter = useRef(0);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const showToast = useCallback((text: string) => {
    counter.current += 1;
    setToast({ id: counter.current, text });
  }, []);

  return { toast, showToast };
}

type ToastProps = {
  toast: ToastState;
  /**
   * Con el carrito abierto el aviso sube y queda debajo del encabezado del panel:
   * abajo tapaba el subtotal, el envío y el total del pie. No se oculta porque a
   * veces dice algo que no se ve en otro lado ("2 productos sin stock hoy").
   */
  overCart?: boolean;
};

export function Toast({ toast, overCart = false }: ToastProps) {
  // El contenedor role="status" queda siempre montado: los lectores de pantalla
  // solo anuncian cambios dentro de una región que ya existía.
  return (
    <div className={`toast-region ${overCart ? 'is-over-cart' : ''}`} role="status" aria-live="polite">
      {toast ? (
        <div className="toast" key={toast.id}>
          <CircleCheck size={18} aria-hidden="true" /> {toast.text}
        </div>
      ) : null}
    </div>
  );
}

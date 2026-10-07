import type { ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';

/**
 * Piezas chicas de formulario del panel: etiqueta + campo + ayuda + error, con
 * los aria-* conectados para que el error se lea junto al campo.
 */

/** Props de accesibilidad para el input de un Field con ese id. */
export function fieldAria(id: string, { hint, error }: { hint?: ReactNode; error?: string }) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ');
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
  } as const;
}

type FieldProps = {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
};

export function Field({ id, label, hint, error, className, children }: FieldProps) {
  return (
    <div className={['adm-field', error ? 'adm-field--invalid' : '', className ?? ''].filter(Boolean).join(' ')}>
      <label className="adm-label" htmlFor={id}>{label}</label>
      {children}
      {hint ? <p className="adm-hint" id={`${id}-hint`}>{hint}</p> : null}
      {error ? <p className="adm-field-error" id={`${id}-error`}>{error}</p> : null}
    </div>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <LoaderCircle size={size} className="adm-spin" aria-hidden="true" />;
}

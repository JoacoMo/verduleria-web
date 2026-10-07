'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** Copia al portapapeles. navigator.clipboard no existe en todos los navegadores viejos. */
async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Sigue con el método viejo.
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/** Botón "Copiar" para el alias y el CBU (copiarlos a mano en el celular es un sufrimiento). */
export default function CopyButton({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (status === 'idle') return;
    const timeout = window.setTimeout(() => setStatus('idle'), 2500);
    return () => window.clearTimeout(timeout);
  }, [status]);

  return (
    <button
      type="button"
      className={`copy-btn ${status === 'copied' ? 'is-copied' : ''}`}
      onClick={async () => setStatus((await copyText(value)) ? 'copied' : 'failed')}
      aria-label={`Copiar ${label}`}
    >
      {status === 'copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      <span aria-live="polite">
        {status === 'copied' ? 'Copiado' : status === 'failed' ? 'Copialo a mano' : 'Copiar'}
      </span>
    </button>
  );
}

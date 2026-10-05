'use client';

import './admin/admin.css';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Lock, LogIn } from 'lucide-react';
import { ADMIN_API, ADMIN_ROUTES } from '@/lib/routes';
import { InlineAlert } from './admin/notices';
import { Spinner } from './admin/fields';
import { NETWORK_ERROR_MESSAGE, errorFromBody, retryAfterSeconds } from './admin/api';

type LoginPageProps = {
  /** Nombre del local (lo pasa la página desde siteConfig). */
  storeName?: string;
};

/** Mensaje del 429 con los minutos que faltan, si el servidor los mandó. */
function tooManyAttemptsMessage(response: Response, body: unknown) {
  const seconds = retryAfterSeconds(response);
  if (!seconds) {
    return errorFromBody(body, 'Demasiados intentos. Esperá unos minutos y probá de nuevo.');
  }
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Demasiados intentos fallidos. Probá de nuevo en ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`;
}

/**
 * Ingreso al panel (/trastienda).
 *
 * El login responde con una cookie httpOnly: este componente nunca ve el token
 * y no guarda nada en el navegador. Si ya hay una sesión vigente, se pasa
 * directo al panel.
 */
export default function LoginPage({ storeName = 'El Pampa' }: LoginPageProps) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Restos de la sesión vieja (token en localStorage): ya no se usa.
    try {
      window.localStorage.removeItem('adminToken');
    } catch {
      // Almacenamiento bloqueado: no hay nada que limpiar.
    }

    let cancelled = false;
    fetch(`${ADMIN_API}/session`, { cache: 'no-store', credentials: 'same-origin' })
      .then((response) => {
        if (!cancelled && response.ok) router.replace(ADMIN_ROUTES.panel);
      })
      .catch(() => {
        // Sin conexión: se queda en el formulario y el error aparece al intentar entrar.
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError('');

    if (!username.trim() || !password) {
      setError('Completá el usuario y la contraseña.');
      return;
    }

    setSubmitting(true);
    let response: Response;
    try {
      response = await fetch(`${ADMIN_API}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ username, password }),
      });
    } catch (fetchError) {
      console.error('Error al iniciar sesión:', fetchError);
      setSubmitting(false);
      setError(NETWORK_ERROR_MESSAGE);
      return;
    }

    const body: unknown = await response.json().catch(() => null);

    if (response.ok) {
      // Se deja el botón en "Ingresando…" mientras navega.
      router.replace(ADMIN_ROUTES.panel);
      return;
    }

    setSubmitting(false);
    if (response.status === 429) {
      setError(tooManyAttemptsMessage(response, body));
    } else if (response.status === 401) {
      setError(errorFromBody(body, 'Usuario o contraseña incorrectos.'));
      setPassword('');
      passwordRef.current?.focus();
    } else {
      setError(errorFromBody(body, 'No se pudo iniciar sesión. Probá de nuevo en un rato.'));
    }
  }

  return (
    <main className="adm-page adm-login">
      <div className="adm-login__card">
        <p className="adm-brand adm-login__brand">{storeName}</p>
        <h1 className="adm-login__title"><Lock size={20} aria-hidden="true" /> Ingreso al panel</h1>

        <form onSubmit={handleSubmit} noValidate>
          <div className="adm-field">
            <label className="adm-label" htmlFor="login-username">Usuario</label>
            <input
              id="login-username"
              className="adm-input"
              type="text"
              required
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>

          <div className="adm-field">
            <label className="adm-label" htmlFor="login-password">Contraseña</label>
            <div className="adm-password">
              <input
                id="login-password"
                ref={passwordRef}
                className="adm-input"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="adm-password__toggle"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            </div>
          </div>

          {error ? <InlineAlert>{error}</InlineAlert> : null}

          <button type="submit" className="adm-btn adm-btn--primary adm-btn--block" disabled={submitting}>
            {submitting ? <Spinner /> : <LogIn size={18} aria-hidden="true" />}
            {submitting ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </div>
    </main>
  );
}

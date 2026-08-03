'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (localStorage.getItem('adminToken')) {
      router.replace('/panel');
    }
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Usuario o contraseña incorrectos.');
        return;
      }

      localStorage.setItem('adminToken', data.token);
      router.push('/panel');
    } catch (error) {
      console.error('Error al iniciar sesión:', error);
      setError('No se pudo conectar con el servidor.');
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-shell">
        <h1>Panel de Administración</h1>
        <div className="form-container">
          <h2>Iniciar sesión</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="username">Usuario:</label>
              <input id="username" type="text" required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="password">Contraseña:</label>
              <input id="password" type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            {error ? <p style={{ color: '#e74c3c' }}>{error}</p> : null}
            <div className="form-buttons">
              <button type="submit" id="login-btn">Ingresar</button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
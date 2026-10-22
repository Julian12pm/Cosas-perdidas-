import { useId, useState } from 'react';
import { INSTITUTIONAL_DOMAINS, MOCK_SESSION, isInstitutionalEmail } from '../data.js';

/*
 * El acceso es institucional: no hay registro anónimo ni contraseña, sólo un
 * enlace de un solo uso al buzón del campus. El formulario nunca acepta un
 * dominio que el API no aceptaría, y cuando no hay API configurada la
 * pantalla ofrece una sesión de demostración para que la interfaz siga siendo
 * usable antes de que el servidor exista.
 */

const API_URL = import.meta.env.VITE_API_URL ?? '';

const IconPin = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z" />
  </svg>
);

export default function LoginScreen({ onAuthenticated }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle | sending | sent | error
  const [message, setMessage] = useState('');

  const emailId = useId();
  const hintId = useId();
  const statusId = useId();

  const demoMode = API_URL.length === 0;

  const handleSubmit = async (event) => {
    event.preventDefault();
    const address = email.trim();

    if (!isInstitutionalEmail(address)) {
      setStatus('error');
      setMessage(
        `El acceso es sólo para el correo institucional delTECNM: termina en ${INSTITUTIONAL_DOMAINS.map((domain) => `@${domain}`).join(' o ')}.`,
      );
      return;
    }

    setStatus('sending');
    setMessage('Enviando el enlace de acceso…');

    if (demoMode) {
      setStatus('sent');
      setMessage('Modo demostración: no hay API configurada, así que no se envió ningún correo.');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/auth/magic-link`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: address }),
      });

      if (!response.ok) {
        setStatus('error');
        setMessage('No pudimos enviar el enlace. Inténtalo de nuevo en unos minutos.');
        return;
      }

      setStatus('sent');
      setMessage(`Enviamos el enlace a ${address}. Vence en 15 minutos y sirve una sola vez.`);
    } catch {
      setStatus('error');
      setMessage('No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.');
    }
  };

  const enterDemo = () => {
    onAuthenticated({ ...MOCK_SESSION, email: email.trim() || MOCK_SESSION.email });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-900 p-4 text-white font-sans">
      <div className="w-full max-w-md rounded-2xl border border-surface-600/50 bg-surface-800 p-6 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500">
            <IconPin />
          </div>
          <div>
            <h1 className="text-xl font-bold text-brand-300">Objetos Perdidos</h1>
            <p className="text-sm text-text-muted">Acceso institucional · Campus ITM</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor={emailId} className="mb-1.5 block text-sm font-medium text-surface-300">
              Correo institucional
            </label>
            <input
              id={emailId}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              spellCheck="false"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (status !== 'idle') {
                  setStatus('idle');
                  setMessage('');
                }
              }}
              placeholder="L2030451@morelia.tecnm.mx"
              aria-describedby={`${hintId} ${statusId}`}
              aria-invalid={status === 'error'}
              className="w-full rounded-xl border border-input-border bg-surface-700/50 px-4 py-3 text-white placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-focus"
            />
            <p id={hintId} className="mt-1.5 text-xs leading-relaxed text-text-muted">
              La cuenta es institucional: sólo aceptamos buzones de{' '}
              {INSTITUTIONAL_DOMAINS.map((domain) => `@${domain}`).join(' o ')}. Te enviamos un
              enlace de un solo uso, sin contraseña y sin registro anónimo.
            </p>
          </div>

          <p
            id={statusId}
            role={status === 'error' ? 'alert' : 'status'}
            aria-live={status === 'error' ? 'assertive' : 'polite'}
            className={`text-sm ${status === 'error' ? 'text-red-400' : 'text-surface-300'}`}
          >
            {message}
          </p>

          <button
            type="submit"
            disabled={status === 'sending'}
            className="w-full cursor-pointer rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 px-4 py-3 font-semibold text-surface-900 shadow-lg transition-all hover:from-brand-400 hover:to-brand-500 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
          >
            {status === 'sending' ? 'Enviando…' : 'Recibir enlace'}
          </button>
        </form>

        {demoMode && (
          <div className="mt-5 rounded-xl border border-surface-600/50 bg-surface-700/30 p-3">
            <p className="text-xs leading-relaxed text-surface-300">
              La API no está configurada (<code className="text-brand-300">VITE_API_URL</code>), así
              que el acceso es de demostración y los datos son los de arranque.
            </p>
            {status === 'sent' && (
              <button
                type="button"
                onClick={enterDemo}
                className="mt-3 w-full cursor-pointer rounded-xl border border-brand-500/40 bg-brand-500/10 px-4 py-2.5 text-sm font-semibold text-brand-200 transition-colors hover:bg-brand-500/20 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              >
                Entrar con la sesión de demostración
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

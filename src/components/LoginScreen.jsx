import { useId, useState } from 'react';
import { MapPointIcon } from '@solar-icons/react/bold/map-point';
import { INSTITUTIONAL_DOMAINS, MOCK_SESSION, isInstitutionalEmail } from '../data.js';
import { isApiConfigured, requestMagicLink } from '../api.js';

/*
 * El acceso es institucional: no hay registro anónimo ni contraseña, sólo un
 * enlace de un solo uso al buzón del campus. El formulario nunca acepta un
 * dominio que el API no aceptaría, y cuando no hay API configurada la
 * pantalla ofrece una sesión de demostración para que la interfaz siga siendo
 * usable antes de que el servidor exista.
 */

/** Lo que dice la pantalla cuando el servidor ya no reconoce la sesión. */
const EXPIRED_MESSAGE =
  'Tu sesión venció. Vuelve a entrar con tu correo institucional para seguir.';

/** El dominio institucional, en el texto que el estudiante lee. */
const DOMAIN_HINT = INSTITUTIONAL_DOMAINS.map((domain) => `@${domain}`).join(' o ');

export default function LoginScreen({ onAuthenticated, expired = false, offline = false }) {
  const [email, setEmail] = useState('');
  // idle | sending | sent | error | expired
  const [status, setStatus] = useState(expired ? 'expired' : 'idle');
  const [message, setMessage] = useState(expired ? EXPIRED_MESSAGE : '');

  const emailId = useId();
  const hintId = useId();
  const statusId = useId();

  const demoMode = !isApiConfigured();
  const failed = status === 'error' || status === 'expired';

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
      await requestMagicLink(address);
      setStatus('sent');
      setMessage(`Enviamos el enlace a ${address}. Vence en 15 minutos y sirve una sola vez.`);
    } catch (error) {
      setStatus('error');
      // El cliente sabe qué pasó: sin red no es un fallo del servidor, y un
      // buzón que no es institucional se dice como lo que es.
      if (error?.kind === 'offline') {
        setMessage('No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.');
      } else if (error?.payload?.error === 'not_institutional') {
        setMessage(
          `El acceso es sólo para el correo institucional del TECNM: termina en ${DOMAIN_HINT}.`,
        );
      } else {
        setMessage('No pudimos enviar el enlace. Inténtalo de nuevo en unos minutos.');
      }
    }
  };

  const enterDemo = () => {
    onAuthenticated({ ...MOCK_SESSION, email: email.trim() || MOCK_SESSION.email });
  };

  return (
    <main className="flex flex-1 items-center justify-center bg-surface-900 p-4 text-white font-sans">
      <div className="surface-panel w-full max-w-md p-5 sm:p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500">
            <MapPointIcon size={24} aria-hidden="true" />
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
              data-testid="login-email"
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
              className="min-h-[44px] w-full rounded-xl border border-input-border bg-surface-700/50 px-4 py-3 text-base text-white placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-focus"
            />
            <p id={hintId} className="mt-1.5 text-xs leading-relaxed text-text-muted">
              La cuenta es institucional: sólo aceptamos buzones de {DOMAIN_HINT}. Te enviamos un
              enlace de un solo uso, sin contraseña y sin registro anónimo.
            </p>
          </div>

          <p
            id={statusId}
            data-testid="login-status"
            role={failed ? 'alert' : 'status'}
            aria-live={failed ? 'assertive' : 'polite'}
            className={`text-sm ${failed ? 'text-red-400' : 'text-surface-300'}`}
          >
            {message}
          </p>

          <button
            type="submit"
            data-testid="login-submit"
            disabled={status === 'sending' || offline}
            className="min-h-[44px] w-full cursor-pointer rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 px-4 py-3 font-semibold text-surface-900 shadow-panel transition-all hover:from-brand-400 hover:to-brand-500 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
          >
            {status === 'sending' ? 'Enviando…' : 'Recibir enlace'}
          </button>
        </form>

        {demoMode && (
          <div className="surface-inset mt-5 p-3">
            <p className="text-xs leading-relaxed text-surface-300">
              La API no está configurada (<code className="text-brand-300">VITE_API_URL</code>), así
              que el acceso es de demostración y los datos son los de arranque.
            </p>
            {status === 'sent' && (
              <button
                type="button"
                data-testid="login-demo"
                onClick={enterDemo}
                className="mt-3 min-h-[44px] w-full cursor-pointer rounded-xl border border-brand-500/40 bg-brand-500/10 px-4 py-2.5 text-sm font-semibold text-brand-200 transition-colors hover:bg-brand-500/20 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
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

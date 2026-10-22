import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { CheckCircleIcon } from '@solar-icons/react/bold/check-circle';
import { ClockCircleIcon } from '@solar-icons/react/bold/clock-circle';
import { FolderIcon } from '@solar-icons/react/bold/folder';
import { InboxIcon } from '@solar-icons/react/bold/inbox';
import { LockKeyholeIcon } from '@solar-icons/react/bold/lock-keyhole';
import { LockUnlockedIcon } from '@solar-icons/react/bold/lock-unlocked';
import { LogoutIcon } from '@solar-icons/react/bold/logout';
import { MapIcon } from '@solar-icons/react/bold/map';
import { MapPointIcon } from '@solar-icons/react/bold/map-point';
import { QuestionCircleIcon } from '@solar-icons/react/bold/question-circle';
import { ShieldCheckIcon } from '@solar-icons/react/bold/shield-check';
import { UserIcon } from '@solar-icons/react/bold/user';
import CampusMap from './components/CampusMap.jsx';
import ClaimInbox from './components/ClaimInbox.jsx';
import ContactCard from './components/ContactCard.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import Modal from './components/Modal.jsx';
import MyReports from './components/MyReports.jsx';
import OfflineBanner from './components/OfflineBanner.jsx';
import ReportForm from './components/ReportForm.jsx';
import ZoneLegend from './components/ZoneLegend.jsx';
import ZonePicker from './components/ZonePicker.jsx';
import { ErrorState, LoadingState } from './components/StateMessage.jsx';
import {
  RELEASE_KEY_LENGTH,
  RELEASE_KEY_MAX_ATTEMPTS,
  contactFor,
  copyToClipboard,
  formatAge,
  generateUnlockCode,
  loadCampusData,
  reporterAlias,
} from './data.js';
import { artworkToPercent, polygonCentroid, zoneAtPoint } from './map/geometry.js';
import { MAP_IMAGE, ZONES } from './map/zones.js';

/*
 * Objetos Perdidos ITM: el croquis, los reportes y el protocolo de entrega.
 *
 * El acceso es institucional y el reporte lo publica el estudiante que entró,
 * nunca un nombre escrito a mano. Nada se borra: un caso se cierra y el
 * reporte sigue en "Mis reportes".
 */

const API_URL = import.meta.env.VITE_API_URL ?? '';

/** Los estados en los que un reporte sigue en el mapa. */
const ON_MAP_STATUSES = new Set(['open', 'pending_claim', 'in_custody']);

/** Dónde se guarda la sesión de demostración entre recargas. */
const SESSION_KEY = 'objetos-perdidos:session';

/* ────────────────────────── Componente Pin ────────────────────────── */
function MapPin({ report, onClick }) {
  const isLost = report.type === 'lost';
  const shortItem = report.item.length > 25 ? `${report.item.slice(0, 25)}...` : report.item;

  return (
    <button
      type="button"
      // El gesto del mapa no debeontinuar cuando el toque fue sobre un pin.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onClick(report);
      }}
      className="pointer-events-auto absolute z-10 origin-bottom -translate-x-1/2 -translate-y-full animate-pin-drop cursor-pointer group focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
      // El pin se mide contra el plano que lo sostiene: --pin-scale lo reduce
      // cuando el croquis es pequeño (un teléfono) para no tapar el edificio.
      style={{ left: `${report.x}%`, top: `${report.y}%`, scale: 'var(--pin-scale, 1)' }}
      title={`${isLost ? 'Perdido' : 'Encontrado'}: ${report.item}${report.zoneLabel ? ` · ${report.zoneLabel}` : ''}`}
      aria-label={`Pin ${isLost ? 'perdido' : 'encontrado'}: ${report.item}${report.zoneLabel ? ` en ${report.zoneLabel}` : ''}`}
    >
      <div className="absolute bottom-0 left-1/2 h-1.5 w-3 -translate-x-1/2 translate-y-1 rounded-full bg-black/40 blur-sm" />
      <div className="relative flex flex-col items-center">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-full border-2 border-white/80 shadow-lg transition-all duration-300 group-hover:scale-125 group-hover:shadow-xl ${
            isLost ? 'bg-pin-red animate-pin-pulse' : 'bg-pin-green animate-pin-pulse-green'
          }`}
        >
          <span className="text-xs font-bold text-white drop-shadow">{isLost ? '?' : '✓'}</span>
        </div>
        <div
          className={`-mt-0.5 h-0 w-0 border-l-[6px] border-r-[6px] border-l-transparent border-r-transparent ${
            isLost ? 'border-t-[8px] border-t-pin-red' : 'border-t-[8px] border-t-pin-green'
          }`}
        />
      </div>
      <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-surface-900/95 px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-xl backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100">
        <span
          className={`inline-flex items-center gap-1 ${isLost ? 'text-red-400' : 'text-green-400'}`}
        >
          {isLost ? (
            <QuestionCircleIcon size={16} aria-hidden="true" />
          ) : (
            <CheckCircleIcon size={16} aria-hidden="true" />
          )}
          {isLost ? 'Perdido' : 'Encontrado'}
        </span>
        <span className="ml-1 text-surface-300">· {shortItem}</span>
        {report.zoneLabel && (
          <span className="ml-1 inline-flex items-center gap-1 text-brand-300">
            ·<MapPointIcon size={16} aria-hidden="true" />
            {report.zoneLabel}
          </span>
        )}
        <div className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-surface-900/95" />
      </div>
    </button>
  );
}

/* ─────────────────── Marcador de la posición elegida ─────────────────── */
function PendingMarker({ point }) {
  return (
    <div
      className="pointer-events-none absolute z-20 h-6 w-6 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${point.x}%`, top: `${point.y}%` }}
      aria-hidden="true"
    >
      <div className="h-full w-full animate-ping rounded-full border-2 border-brand-400 bg-brand-400/20" />
      <div className="absolute inset-1 rounded-full bg-brand-400" />
    </div>
  );
}

/* ────────────────── Identidad de quien publica el reporte ────────────────── */
// La identidad la pone la sesión: el correo institucional, nunca un nombre
// escrito a mano. La tarjeta del formulario la muestra al que publica.

/* ──────────────── Modal: Elegir tipo de pin ──────────────── */
function PinTypeModal({ pending, onClose, onSelect }) {
  return (
    <Modal
      open
      onClose={onClose}
      title="Nuevo marcador"
      description="¿Qué deseas reportar?"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="w-full cursor-pointer rounded-xl border border-surface-600/60 px-4 py-2 text-sm font-semibold text-surface-200 transition-colors hover:bg-surface-700/60 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          Cancelar
        </button>
      }
    >
      <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-surface-700/40 p-2.5 text-sm text-surface-300">
        <MapPointIcon size={16} className="shrink-0" aria-hidden="true" />
        Se marcará en:{' '}
        <span className="font-semibold text-white">{pending?.zone?.label ?? 'terreno libre'}</span>
      </p>

      <div className="space-y-3">
        <button
          type="button"
          data-testid="report-type-lost"
          onClick={() => onSelect('lost')}
          className="group flex w-full cursor-pointer items-center gap-4 rounded-xl border border-red-500/20 bg-red-500/10 p-4 transition-all duration-300 hover:border-red-500/40 hover:bg-red-500/20 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-pin-red shadow-lg shadow-red-500/25 transition-transform group-hover:scale-110">
            <span className="text-lg text-white">?</span>
          </div>
          <div className="text-left">
            <h3 className="flex items-center gap-1.5 text-base font-semibold text-white">
              <QuestionCircleIcon size={16} className="shrink-0 text-danger" aria-hidden="true" />
              Perdí algo aquí
            </h3>
            <p className="text-sm text-red-300/70">Marca el lugar donde perdiste tu objeto</p>
          </div>
        </button>

        <button
          type="button"
          data-testid="report-type-found"
          onClick={() => onSelect('found')}
          className="group flex w-full cursor-pointer items-center gap-4 rounded-xl border border-green-500/20 bg-green-500/10 p-4 transition-all duration-300 hover:border-green-500/40 hover:bg-green-500/20 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-pin-green shadow-lg shadow-green-500/25 transition-transform group-hover:scale-110">
            <span className="text-lg text-white">✓</span>
          </div>
          <div className="text-left">
            <h3 className="flex items-center gap-1.5 text-base font-semibold text-white">
              <CheckCircleIcon size={16} className="shrink-0 text-success" aria-hidden="true" />
              Encontré algo aquí
            </h3>
            <p className="text-sm text-green-300/70">
              Reporta un objeto encontrado de forma segura
            </p>
          </div>
        </button>
      </div>
    </Modal>
  );
}

/* ──────────────── Modal: Formulario del reporte ──────────────── */
// El mismo formulario para el pin rojo y para el verde: sólo cambian el copy,
// el dato ciego que pide el verde y el color del botón.
function ReportModal({ kind, session, onClose, onSubmit, offline = false }) {
  const isFound = kind === 'found';

  return (
    <Modal
      open
      onClose={onClose}
      title={isFound ? 'Objeto encontrado' : 'Reportar objeto perdido'}
      description={
        <span className="inline-flex items-center gap-1.5">
          {isFound ? (
            <CheckCircleIcon size={16} className="shrink-0 text-success" aria-hidden="true" />
          ) : (
            <QuestionCircleIcon size={16} className="shrink-0 text-danger" aria-hidden="true" />
          )}
          {isFound
            ? 'Pin verde: publica el hallazgo, no los detalles.'
            : 'Pin rojo: el dueño del objeto es quien publica el reporte.'}
        </span>
      }
    >
      {isFound && (
        <div className="mb-4 flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5">
          <div className="mt-0.5 flex-shrink-0">
            <ShieldCheckIcon size={16} aria-hidden="true" />
          </div>
          <p className="text-xs leading-relaxed text-amber-200/80">
            <strong>Reporte ciego:</strong> lo que todos leen va en la descripción pública; la
            marca, el color o lo que hay dentro van en el dato ciego, que sólo tú ves.
          </p>
        </div>
      )}

      <ReportForm kind={kind} session={session} onSubmit={onSubmit} offline={offline} />
    </Modal>
  );
}

/* ─────────── Modal: la clave de liberación, recién creada ─────────── */
function ReleaseKeyModal({ report, onClose }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    setCopied(await copyToClipboard(report.releaseKey));
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Tu clave de liberación"
      description="Cópiala: es la que dicta el dueño del objeto perdido."
      testId="release-key-dialog"
    >
      <div className="rounded-xl border border-brand-500/30 bg-brand-500/10 p-4 text-center">
        <p
          data-testid="release-key-value"
          className="font-mono text-3xl tracking-[0.4em] text-white sm:text-4xl"
        >
          {report.releaseKey}
        </p>
        <button
          type="button"
          data-testid="release-key-copy"
          onClick={copy}
          className="mt-3 min-h-[44px] cursor-pointer rounded-lg border border-brand-500/40 px-3 py-2 text-xs font-semibold text-brand-200 transition-colors hover:bg-brand-500/20 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          {copied ? 'Clave copiada' : 'Copiar clave'}
        </button>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-text-muted">
        El pin no sale del mapa hasta que el estudiante que tiene el objeto teclee esta clave en su
        app y confirme la entrega. La clave queda en “Mis reportes”, pero no se le muestra a nadie
        más.
      </p>
    </Modal>
  );
}

/* ──────────────── Modal: detalle del reporte ──────────────── */
// El panel se exporta para poder renderizarlo aislado en las pruebas.
export function PinInfoModal({ report, session, linked, claims, onClose, onResolve, onAttempt }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const codeId = useId();

  const isLost = report.type === 'lost';
  const isMine = report.ownerId === session.id;
  const approved = claims.find((claim) => claim.status === 'approved' && claim.contact);

  // Los intentos viven en el reporte de la clave: es la pareja (clave, portador)
  // quien los quema, y nunca se bloquea la clave del dueño.
  const keyReport = isLost ? report : linked;
  const attemptsLeft = keyReport
    ? Math.max(0, (keyReport.releaseMaxAttempts ?? 0) - (keyReport.releaseAttempts ?? 0))
    : 0;

  const copy = async () => {
    setCopied(await copyToClipboard(report.releaseKey));
  };

  const submitKey = () => {
    if (!linked?.releaseKey) return;

    if (code !== linked.releaseKey) {
      onAttempt(linked.id);
      const left = Math.max(0, attemptsLeft - 1);
      setCode('');
      setError(
        left === 0
          ? 'Clave incorrecta. Se agotaron los intentos.'
          : `Clave incorrecta. ${left === 1 ? 'Te queda' : 'Te quedan'} ${left} ${left === 1 ? 'intento' : 'intentos'}.`,
      );
      return;
    }

    setError('');
    setConfirming(true);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={report.item}
      description={
        <span className="inline-flex items-center gap-1.5">
          {isLost ? (
            <QuestionCircleIcon size={16} className="shrink-0 text-danger" aria-hidden="true" />
          ) : (
            <CheckCircleIcon size={16} className="shrink-0 text-success" aria-hidden="true" />
          )}
          {isLost ? 'Perdido' : 'Encontrado'} · {report.zoneLabel ?? 'Terreno libre'}
        </span>
      }
    >
      <div className="space-y-3">
        {report.description && (
          <p className="rounded-xl border border-surface-600/30 bg-surface-700/30 p-3 text-sm text-surface-300">
            {report.description}
          </p>
        )}

        <div className="flex flex-wrap justify-between gap-2 text-xs text-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <UserIcon size={16} className="shrink-0" aria-hidden="true" />
            {isMine ? 'Tú' : report.alias}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ClockCircleIcon size={16} className="shrink-0" aria-hidden="true" />
            {formatAge(report.timestamp)}
          </span>
        </div>

        {isMine && !isLost && report.blindDetail && (
          <div className="rounded-xl border border-surface-600/50 bg-surface-700/40 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-surface-300">
              Dato ciego (sólo tú lo ves)
            </p>
            <p className="mt-1 text-sm text-surface-200">{report.blindDetail}</p>
          </div>
        )}

        {approved && (
          <ContactCard contact={approved.contact} claimId={approved.id} single={false} />
        )}

        {isMine && isLost && (
          <div className="rounded-xl border border-brand-500/30 bg-brand-500/10 p-3">
            <div className="flex items-center gap-2">
              <LockKeyholeIcon size={16} className="shrink-0" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-white">Tu clave de liberación</h3>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-surface-300">
              Tú dictas esta clave al estudiante que tiene el objeto: él la teclea para confirmar la
              entrega.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="font-mono text-xl tracking-[0.35em] text-white">
                {report.releaseKey}
              </span>
              <button
                type="button"
                onClick={copy}
                className="min-h-[44px] cursor-pointer rounded-lg border border-surface-600/60 px-3 py-2 text-xs text-surface-200 transition-colors hover:bg-surface-700/60 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              >
                {copied ? 'Clave copiada' : 'Copiar clave'}
              </button>
            </div>
            <p className="mt-2 text-xs text-text-muted">
              Le quedan {attemptsLeft} de {report.releaseMaxAttempts} intentos a quien tiene el
              objeto.
            </p>
          </div>
        )}

        {isMine && !isLost && linked && (
          <div className="rounded-xl border border-brand-500/30 bg-brand-500/10 p-3">
            <div className="flex items-center gap-2">
              <LockKeyholeIcon size={16} className="shrink-0" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-white">Confirmar la entrega</h3>
            </div>

            {confirming ? (
              <div className="mt-2">
                <p className="text-sm leading-relaxed text-surface-200">
                  ¿Confirmas que la entrega se realizó? El reporte se cerrará como resuelto y el pin
                  sale del mapa. Nada se borra: seguirá en “Mis reportes”.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onResolve(report.id)}
                    className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-green-600 to-green-700 px-4 py-2 text-sm font-semibold text-white transition-all hover:from-green-500 hover:to-green-600 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                  >
                    <CheckCircleIcon size={16} className="shrink-0" aria-hidden="true" />
                    Sí, la entrega se realizó
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="min-h-[44px] cursor-pointer rounded-xl border border-surface-600/60 px-4 py-2 text-sm font-semibold text-surface-200 transition-colors hover:bg-surface-700/60 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-2">
                <p className="text-xs leading-relaxed text-surface-300">
                  El dueño te dicta la clave: escríbela aquí para confirmar que la entrega se
                  realizó.
                </p>
                <label htmlFor={codeId} className="sr-only">
                  Clave de liberación
                </label>
                {error && (
                  <p id={`${codeId}-error`} role="alert" className="mt-2 text-xs text-red-400">
                    {error}
                  </p>
                )}
                <p className="mt-2 text-xs text-text-muted">
                  Te quedan {attemptsLeft} de {linked.releaseMaxAttempts} intentos.
                </p>
                {/* La acción se queda pegada al borde inferior del diálogo: con el
                    teclado abierto el botón no puede quedar debajo del pliegue. */}
                <div className="sticky bottom-0 z-10 mt-2 flex gap-2 bg-surface-800 py-2">
                  <input
                    id={codeId}
                    data-testid="release-key-input"
                    type="text"
                    inputMode="numeric"
                    maxLength={RELEASE_KEY_LENGTH}
                    value={code}
                    onChange={(event) => {
                      setCode(event.target.value.replace(/\D/g, ''));
                      setError('');
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && code.length === RELEASE_KEY_LENGTH) {
                        event.preventDefault();
                        submitKey();
                      }
                    }}
                    placeholder={'• '.repeat(RELEASE_KEY_LENGTH).trim()}
                    aria-describedby={error ? `${codeId}-error` : undefined}
                    className={`min-h-[44px] w-full rounded-xl border bg-surface-700/50 px-4 py-3 text-center font-mono text-xl tracking-[0.5em] text-white focus:outline-none focus:ring-2 focus:ring-focus transition-all ${
                      error
                        ? 'animate-shake border-red-500 bg-red-500/10'
                        : 'border-input-border focus:border-brand-500'
                    }`}
                  />
                  <button
                    type="button"
                    data-testid="release-key-submit"
                    onClick={submitKey}
                    disabled={code.length !== RELEASE_KEY_LENGTH}
                    aria-label="Confirmar la entrega con la clave"
                    className="min-h-[44px] shrink-0 cursor-pointer rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 px-5 py-3 font-semibold text-surface-900 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                  >
                    <LockUnlockedIcon size={20} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {isMine && !isLost && !linked && (
          <p className="rounded-xl border border-surface-600/40 bg-surface-700/30 p-3 text-xs leading-relaxed text-text-muted">
            Cuando el dueño apruebe tu reclamo te dictará la clave para confirmar la entrega.
          </p>
        )}
      </div>
    </Modal>
  );
}

/* ───────────────────── Botón de navegación del encabezado ───────────────────── */
function NavButton({ active, children, ...rest }) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      className={`inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none sm:text-sm ${
        active
          ? 'bg-brand-500/20 text-brand-200'
          : 'text-surface-300 hover:bg-surface-700/60 hover:text-white'
      }`}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ───────────────────────────── Sesión ───────────────────────────── */

/** La sesión de demostración se guarda entre recargas; con API manda la cookie. */
function readStoredSession() {
  if (API_URL.length > 0) return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storeSession(session) {
  if (API_URL.length > 0) return;
  try {
    if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // Sin almacenamiento la sesión vive sólo en memoria.
  }
}

/**
 * Una petición al API. Un 401 significa que la sesión ya no vale: la app
 * vuelve al acceso con un aviso, en lugar de quedarse en silencio.
 */
async function apiFetch(path, onUnauthorized) {
  const response = await fetch(`${API_URL}${path}`, { credentials: 'include' });
  if (response.status === 401) onUnauthorized?.();
  return response;
}

/** El navegador sabe si hay conexión, y avisa cuando la hay o deja de haberla. */
function useOnline() {
  const [online, setOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine !== false,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━ APP PRINCIPAL ━━━━━━━━━━━━━━━━━━━━━━━━ */
export default function App() {
  const [session, setSession] = useState(() => readStoredSession());
  const [checking, setChecking] = useState(API_URL.length > 0);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [reports, setReports] = useState([]);
  const [claims, setClaims] = useState([]);
  // loading | ready | error
  const [campus, setCampus] = useState('loading');
  const [view, setView] = useState('map');
  const [modal, setModal] = useState(null);
  const [pending, setPending] = useState(null);
  // La zona que la leyenda está iluminando en el croquis.
  const [highlightZoneId, setHighlightZoneId] = useState(null);
  const online = useOnline();

  /** El servidor ya no reconoce la sesión: se vuelve al acceso, avisando. */
  const handleUnauthorized = useCallback(() => {
    setSessionExpired(true);
    setSession(null);
    storeSession(null);
    // Los datos del estudiante anterior no se quedan en pantalla: la sesión
    // siguiente no debe ver un solo instante lo que publicó otro.
    setReports([]);
    setClaims([]);
    setCampus('loading');
    setView('map');
    setModal(null);
    setPending(null);
  }, []);

  // Con API configurada la cookie es la sesión: se recupera al cargar.
  useEffect(() => {
    if (API_URL.length === 0) return undefined;

    let cancelled = false;
    const restore = async () => {
      try {
        const response = await apiFetch('/auth/me', () => {
          if (!cancelled) handleUnauthorized();
        });
        if (!response.ok) return;
        const user = await response.json();
        if (!cancelled) setSession(user);
      } catch {
        // Sin API alcanzable la pantalla de acceso explica el modo demostración.
      } finally {
        if (!cancelled) setChecking(false);
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, [handleUnauthorized]);

  const handleAuthenticated = useCallback((next) => {
    setSession(next);
    setSessionExpired(false);
    storeSession(next);
  }, []);

  /** Los datos del campus: se piden y, si fallan, la pantalla lo dice. */
  const loadCampus = useCallback(async () => {
    // Un refresco no borra lo que ya está en pantalla: el croquis se queda
    // mientras llegan los datos nuevos.
    setCampus((previous) => (previous === 'ready' ? 'ready' : 'loading'));
    try {
      const data = await loadCampusData();
      setReports(data.reports);
      setClaims(data.claims);
      setCampus('ready');
    } catch {
      // Sin señal no es un fallo del campus: lo explica el aviso sin conexión.
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      setCampus(offline ? 'offline' : 'error');
    }
  }, []);

  useEffect(() => {
    if (!session || !online) return;
    void loadCampus();
  }, [session, online, loadCampus]);

  const handleSignOut = useCallback(async () => {
    if (API_URL.length > 0) {
      try {
        await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
      } catch {
        // La sesión local se cierra igual.
      }
    }
    setSession(null);
    storeSession(null);
    // Los reportes y los reclamos de la sesión que sale se borran de la
    // memoria: el siguiente que entre no los ve ni un instante.
    setReports([]);
    setClaims([]);
    setCampus('loading');
    setView('map');
    setModal(null);
    setPending(null);
  }, []);

  const closeModal = useCallback(() => {
    setModal(null);
    setPending(null);
  }, []);

  /** Una zona del croquis: se marca su centro y se pregunta qué se reportará. */
  const handleSelectZone = useCallback((zone) => {
    if (!zone) {
      setPending(null);
      setModal(null);
      return;
    }

    const centroid = polygonCentroid(zone.polygon);
    if (!centroid) return;

    const percent = artworkToPercent(centroid, MAP_IMAGE);
    setPending({
      x: parseFloat(percent.x.toFixed(2)),
      y: parseFloat(percent.y.toFixed(2)),
      zone: { id: zone.id, label: zone.label },
    });
    setModal({ kind: 'choose' });
  }, []);

  /** Un toque en terreno libre: se marca el punto y se pregunta qué se reportará. */
  const handlePick = useCallback((point) => {
    const zone = zoneAtPoint(point, ZONES);
    const percent = artworkToPercent(point, MAP_IMAGE);

    setPending({
      x: parseFloat(percent.x.toFixed(2)),
      y: parseFloat(percent.y.toFixed(2)),
      zone: zone ? { id: zone.id, label: zone.label } : null,
    });
    setModal({ kind: 'choose' });
  }, []);

  const handleTypeSelect = useCallback((type) => setModal({ kind: type }), []);

  const handleLostSubmit = useCallback(
    ({ item, description }) => {
      const report = {
        id: `pin-${Date.now()}`,
        type: 'lost',
        x: pending?.x ?? 0,
        y: pending?.y ?? 0,
        zoneId: pending?.zone?.id ?? null,
        zoneLabel: pending?.zone?.label ?? null,
        item,
        description,
        ownerId: session.id,
        alias: reporterAlias(session.id),
        status: 'open',
        timestamp: new Date().toISOString(),
        releaseKey: generateUnlockCode(),
        releaseAttempts: 0,
        releaseMaxAttempts: RELEASE_KEY_MAX_ATTEMPTS,
        blindDetail: null,
      };

      setReports((prev) => [report, ...prev]);
      setPending(null);
      setModal({ kind: 'release-key', report });
    },
    [pending, session],
  );

  const handleFoundSubmit = useCallback(
    ({ item, description, blindDetail }) => {
      const report = {
        id: `pin-${Date.now()}`,
        type: 'found',
        x: pending?.x ?? 0,
        y: pending?.y ?? 0,
        zoneId: pending?.zone?.id ?? null,
        zoneLabel: pending?.zone?.label ?? null,
        item,
        description,
        // El dato ciego es privado: se guarda en el reporte, nunca se publica.
        blindDetail,
        ownerId: session.id,
        alias: reporterAlias(session.id),
        status: 'open',
        timestamp: new Date().toISOString(),
        releaseKey: null,
        releaseAttempts: 0,
        releaseMaxAttempts: RELEASE_KEY_MAX_ATTEMPTS,
      };

      setReports((prev) => [report, ...prev]);
      setPending(null);
      setModal(null);
    },
    [pending, session],
  );

  /** Un intento fallido lo quema quien tiene el objeto, nunca la clave. */
  const handleAttempt = useCallback((lostReportId) => {
    setReports((prev) =>
      prev.map((report) =>
        report.id === lostReportId
          ? { ...report, releaseAttempts: (report.releaseAttempts ?? 0) + 1 }
          : report,
      ),
    );
  }, []);

  /** La entrega se realizó: el caso se cierra, pero nada se borra. */
  const handleResolve = useCallback(
    (foundReportId) => {
      const found = reports.find((report) => report.id === foundReportId);
      const closed = new Set(
        found?.linkedLostReportId ? [foundReportId, found.linkedLostReportId] : [foundReportId],
      );
      const now = new Date().toISOString();

      setReports((prev) =>
        prev.map((report) =>
          closed.has(report.id) ? { ...report, status: 'resolved', resolvedAt: now } : report,
        ),
      );
      setClaims((prev) =>
        prev.map((claim) =>
          closed.has(claim.reportId) ? { ...claim, status: 'approved' } : claim,
        ),
      );
      setModal(null);
    },
    [reports],
  );

  const handleApproveClaim = useCallback((claimId) => {
    setClaims((prev) =>
      prev.map((claim) =>
        claim.id === claimId
          ? { ...claim, status: 'approved', contact: contactFor(claim.claimantId) }
          : claim,
      ),
    );
  }, []);

  const handleRejectClaim = useCallback(
    (claimId) => {
      const claim = claims.find((entry) => entry.id === claimId);
      setClaims((prev) =>
        prev.map((entry) => (entry.id === claimId ? { ...entry, status: 'rejected' } : entry)),
      );
      // Rechazar es una acusación: el reporte vuelve a estar abierto.
      setReports((prev) =>
        prev.map((report) =>
          claim && report.id === claim.reportId && report.status === 'pending_claim'
            ? { ...report, status: 'open' }
            : report,
        ),
      );
    },
    [claims],
  );

  const handlePinClick = useCallback(
    (report) => setModal({ kind: 'info', reportId: report.id }),
    [],
  );

  const mapReports = useMemo(
    () => reports.filter((report) => ON_MAP_STATUSES.has(report.status)),
    [reports],
  );

  const myReports = useMemo(
    () => reports.filter((report) => report.ownerId === session?.id),
    [reports, session],
  );

  const pendingClaims = useMemo(
    () => claims.filter((claim) => claim.direction === 'incoming' && claim.status === 'pending'),
    [claims],
  );

  // Sin conexión manda sobre todo: el aviso vive en toda la app y ninguna
  // pantalla puede fingir que sí tiene datos frescos. Pero si no hay nada
  // guardado, el fallo se dice: un panel de error con su reintento, no un
  // croquis vacío que parece un campus sin reportes.
  const hasData = reports.length > 0 || claims.length > 0;
  const screenState = !online ? (hasData ? 'offline' : 'error') : campus;

  if (checking) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-surface-900 p-4">
        <LoadingState title="Abriendo la sesión…" />
      </main>
    );
  }

  if (!session) {
    return (
      <div className="flex min-h-dvh flex-col bg-surface-900 font-sans text-white">
        {!online && <OfflineBanner />}
        <LoginScreen
          onAuthenticated={handleAuthenticated}
          expired={sessionExpired}
          offline={!online}
        />
      </div>
    );
  }

  const lostCount = mapReports.filter((report) => report.type === 'lost').length;
  const foundCount = mapReports.filter((report) => report.type === 'found').length;
  const infoReport =
    modal?.kind === 'info'
      ? (reports.find((report) => report.id === modal.reportId) ?? null)
      : null;
  const linkedReport = infoReport?.linkedLostReportId
    ? reports.find((report) => report.id === infoReport.linkedLostReportId)
    : null;

  return (
    <div className="flex min-h-dvh flex-col bg-surface-900 font-sans text-white">
      <header className="sticky top-0 z-40 border-b border-surface-800 bg-surface-900/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500">
              <MapPointIcon size={16} aria-hidden="true" />
            </div>
            <div>
              <h1 className="font-bold text-brand-300">Objetos Perdidos</h1>
              <p className="text-xs text-text-muted">Campus ITM</p>
            </div>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3 text-sm">
            <div
              data-testid="header-lost-count"
              className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-xs text-red-300 sm:px-3 sm:text-sm"
            >
              <div className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> {lostCount} perdidos
            </div>
            <div
              data-testid="header-found-count"
              className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-green-500/20 bg-green-500/10 px-2.5 py-1 text-xs text-green-300 sm:px-3 sm:text-sm"
            >
              <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" /> {foundCount}{' '}
              encontrados
            </div>
          </div>
        </div>

        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 pb-3">
          <NavButton active={view === 'map'} onClick={() => setView('map')}>
            <MapIcon size={16} className="shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap">Mapa</span>
          </NavButton>
          <NavButton active={view === 'reports'} onClick={() => setView('reports')}>
            <FolderIcon size={16} className="shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap">Mis reportes ({myReports.length})</span>
          </NavButton>
          {/* Un solo nodo de texto: el botón es inline-flex y cada trozo suelto
              se vuelve un elemento flexible que pierde su espacio inicial. */}
          <NavButton active={view === 'inbox'} onClick={() => setView('inbox')}>
            <InboxIcon size={16} className="shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap">
              Bandeja<span className="hidden sm:inline"> de reclamos</span> ({pendingClaims.length})
            </span>
          </NavButton>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-surface-300 sm:block">
              {session.displayName || session.email} · {reporterAlias(session.id)}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-surface-600/60 px-3 py-2 text-xs font-semibold text-surface-300 transition-colors hover:bg-surface-700/60 hover:text-white focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
            >
              <LogoutIcon size={16} className="shrink-0" aria-hidden="true" />
              Salir
            </button>
          </div>
        </nav>

        {!online && <OfflineBanner />}
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center gap-4 p-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))] md:p-6 md:pb-6">
        {view === 'map' && (
          <div className="flex w-full flex-col gap-4 lg:flex-row lg:items-start">
            {/* El croquis y su buscador: la columna que el estudiante mira primero. */}
            <div className="flex w-full min-w-0 flex-col items-center gap-4 lg:flex-1">
              <div className="w-full max-w-2xl">
                <ZonePicker zones={ZONES} onSelect={handleSelectZone} state={screenState} />
              </div>

              {screenState === 'error' ? (
                <div className="w-full max-w-2xl">
                  <ErrorState
                    title="No pudimos cargar el campus"
                    description="Revisa tu conexión e inténtalo de nuevo."
                    onRetry={loadCampus}
                  />
                </div>
              ) : screenState === 'loading' ? (
                <div
                  aria-hidden="true"
                  className="aspect-[700/647] w-full max-w-2xl rounded-xl border-2 border-surface-700 bg-surface-800"
                />
              ) : (
                <CampusMap
                  zones={ZONES}
                  image={MAP_IMAGE}
                  onSelectZone={handleSelectZone}
                  onPick={handlePick}
                  highlightZoneId={highlightZoneId}
                  empty={mapReports.length === 0}
                  offline={!online}
                >
                  {mapReports.map((report) => (
                    <MapPin key={report.id} report={report} onClick={handlePinClick} />
                  ))}

                  {pending && <PendingMarker point={pending} />}
                </CampusMap>
              )}

              <p className="max-w-2xl text-center text-xs leading-relaxed text-text-muted">
                Toca el croquis para marcar un objeto perdido o encontrado. Con el teclado: Tab
                hasta el plano y usa las flechas para recorrer las zonas, Enter para elegir una.
              </p>
            </div>

            {/* Los nombres del campus: la tabla que el plano oficial ya no trae. */}
            <div className="w-full lg:w-96 lg:shrink-0">
              <ZoneLegend zones={ZONES} onSelect={handleSelectZone} onHover={setHighlightZoneId} />
            </div>
          </div>
        )}

        {view === 'reports' && (
          <MyReports
            reports={myReports}
            claims={claims}
            onOpenReport={handlePinClick}
            state={screenState}
            onRetry={loadCampus}
          />
        )}

        {view === 'inbox' && (
          <ClaimInbox
            claims={claims}
            onApprove={handleApproveClaim}
            onReject={handleRejectClaim}
            state={screenState}
            onRetry={loadCampus}
            offline={!online}
          />
        )}
      </main>

      {modal?.kind === 'choose' && (
        <PinTypeModal pending={pending} onClose={closeModal} onSelect={handleTypeSelect} />
      )}
      {modal?.kind === 'lost' && (
        <ReportModal
          kind="lost"
          session={session}
          onClose={closeModal}
          onSubmit={handleLostSubmit}
          offline={!online}
        />
      )}
      {modal?.kind === 'found' && (
        <ReportModal
          kind="found"
          session={session}
          onClose={closeModal}
          onSubmit={handleFoundSubmit}
          offline={!online}
        />
      )}
      {modal?.kind === 'release-key' && (
        <ReleaseKeyModal report={modal.report} onClose={closeModal} />
      )}
      {infoReport && (
        <PinInfoModal
          report={infoReport}
          session={session}
          linked={linkedReport}
          claims={claims.filter((claim) => claim.reportId === infoReport.id)}
          onClose={closeModal}
          onResolve={handleResolve}
          onAttempt={handleAttempt}
        />
      )}
    </div>
  );
}

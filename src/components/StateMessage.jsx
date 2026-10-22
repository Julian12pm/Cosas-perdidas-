/*
 * Los estados de una pantalla comparten un mismo panel: la misma forma, el
 * mismo icono, el mismo texto apagado y el mismo espaciado. Un estado nunca
 * es un texto suelto en medio del diseño, y cada estado lleva su propio
 * gancho para que una prueba pueda preguntar en qué estado está la pantalla.
 */

/** El panel de una pantalla que no tiene nada que mostrar. */
const PANEL = 'rounded-2xl border border-surface-600/50 bg-surface-800 p-5 sm:p-6';

/** El panel de un estado que vive dentro de otra pieza: el mapa, el buscador. */
const PANEL_COMPACT = 'rounded-xl border border-surface-600/50 bg-surface-800/95 p-3';

const IconSpinner = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5 animate-spin"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9" className="opacity-30" />
    <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
  </svg>
);

const IconEmpty = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M3 8h18v11H3z" strokeLinejoin="round" />
    <path d="M3 8l3-4h12l3 4" strokeLinejoin="round" />
    <path d="M9 13h6" strokeLinecap="round" />
  </svg>
);

const IconAlert = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M12 3l9 16H3z" strokeLinejoin="round" />
    <path d="M12 9v4" strokeLinecap="round" />
    <path d="M12 16.5v.01" strokeLinecap="round" />
  </svg>
);

/** El cuerpo del panel: icono, título, texto y, cuando hace falta, una acción. */
function StateBody({ icon, title, description, action, tone = 'muted' }) {
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <span
        className={`flex h-10 w-10 items-center justify-center rounded-full bg-surface-700/60 ${
          tone === 'danger' ? 'text-red-300' : 'text-surface-300'
        }`}
      >
        {icon}
      </span>
      <p className="text-sm font-semibold text-white">{title}</p>
      {description && (
        <p className="max-w-sm text-sm leading-relaxed text-text-muted">{description}</p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-1 min-h-[44px] cursor-pointer rounded-xl border border-surface-600/60 px-4 py-2 text-sm font-semibold text-surface-200 transition-colors hover:bg-surface-700/60 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/** La pantalla está cambiando: se anuncia, no se adivina. */
export function LoadingState({ title, description, compact = false, testId = 'state-loading' }) {
  return (
    <div
      data-testid={testId}
      role="status"
      aria-live="polite"
      className={compact ? PANEL_COMPACT : PANEL}
    >
      <StateBody icon={<IconSpinner />} title={title} description={description} />
    </div>
  );
}

/** No hay nada que mostrar, y se dice qué se puede hacer para no dejarlo así. */
export function EmptyState({
  title,
  description,
  action,
  compact = false,
  testId = 'state-empty',
}) {
  return (
    <div data-testid={testId} className={compact ? PANEL_COMPACT : PANEL}>
      <StateBody icon={<IconEmpty />} title={title} description={description} action={action} />
    </div>
  );
}

/** Una petición falló: qué pasó y qué hacer al respecto, nunca una traza. */
export function ErrorState({
  title,
  description,
  onRetry,
  compact = false,
  testId = 'state-error',
}) {
  return (
    <div data-testid={testId} role="alert" className={compact ? PANEL_COMPACT : PANEL}>
      <StateBody
        icon={<IconAlert />}
        tone="danger"
        title={title}
        description={description}
        action={onRetry ? { label: 'Reintentar', onClick: onRetry } : null}
      />
    </div>
  );
}

/*
 * El aviso de conexión perdida: una banda persistente y discreta que explica
 * por qué la app ya no puede pedir nada. No atrapa el foco: es una nota, no
 * un diálogo, y la app vuelve a cargar sola cuando regresa la señal.
 */

const IconOffline = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M2 2l20 20" strokeLinecap="round" />
    <path d="M5 12.6a11 11 0 0 1 4-2.5" strokeLinecap="round" />
    <path d="M1.5 8.6a16 16 0 0 1 5-3" strokeLinecap="round" />
    <path d="M8.5 16.2a7 7 0 0 1 7 0" strokeLinecap="round" />
    <path d="M12 20v.01" strokeLinecap="round" />
  </svg>
);

export default function OfflineBanner() {
  return (
    <div
      data-testid="state-offline"
      role="status"
      aria-live="polite"
      className="border-y border-amber-500/25 bg-amber-500/10"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2">
        <IconOffline />
        <p className="text-xs leading-relaxed text-amber-200">
          <strong className="font-semibold">Sin conexión.</strong>{' '}
          <span className="text-surface-300">
            No podemos pedir datos del campus. Lo que ves es lo último que cargamos y volvemos a
            intentarlo en cuanto regrese la señal.
          </span>
        </p>
      </div>
    </div>
  );
}

/*
 * El aviso de conexión perdida: una banda persistente y discreta que explica
 * por qué la app ya no puede pedir nada. No atrapa el foco: es una nota, no
 * un diálogo, y la app vuelve a cargar sola cuando regresa la señal.
 */

import { WiFiCrossIcon } from '@solar-icons/react/bold/wi-fi-cross';

export default function OfflineBanner() {
  return (
    <div
      data-testid="state-offline"
      role="status"
      aria-live="polite"
      className="border-y border-amber-500/25 bg-amber-500/10"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2">
        <WiFiCrossIcon size={16} aria-hidden="true" />
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

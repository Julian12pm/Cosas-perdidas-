import { useId, useState } from 'react';
import { reporterAlias } from '../data.js';

/*
 * El formulario de reporte sirve para los dos pines: el rojo y el verde. Lo
 * que cambia es el copy, el dato ciego que sólo pide el verde y el color del
 * botón, así que los campos viven una sola vez y no se duplican.
 */

/** La tarjeta que dice quién publica: la identidad es el correo institucional. */
function ReporterCard({ session }) {
  return (
    <div className="rounded-xl border border-surface-600/50 bg-surface-700/40 p-3">
      <p className="text-xs uppercase tracking-wide text-text-muted">Publica</p>
      <p className="text-sm font-semibold text-white">{session.displayName || session.email}</p>
      <p className="text-xs text-text-muted">
        {session.email} · {reporterAlias(session.id)}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
        Tu identidad es tu correo institucional: no se escribe un nombre a mano.
      </p>
    </div>
  );
}

export default function ReportForm({ kind, session, onSubmit, offline = false }) {
  const [item, setItem] = useState('');
  const [description, setDescription] = useState('');
  const [blindDetail, setBlindDetail] = useState('');
  const itemId = useId();
  const descriptionId = useId();
  const blindId = useId();

  const isFound = kind === 'found';
  const ready =
    item.trim() !== '' && description.trim() !== '' && (!isFound || blindDetail.trim() !== '');

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!ready) return;
    onSubmit({
      item: item.trim(),
      description: description.trim(),
      blindDetail: isFound ? blindDetail.trim() : '',
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor={itemId} className="mb-1.5 block text-sm font-medium text-surface-300">
          {isFound ? '¿Qué encontraste? *' : '¿Qué perdiste? *'}
        </label>
        <input
          id={itemId}
          data-testid="report-item"
          type="text"
          value={item}
          onChange={(event) => setItem(event.target.value)}
          placeholder={isFound ? 'Ej: dispositivo electrónico, prenda...' : undefined}
          className="min-h-[44px] w-full rounded-xl border border-input-border bg-surface-700/50 px-4 py-3 text-base text-white placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-focus"
          required
          autoFocus
        />
      </div>

      <div>
        <label
          htmlFor={descriptionId}
          className="mb-1.5 block text-sm font-medium text-surface-300"
        >
          {isFound ? 'Descripción pública *' : 'Descripción (opcional)'}
        </label>
        <textarea
          id={descriptionId}
          data-testid="report-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={isFound ? 2 : 3}
          required={isFound}
          placeholder={isFound ? 'Lo que todos van a leer. Sin marca ni color.' : undefined}
          className="w-full resize-none rounded-xl border border-input-border bg-surface-700/50 px-4 py-3 text-base text-white placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-focus"
        />
      </div>

      {isFound && (
        <div>
          <label htmlFor={blindId} className="mb-1.5 block text-sm font-medium text-surface-300">
            Dato ciego (privado) *
          </label>
          <textarea
            id={blindId}
            data-testid="report-blind-detail"
            value={blindDetail}
            onChange={(event) => setBlindDetail(event.target.value)}
            rows={2}
            placeholder="Marca, color, qué hay dentro. Sólo lo lee el dueño legítimo."
            className="w-full resize-none rounded-xl border border-input-border bg-surface-700/50 px-4 py-3 text-base text-white placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-focus"
            required
          />
          <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
            Nunca se publica: se queda en tu reporte y el reclamante lo dice para demostrar que es
            suyo.
          </p>
        </div>
      )}

      <ReporterCard session={session} />

      {/* El aviso va antes del botón: el botón se queda pegado al borde
          inferior y taparía la nota que lo acompaña. */}
      {offline && (
        <p className="text-xs leading-relaxed text-amber-200">
          Sin conexión no se puede publicar: en cuanto regrese la señal podrás clavar el pin.
        </p>
      )}

      {/* El botón vive al final del formulario pero se queda pegado al borde
          inferior: en un teléfono es el objetivo grande del pulgar. */}
      <button
        type="submit"
        data-testid="report-submit"
        disabled={!ready || offline}
        className={`sticky bottom-0 min-h-[44px] w-full cursor-pointer rounded-xl px-4 py-3 font-semibold text-white shadow-lg transition-all disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${
          isFound
            ? 'bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600'
            : 'bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600'
        }`}
      >
        {isFound ? '📌 Clavar pin verde' : '📌 Clavar pin rojo'}
      </button>
    </form>
  );
}

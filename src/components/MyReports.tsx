import { useState } from 'react';
import { CheckCircleIcon } from '@solar-icons/react/bold/check-circle';
import { ClockCircleIcon } from '@solar-icons/react/bold/clock-circle';
import { MapPointIcon } from '@solar-icons/react/bold/map-point';
import { QuestionCircleIcon } from '@solar-icons/react/bold/question-circle';
import { EmptyState, ErrorState, LoadingState } from './StateMessage.tsx';
import { REPORT_STATUS_LABELS, UNKNOWN_STATUS_LABEL, copyToClipboard, formatAge } from '../data.ts';
import type { Claim, Report, ReportStatus, ScreenState } from '../types.ts';

/*
 * "Mis reportes" es el archivo del estudiante: qué reportes publicó, en qué
 * estado están, la clave de liberación que dictó y los reclamos que le
 * llegan. Nada se borra al cerrar un caso: el reporte resuelto sigue aquí.
 */

const STATUS_STYLES: Record<ReportStatus, string> = {
  open: 'bg-surface-700/70 text-surface-200',
  pending_claim: 'bg-amber-500/15 text-amber-300',
  in_custody: 'bg-sky-500/15 text-sky-300',
  resolved: 'bg-green-500/15 text-green-300',
  expired: 'bg-surface-700/70 text-text-muted',
  archived: 'bg-surface-700/70 text-text-muted',
};

/** Copia la clave de liberación al portapapeles. */
function CopyKey({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    setCopied(await copyToClipboard(value));
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="min-h-[44px] cursor-pointer rounded-lg border border-surface-600/60 px-3 py-2 text-xs text-surface-200 transition-colors duration-fast hover:bg-surface-700/60 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
    >
      {copied ? 'Clave copiada' : 'Copiar clave'}
    </button>
  );
}

export default function MyReports({
  reports,
  claims,
  onOpenReport,
  state = 'ready',
  onRetry,
  apiMode = false,
}: {
  reports: Report[];
  claims: Claim[];
  onOpenReport: (report: Report) => void;
  state?: ScreenState;
  onRetry?: () => void;
  apiMode?: boolean;
}) {
  return (
    <section data-testid="my-reports" className="w-full max-w-3xl">
      {state === 'loading' && (
        <LoadingState
          title="Cargando tus reportes…"
          description="Buscamos lo que has publicado en el campus."
        />
      )}

      {(state === 'error' || state === 'offline') && (
        <ErrorState
          title="No pudimos cargar tus reportes"
          description="Revisa tu conexión e inténtalo de nuevo."
          onRetry={onRetry}
        />
      )}

      {state === 'ready' && reports.length === 0 && (
        <EmptyState
          title="Todavía no publicas ningún reporte"
          description="Marca en el croquis el objeto que perdiste o que encontraste. Aquí verás su estado, la clave de liberación que dictas y los reclamos que recibas."
        />
      )}

      {state === 'ready' && reports.length > 0 && (
        <>
          <h2 className="mb-3 text-lg font-bold text-white">
            Mis reportes{' '}
            <span className="text-sm font-normal text-text-muted">({reports.length})</span>
          </h2>

          <ul className="space-y-3">
            {reports.map((report) => {
              const related = claims.filter((claim) => claim.reportId === report.id);
              const isLost = report.type === 'lost';

              return (
                <li
                  key={report.id}
                  data-testid={`my-report-${report.id}`}
                  className="surface-panel p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          isLost ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
                        }`}
                      >
                        {isLost ? (
                          <QuestionCircleIcon size={16} className="shrink-0" aria-hidden="true" />
                        ) : (
                          <CheckCircleIcon size={16} className="shrink-0" aria-hidden="true" />
                        )}
                        {isLost ? 'Perdido' : 'Encontrado'}
                      </span>
                      <h3 className="mt-1.5 font-semibold text-white">{report.item}</h3>
                    </div>

                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        STATUS_STYLES[report.status] ?? STATUS_STYLES.open
                      }`}
                    >
                      {REPORT_STATUS_LABELS[report.status] ?? UNKNOWN_STATUS_LABEL}
                    </span>
                  </div>

                  <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-text-muted">
                    <div className="flex gap-1.5">
                      <dt className="inline-flex items-center gap-1">
                        <MapPointIcon size={16} className="shrink-0" aria-hidden="true" />
                        Zona:
                      </dt>
                      <dd className="text-surface-200">{report.zoneLabel ?? 'Terreno libre'}</dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="inline-flex items-center gap-1">
                        <ClockCircleIcon size={16} className="shrink-0" aria-hidden="true" />
                        Antiguo:
                      </dt>
                      <dd className="text-surface-200">{formatAge(report.timestamp)}</dd>
                    </div>
                  </dl>

                  {isLost && report.releaseKey && (
                    <div className="surface-accent mt-3 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-brand-200">
                        Tu clave de liberación
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-surface-300">
                        Se muestra aquí y en ningún otro lugar: dicte al estudiante que tiene el
                        objeto, es el que confirma la entrega.
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <span className="font-mono text-xl tracking-[0.4em] text-white">
                          {report.releaseKey}
                        </span>
                        <CopyKey value={report.releaseKey} />
                      </div>
                    </div>
                  )}

                  {isLost && !report.releaseKey && apiMode && (
                    <p className="surface-inset mt-3 p-3 text-xs leading-relaxed text-text-muted">
                      La clave de liberación se mostró una sola vez, al publicar el reporte: el
                      servidor no la vuelve a dar. Si la perdiste, publica un reporte nuevo.
                    </p>
                  )}

                  {!isLost && report.blindDetail && (
                    <div className="surface-inset mt-3 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-surface-300">
                        Dato ciego (privado)
                      </p>
                      <p className="mt-1 text-sm text-surface-200">{report.blindDetail}</p>
                      <p className="mt-1 text-xs text-text-muted">
                        Nadie más lo ve: es la prueba que el dueño legítimo debe dar.
                      </p>
                    </div>
                  )}

                  <div className="mt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                      Reclamos de este reporte ({related.length})
                    </p>
                    {related.length === 0 ? (
                      <p className="mt-1 text-sm text-text-muted">
                        Nadie ha reclamado este reporte.
                      </p>
                    ) : (
                      <ul className="mt-1 space-y-1.5">
                        {related.map((claim) => (
                          <li key={claim.id} className="text-sm text-surface-300">
                            <span className="font-semibold text-surface-100">
                              {claim.claimantAlias}
                            </span>
                            {claim.providedBlindDetail && (
                              <span className="text-text-muted">
                                {' '}
                                · “{claim.providedBlindDetail}”
                              </span>
                            )}
                            <span className="text-text-muted">
                              {' '}
                              · {claim.direction === 'incoming' ? 'recibido' : 'enviado'} ·{' '}
                              {claim.status === 'pending'
                                ? 'pendiente'
                                : claim.status === 'approved'
                                  ? 'aprobado'
                                  : claim.status === 'rejected'
                                    ? 'rechazado'
                                    : UNKNOWN_STATUS_LABEL}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => onOpenReport(report)}
                    className="mt-3 min-h-[44px] cursor-pointer rounded-xl border border-surface-600/60 px-4 py-2 text-sm font-semibold text-surface-200 transition-colors duration-fast hover:bg-surface-700/60 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                  >
                    Ver el reporte
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

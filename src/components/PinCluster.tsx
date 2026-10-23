import { CheckCircleIcon } from '@solar-icons/react/bold/check-circle';
import { QuestionCircleIcon } from '@solar-icons/react/bold/question-circle';
import Modal from './Modal.tsx';
import { formatAge } from '../data.ts';
import { artworkToPercent, polygonCentroid } from '../map/geometry.ts';
import { MAP_IMAGE, ZONE_BY_ID } from '../map/zones.ts';
import type { ClusterGroup, Report } from '../types.ts';

/*
 * Los reportes de una misma zona se apilan en su centro: el último pintado
 * tapa al otro y el ratón sólo alcanza a uno. Una zona con más de un reporte
 * se dibuja como UN marcador con la cuenta, y ese marcador abre la lista de
 * sus reportes.
 *
 * El marcador se queda en el centro de la zona (el mismo punto donde caen
 * los pines de esa zona) y su lista se abre como un diálogo: así no la
 * recorta el borde del croquis y el teclado la alcanza sola.
 */

/** El nombre que el estudiante oye: cuántos objetos y en qué zona. */
export function clusterName(count: number, label: string): string {
  return `${count} ${count === 1 ? 'objeto reportado' : 'objetos reportados'} en ${label}`;
}

/** La etiqueta de la zona: la del catálogo, o la que trae el reporte. */
function labelOf(group: ClusterGroup): string {
  const zone = group.zoneId ? ZONE_BY_ID.get(group.zoneId) : null;
  return zone?.label ?? group.reports[0]?.zoneLabel ?? 'el campus';
}

/**
 * El punto del marcador: el centro de la zona, el mismo donde caen sus
 * pines. Si la zona no está en el catálogo, el punto del reporte.
 */
function positionOf(group: ClusterGroup): { x: number; y: number } {
  const zone = group.zoneId ? ZONE_BY_ID.get(group.zoneId) : null;
  const centroid = zone ? polygonCentroid(zone.polygon) : null;
  if (!centroid) {
    const first = group.reports[0];
    return { x: first?.x ?? 0, y: first?.y ?? 0 };
  }
  const percent = artworkToPercent(centroid, MAP_IMAGE);
  return { x: parseFloat(percent.x.toFixed(2)), y: parseFloat(percent.y.toFixed(2)) };
}

/**
 * Los reportes del mapa agrupados por zona: una zona con un solo reporte
 * conserva su pin; una zona con varios se dibuja como un grupo. Un reporte
 * sin zona (un punto en terreno libre) se queda con su pin, porque no hay
 * dónde agruparlo.
 */
export function clusterByZone(reports: Report[]): ClusterGroup[] {
  const zones = new Map<string, ClusterGroup>();
  const loose: ClusterGroup[] = [];

  for (const report of reports ?? []) {
    if (!report) continue;
    if (!report.zoneId) {
      loose.push({ zoneId: null, label: '', position: { x: 0, y: 0 }, reports: [report] });
      continue;
    }
    const group = zones.get(report.zoneId);
    if (group) group.reports.push(report);
    else
      zones.set(report.zoneId, {
        zoneId: report.zoneId,
        label: '',
        position: { x: 0, y: 0 },
        reports: [report],
      });
  }

  return [...zones.values(), ...loose].map((group) => ({
    ...group,
    label: labelOf(group),
    position: positionOf(group),
  }));
}

/* ─────────────────────────── El marcador del grupo ─────────────────────────── */
export default function PinCluster({
  group,
  onOpen,
}: {
  group: ClusterGroup;
  onOpen: (zoneId: string) => void;
}) {
  const count = group.reports.length;
  const lost = group.reports.filter((report) => report.type === 'lost').length;
  // El anillo lleva la mezcla: rojo lo que se perdió, verde lo que se
  // encontró, en la proporción que hay.
  const share = Math.round((lost / count) * 360);
  const name = clusterName(count, group.label);

  return (
    <button
      type="button"
      data-testid={`pin-cluster-marker-${group.zoneId}`}
      aria-label={name}
      aria-haspopup="dialog"
      title={name}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (group.zoneId) onOpen(group.zoneId);
      }}
      className="pointer-events-auto absolute z-20 origin-bottom -translate-x-1/2 -translate-y-full cursor-pointer focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
      style={{
        left: `${group.position.x}%`,
        top: `${group.position.y}%`,
        scale: 'var(--pin-scale, 1)',
      }}
    >
      {/* La misma sombra que la de los pines: el marcador está de pie. */}
      <div
        data-testid="pin-shadow"
        className="absolute bottom-0 left-[calc(50%+3px)] h-2 w-4 -translate-x-1/2 translate-y-2 rounded-full bg-black/45 blur-[2px]"
      />
      <div className="relative flex flex-col items-center">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full shadow-panel"
          style={{
            background: `conic-gradient(var(--color-pin-red) 0deg ${share}deg, var(--color-pin-green) ${share}deg 360deg)`,
          }}
        >
          <span
            data-testid="pin-cluster-count"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-900 text-xs font-bold text-white"
          >
            {count}
          </span>
        </div>
        <div className="-mt-0.5 h-0 w-0 border-l-[6px] border-r-[6px] border-l-transparent border-r-transparent border-t-[8px] border-t-surface-600" />
      </div>
    </button>
  );
}

/* ──────────────────────────── La lista del grupo ──────────────────────────── */
export function PinClusterList({
  open = true,
  group,
  onClose,
  onOpenReport,
}: {
  open?: boolean;
  group: ClusterGroup;
  onClose: () => void;
  onOpenReport: (report: Report) => void;
}) {
  const count = group.reports.length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={clusterName(count, group.label)}
      description="Elige el reporte que quieras abrir."
      testId="pin-cluster-dialog"
    >
      <ul className="space-y-2">
        {group.reports.map((report) => {
          const isLost = report.type === 'lost';
          return (
            <li key={report.id}>
              <button
                type="button"
                data-testid={`pin-cluster-entry-${report.id}`}
                onClick={() => onOpenReport(report)}
                className="surface-row flex min-h-[44px] w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors duration-fast hover:bg-surface-700/80 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              >
                <span
                  className={`inline-flex shrink-0 items-center gap-1 text-xs font-semibold ${
                    isLost ? 'text-red-300' : 'text-green-300'
                  }`}
                >
                  {isLost ? (
                    <QuestionCircleIcon size={14} aria-hidden="true" />
                  ) : (
                    <CheckCircleIcon size={14} aria-hidden="true" />
                  )}
                  {isLost ? 'Perdido' : 'Encontrado'}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-white">{report.item}</span>
                <span className="shrink-0 text-xs text-text-muted">
                  {formatAge(report.timestamp)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

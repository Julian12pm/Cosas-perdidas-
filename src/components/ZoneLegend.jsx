import { useId, useMemo, useRef, useState } from 'react';
import { ArrowRightUpIcon } from '@solar-icons/react/bold/arrow-right-up';
import { Buildings2Icon } from '@solar-icons/react/bold/buildings-2';
import { MagnifierIcon } from '@solar-icons/react/bold/magnifier';
import { ShieldCheckIcon } from '@solar-icons/react/bold/shield-check';
import { searchZones } from '../map/geometry.js';

/*
 * La leyenda del croquis: los nombres de los edificios, que el plano oficial
 * traía impresos en una columna de la propia imagen y que aquí son datos.
 *
 * El panel no es una foto del plano: es una lista que se busca, que se recorre
 * con el teclado y que se toca. Al pasar el cursor por una fila la zona se
 * resalta en el croquis; al tocarla se marca el objeto ahí, igual que al tocar
 * la zona en el mapa.
 */

/** Los nombres de las unidades, como los lee el estudiante en el plano. */
const UNIT_NAMES = {
  'metal-mecanica': 'Unidad Metal-Mecánica',
  central: 'Unidad Central',
  posgrado: 'Unidad Posgrado',
  campus: 'Campus',
};

/** El orden en que las unidades aparecen en el plano. */
const UNIT_ORDER = ['metal-mecanica', 'central', 'posgrado', 'campus'];

/** La fila se lee como el plano: la clave y el nombre del edificio. */
function rowText(zone) {
  const code = (zone.code ?? '').trim();
  const name = (zone.name ?? '').trim();
  if (!code) return name;
  // El código y el nombre son la misma palabra (los estacionamientos): no se
  // repite dos veces la misma etiqueta en la misma fila.
  if (code.toLowerCase() === name.toLowerCase()) return name;
  return `${code} · ${name}`;
}

export default function ZoneLegend({ zones = [], onSelect, onHover }) {
  const [query, setQuery] = useState('');
  // En el teléfono la lista se pliega y el croquis es lo primero que se ve.
  const [open, setOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const headingId = useId();
  const searchId = useId();
  const listId = useId();
  const rowRefs = useRef(new Map());

  /**
   * Con una búsqueda manda el ranking de `searchZones` (la misma jerarquía
   * que usa el buscador del croquis); sin búsqueda, la lista va agrupada por
   * unidad y en el orden en que el plano dibuja los edificios.
   */
  const groups = useMemo(() => {
    if (query.trim()) {
      return [{ unit: null, name: null, zones: searchZones(query, zones) }];
    }

    const grouped = UNIT_ORDER.map((unit) => ({
      unit,
      name: UNIT_NAMES[unit] ?? unit,
      zones: [],
    }));
    for (const zone of zones) {
      const group = grouped.find((entry) => entry.unit === zone.unit);
      if (group) group.zones.push(zone);
      else grouped.push({ unit: zone.unit, name: zone.unit, zones: [zone] });
    }
    return grouped.filter((group) => group.zones.length > 0);
  }, [query, zones]);

  const rows = useMemo(() => groups.flatMap((group) => group.zones), [groups]);
  const indexById = useMemo(() => new Map(rows.map((zone, index) => [zone.id, index])), [rows]);

  // La lista entera es un solo paso de tabulación: las flechas la recorren.
  const tabStop = rows.length === 0 ? -1 : Math.min(activeIndex, rows.length - 1);

  const moveFocus = (index) => {
    if (rows.length === 0) return;
    const next = Math.max(0, Math.min(index, rows.length - 1));
    setActiveIndex(next);
    rowRefs.current.get(rows[next].id)?.focus();
  };

  const onRowKeyDown = (event, index) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(index + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(index - 1);
        return;
      case 'Home':
        event.preventDefault();
        moveFocus(0);
        return;
      case 'End':
        event.preventDefault();
        moveFocus(rows.length - 1);
        return;
      default:
    }
  };

  return (
    <section
      data-testid="zone-legend"
      aria-labelledby={headingId}
      className="surface-panel w-full p-4"
    >
      <div>
        <h2 id={headingId} className="flex items-center gap-2 text-base font-bold text-white">
          <Buildings2Icon size={18} className="shrink-0 text-brand-300" aria-hidden="true" />
          Nombres del campus
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          Los edificios del croquis con su clave y su nombre, en el mismo orden en que los ves en el
          plano.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          A y AF son los dos puntos de entrega seguros: ahí entregas un objeto sin conocer a su
          dueño.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          El croquis no dibuja las calles: vienen del plano oficial, y los nombres de los edificios
          viven aquí.
        </p>
      </div>

      {/* En el teléfono la lista se pliega: el croquis es lo primero que se ve. */}
      <button
        type="button"
        data-testid="zone-legend-toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="mt-3 inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center rounded-xl border border-surface-600/60 px-3 py-2 text-xs font-semibold text-surface-200 transition-colors duration-fast hover:bg-surface-700/60 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none lg:hidden"
      >
        {open ? 'Ocultar nombres' : 'Ver nombres'}
      </button>

      {/* La lista se pliega con su altura: el pliegue se anima en vez de
          aparecer de golpe. En pantalla ancha siempre está abierta. */}
      <div
        id={listId}
        className={`grid transition-[grid-template-rows] duration-slow lg:grid-rows-[1fr] ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          <p className="mt-3 text-xs leading-relaxed text-text-muted">
            Pasa el cursor por una fila y su zona se enciende en el croquis; tócala para marcar algo
            ahí.
          </p>

          <div className="mt-2">
            <label htmlFor={searchId} className="mb-1 block text-xs font-semibold text-surface-200">
              Buscar por clave o nombre
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-input-border bg-surface-700/50 px-3 focus-within:border-brand-500/70 focus-within:ring-2 focus-within:ring-focus">
              <MagnifierIcon size={16} className="shrink-0 text-text-muted" aria-hidden="true" />
              <input
                id={searchId}
                data-testid="zone-legend-search"
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
                placeholder="2K, AF, cafetería…"
                className="min-h-[44px] w-full bg-transparent text-sm text-white placeholder-surface-500 outline-none"
              />
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="surface-inset mt-3 p-3 text-sm leading-relaxed text-text-muted">
              Ninguna zona coincide con «{query.trim()}». Prueba con la clave (2K, AF) o con el
              nombre del edificio.
            </p>
          ) : (
            <div className="mt-3 max-h-[min(60vh,32rem)] space-y-3 overflow-y-auto overscroll-contain pr-1">
              {groups.map((group) => (
                <div key={group.unit ?? 'coincidencias'}>
                  {group.name && (
                    <h3 className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wide text-surface-300">
                      {group.name}
                    </h3>
                  )}
                  <ul className="space-y-1" aria-label={group.name ?? 'Zonas que coinciden'}>
                    {group.zones.map((zone) => {
                      const index = indexById.get(zone.id);
                      const text = rowText(zone);

                      return (
                        <li key={zone.id} className="list-none">
                          <button
                            type="button"
                            data-testid={`zone-legend-${zone.id}`}
                            title={text}
                            tabIndex={index === tabStop ? 0 : -1}
                            onClick={() => onSelect?.(zone)}
                            onMouseEnter={() => onHover?.(zone.id)}
                            onMouseLeave={() => onHover?.(null)}
                            onFocus={() => {
                              setActiveIndex(index);
                              onHover?.(zone.id);
                            }}
                            onBlur={() => onHover?.(null)}
                            onKeyDown={(event) => onRowKeyDown(event, index)}
                            ref={(node) => {
                              if (node) rowRefs.current.set(zone.id, node);
                              else rowRefs.current.delete(zone.id);
                            }}
                            className="flex min-h-[44px] w-full cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 text-left text-sm text-surface-200 transition-colors duration-fast hover:bg-surface-700/60 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                          >
                            <span className="min-w-0">{text}</span>
                            {zone.safePoint && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-brand-500/40 bg-brand-500/15 px-2 py-0.5 text-[10px] font-semibold text-brand-200">
                                <ShieldCheckIcon
                                  size={12}
                                  className="shrink-0"
                                  aria-hidden="true"
                                />
                                Punto de entrega seguro
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* El plano oficial sigue disponible, pero como referencia: no es el mapa. */}
      <div className="mt-4 border-t border-surface-700 pt-3">
        <a
          data-testid="original-plan-link"
          href="/mapa-itm.png"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-surface-600/60 px-3 py-2 text-sm font-semibold text-surface-200 transition-colors duration-fast hover:bg-surface-700/60 hover:text-white focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          <ArrowRightUpIcon size={16} className="shrink-0" aria-hidden="true" />
          ver el plano original
        </a>
        <p className="mt-2 text-xs leading-relaxed text-text-muted">
          El plano oficial del ITM en color, con su escudo y su título. Es una referencia para
          imprimir o consultar: ahí no se pueden marcar objetos.
        </p>
      </div>
    </section>
  );
}

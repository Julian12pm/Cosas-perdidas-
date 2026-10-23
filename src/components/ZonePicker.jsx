import { useEffect, useMemo, useRef, useState } from 'react';
import { MagnifierIcon } from '@solar-icons/react/bold/magnifier';
import { EmptyState, LoadingState } from './StateMessage.jsx';
import { searchZones } from '../map/geometry.js';

/*
 * The picker is the keyboard path to the zones: the overlay buttons are not
 * tab stops, so a student who cannot aim at a 12-pixel building searches for
 * it by code, name, unit or label and drops the marker on its centre.
 */

const LISTBOX_ID = 'zone-picker-listbox';

/** Unit identifiers as the students read them on the croquis. */
const UNIT_LABELS = {
  'metal-mecanica': 'Metal-Mecánica',
  central: 'Central',
  posgrado: 'Posgrado',
  campus: 'Campus',
};

export default function ZonePicker({ zones, onSelect, state = 'ready' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef(null);
  const listRef = useRef(null);

  // An empty query lists every zone; a typed one is ranked by searchZones.
  const results = useMemo(() => (query.trim() ? searchZones(query, zones) : zones), [query, zones]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const select = (zone) => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
    onSelect(zone);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => {
        const last = results.length - 1;
        if (last < 0) return 0;
        return Math.min(Math.max(index + step, 0), last);
      });
      return;
    }

    if (event.key === 'Enter') {
      const zone = results[activeIndex];
      if (!zone) return;
      event.preventDefault();
      select(zone);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-2xl">
      <div
        data-testid="picker-trigger"
        className="flex items-center gap-2 rounded-xl border border-input-border bg-surface-700/50 px-3 py-2 transition-colors duration-fast focus-within:border-brand-500/70 focus-within:ring-2 focus-within:ring-focus"
      >
        <MagnifierIcon size={16} className="shrink-0 text-text-muted" aria-hidden="true" />
        <input
          data-testid="picker-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          aria-activedescendant={
            open && results.length > 0 ? `${LISTBOX_ID}-${activeIndex}` : undefined
          }
          aria-label="Buscar zona del campus"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Busca un edificio o área del campus…"
          className="min-h-[44px] w-full bg-transparent text-base text-white placeholder-surface-500 outline-none sm:text-sm"
        />
      </div>

      {/* El campo nunca desaparece: quien empieza a escribir en los primeros
          segundos no pierde lo que escribió ni el foco. La carga va al lado. */}
      {state === 'loading' && (
        <div className="mt-2">
          <LoadingState compact title="Cargando las zonas del campus…" />
        </div>
      )}

      {open && state !== 'loading' && (
        <ul
          id={LISTBOX_ID}
          ref={listRef}
          role="listbox"
          aria-label="Zonas del campus"
          className="surface-panel absolute z-30 mt-2 max-h-[min(18rem,60dvh)] w-full overflow-y-auto"
        >
          {results.length === 0 ? (
            state === 'ready' ? (
              <li className="list-none p-2">
                <EmptyState
                  compact
                  testId="state-empty-picker"
                  title="Ninguna zona coincide"
                  description="Prueba con el nombre del edificio o con su clave."
                />
              </li>
            ) : (
              <li
                role="option"
                aria-selected="false"
                aria-disabled="true"
                className="px-3 py-4 text-center text-sm text-text-muted"
              >
                Sin coincidencias
              </li>
            )
          ) : (
            results.map((zone, index) => (
              <li
                key={zone.id}
                id={`${LISTBOX_ID}-${index}`}
                data-testid={`picker-option-${zone.id}`}
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(zone)}
                className={`flex min-h-[44px] cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm transition-colors duration-fast ${
                  index === activeIndex
                    ? 'bg-brand-500/20 text-white'
                    : 'text-surface-200 hover:bg-surface-700/60'
                }`}
              >
                <span className="truncate">{zone.label}</span>
                <span className="shrink-0 rounded-full bg-surface-700/70 px-2 py-0.5 text-[11px] text-surface-300">
                  {UNIT_LABELS[zone.unit] ?? zone.unit}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

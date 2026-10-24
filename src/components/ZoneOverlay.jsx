import { zoneToPercent } from '../map/geometry.js';

/*
 * The overlay lives inside the painted-content layer, so its percentages are
 * percentages of the artwork: a zone stays glued to its building at any size.
 *
 * The layer ignores pointer events and only the zone buttons take them, so a
 * tap on open ground still reaches the map behind.
 */

/** Percentage of the artwork where the label stops being centred on its zone. */
const EDGE_LEFT = 12;
const EDGE_RIGHT = 88;

export default function ZoneOverlay({ zones, image, onSelect }) {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none">
      {zones.map((zone) => {
        const placement = zoneToPercent(zone.box, image);
        if (!placement) return null;

        // A label centred on a zone at the edge of the artwork would be cut
        // off by the frame, so it anchors to the inner side instead.
        const anchor =
          placement.left <= EDGE_LEFT
            ? 'left-0'
            : placement.left + placement.width >= EDGE_RIGHT
              ? 'right-0'
              : 'left-1/2 -translate-x-1/2';

        return (
          <button
            key={zone.id}
            type="button"
            tabIndex={-1}
            aria-label={zone.label}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(zone);
            }}
            className="group absolute rounded-sm border border-transparent bg-transparent pointer-events-auto cursor-pointer hover:bg-brand-400/20 hover:border-brand-300/70 focus:bg-brand-400/20 focus:border-brand-300/70 focus:outline-none hover:z-10 focus:z-10"
            style={{
              left: `${placement.left}%`,
              top: `${placement.top}%`,
              width: `${placement.width}%`,
              height: `${placement.height}%`,
            }}
          >
            <span
              className={`absolute top-1/2 -translate-y-1/2 ${anchor} pointer-events-none whitespace-nowrap rounded-md bg-surface-900/95 px-1.5 py-0.5 text-[10px] font-semibold text-brand-200 opacity-0 shadow-lg ring-1 ring-surface-600/70 transition-opacity duration-150 group-hover:opacity-100 group-focus:opacity-100`}
            >
              {zone.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

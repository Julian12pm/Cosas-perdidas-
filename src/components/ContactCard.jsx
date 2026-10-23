import { useEffect, useId, useState } from 'react';
import { copyToClipboard } from '../data.js';

/*
 * La tarjeta de contacto es la única forma de que las dos partes se habló:
 * no hay chat interno, sólo el nombre y el correo institucional de la otra
 * persona. Antes de aprobar un reclamo no se muestra absolutamente nada,
 * porque el plataforma todavía no sabe quién está detrás del reporte.
 */

/**
 * La tarjeta se identifica por su reclamo: `contact-card-<claimId>`. El nombre
 * corto (`contact-card`) se reserva para el caso de una sola tarjeta en
 * pantalla, porque un nombre repetido rompe el modo estricto de una prueba.
 */
export default function ContactCard({ contact, claimId, single = false }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const contentId = useId();

  // Un reclamo nuevo es otra persona: la tarjeta vuelve a cerrarse, porque la
  // copia promete que el contacto se ve al apretar "Ver el contacto".
  useEffect(() => {
    setRevealed(false);
    setCopied(false);
  }, [contact?.email]);

  // Sin un reclamo aprobado no hay nada que revelar.
  if (!contact) return null;

  const copy = async () => {
    const ok = await copyToClipboard(contact.email);
    setCopied(ok);
  };

  return (
    <div
      data-testid={`contact-card-${claimId}`}
      onMouseEnter={() => setRevealed(true)}
      className="surface-accent p-3"
    >
      <div data-testid={single ? 'contact-card' : undefined}>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-200">
          Contacto de la otra parte
        </p>

        <button
          type="button"
          data-testid={`contact-reveal-${claimId}`}
          onClick={() => setRevealed(true)}
          aria-expanded={revealed}
          aria-controls={contentId}
          className="mt-2 min-h-[44px] cursor-pointer rounded-lg border border-brand-500/40 px-3 py-2 text-xs font-semibold text-brand-200 transition-colors hover:bg-brand-500/20 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
        >
          <span data-testid={single ? 'contact-reveal' : undefined}>
            {revealed ? 'Contacto liberado' : 'Ver el contacto'}
          </span>
        </button>

        {revealed && (
          <div id={contentId} className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-semibold text-white">{contact.display_name}</span>
            <a
              href={`mailto:${contact.email}`}
              className="text-brand-200 underline decoration-brand-500/50 underline-offset-2 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
            >
              {contact.email}
            </a>
            <button
              type="button"
              onClick={copy}
              className="min-h-[44px] cursor-pointer rounded-lg border border-surface-600/60 px-3 py-2 text-xs text-surface-200 transition-colors hover:bg-surface-700/60 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
            >
              {copied ? 'Correo copiado' : 'Copiar correo'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

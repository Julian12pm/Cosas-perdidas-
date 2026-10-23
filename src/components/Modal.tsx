import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

/*
 * The dialog is a plain fixed overlay: no portal and no dependency, the app
 * has a single root so the overlay always paints on top of it.
 *
 * The focus is trapped while the dialog is open and returned to whatever had
 * it before, so a keyboard user never gets lost behind the overlay.
 */

/** Elements the keyboard can reach inside the dialog. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * El red de seguridad de la salida.
 *
 * La salida dura 200 ms y la anuncia el `animationend`; este plazo es sólo
 * para el caso raro de que la animación no corra (el diálogo escondido, el
 * motor que no la dispara), donde sin él el panel se quedaría pegado.
 */
const EXIT_FALLBACK_MS = 600;

export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  testId,
}: {
  open: boolean;
  onClose?: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  testId?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  /**
   * El diálogo no desaparece de golpe: primero se va y, cuando termina de
   * irse, se desmonta. `open` | `closing` | `closed`.
   */
  const [phase, setPhase] = useState(open ? 'open' : 'closed');

  // Whatever had the focus goes back to it when the dialog closes. The
  // element is read while rendering, because a child with `autoFocus` takes
  // the focus during the commit, before the effect below can look at it.
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== 'undefined') {
    const active = document.activeElement;
    restoreRef.current = active instanceof HTMLElement ? active : null;
  }
  wasOpen.current = open;

  // La salida: el panel sigue en pantalla mientras se va.
  useEffect(() => {
    if (open) {
      setPhase('open');
      return undefined;
    }
    if (phase === 'closed') return undefined;
    setPhase('closing');
    const timer = setTimeout(() => setPhase('closed'), EXIT_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [open, phase]);

  // El foco vuelve al que lo tenía cuando el diálogo se desmonta, no cuando
  // empieza a irse: mientras se va, el panel todavía está en pantalla.
  useEffect(() => {
    if (phase !== 'closed') return;
    const previous = restoreRef.current;
    restoreRef.current = null;
    if (previous && typeof previous.focus === 'function') previous.focus();
  }, [phase]);

  useEffect(() => {
    if (!open) return undefined;

    const dialog = dialogRef.current;
    const active = document.activeElement;
    const focused = active instanceof HTMLElement ? active : null;
    // A child with `autoFocus` already took the focus, so it is left alone.
    const first = dialog?.contains(focused)
      ? focused
      : dialog?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialog)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // El teclado del teléfono achica la ventana visual, no la de maquetación:
  // el diálogo se mide contra la ventana visual para que su pie no quede
  // debajo del teclado.
  useEffect(() => {
    if (!open) return undefined;
    const viewport = window.visualViewport;
    if (!viewport) return undefined;

    const sync = () => {
      const overlap = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      overlayRef.current?.style.setProperty('--keyboard', `${overlap}px`);
    };

    sync();
    viewport.addEventListener('resize', sync);
    viewport.addEventListener('scroll', sync);
    return () => {
      viewport.removeEventListener('resize', sync);
      viewport.removeEventListener('scroll', sync);
    };
  }, [open]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      const focusable = [...(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
        (node) => node.offsetParent !== null,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const index = focusable.findIndex((node) => node === document.activeElement);
      if (index === -1) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && index === 0) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && index === focusable.length - 1) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (phase === 'closed') return null;

  const leaving = phase === 'closing';

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end justify-center p-4 pb-[calc(1rem_+_var(--keyboard,0px))] sm:items-center sm:pb-4"
      onClick={(event: React.MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm ${
          leaving ? 'animate-backdrop-out' : 'animate-backdrop-in'
        }`}
        onClick={() => onClose?.()}
        aria-hidden="true"
      />

      <div
        ref={dialogRef}
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        // El `animationend` del propio diálogo es lo que avisa de que la
        // salida terminó; el de los hijos (el temblor de la clave) no cuenta.
        onAnimationEnd={(event: React.AnimationEvent<HTMLDivElement>) => {
          if (event.target !== event.currentTarget) return;
          if (leaving) setPhase('closed');
        }}
        className={`surface-panel relative flex max-h-[calc(90dvh_-_var(--keyboard,0px))] w-full max-w-md flex-col overflow-hidden focus:outline-none ${
          leaving ? 'animate-modal-out' : 'animate-modal-in'
        }`}
      >
        <div className="px-4 pt-4 pb-3 sm:px-6 sm:pt-5 sm:pb-4">
          <h2 id={titleId} className="text-lg font-bold text-white">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="mt-1 text-sm text-text-muted">
              {description}
            </p>
          )}
        </div>

        <div className="px-4 pb-4 overflow-y-auto sm:px-6 sm:pb-5">{children}</div>

        {footer && (
          <div className="border-t border-surface-700 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

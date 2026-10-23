import { useCallback, useEffect, useId, useRef } from 'react';

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

export default function Modal({ open, onClose, title, description, children, footer, testId }) {
  const dialogRef = useRef(null);
  const overlayRef = useRef(null);
  const restoreRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();

  // Whatever had the focus goes back to it when the dialog closes. The
  // element is read while rendering, because a child with `autoFocus` takes
  // the focus during the commit, before the effect below can look at it.
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== 'undefined') {
    restoreRef.current = document.activeElement;
  }
  wasOpen.current = open;

  useEffect(() => {
    if (!open) return undefined;

    const dialog = dialogRef.current;
    const active = document.activeElement;
    // A child with `autoFocus` already took the focus, so it is left alone.
    const first = dialog?.contains(active) ? active : dialog?.querySelector(FOCUSABLE);
    (first ?? dialog)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      const previous = restoreRef.current;
      restoreRef.current = null;
      if (previous && typeof previous.focus === 'function') previous.focus();
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
    (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      const focusable = [...(dialog?.querySelectorAll(FOCUSABLE) ?? [])].filter(
        (node) => node.offsetParent !== null,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const index = focusable.indexOf(document.activeElement);
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

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end justify-center p-4 pb-[calc(1rem_+_var(--keyboard,0px))] sm:items-center sm:pb-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-backdrop-in"
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
        className="relative flex max-h-[calc(90dvh_-_var(--keyboard,0px))] w-full max-w-md flex-col overflow-hidden surface-panel animate-modal-in focus:outline-none"
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

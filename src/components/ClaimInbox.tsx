import { useState } from 'react';
import Modal from './Modal.tsx';
import ContactCard from './ContactCard.tsx';
import { EmptyState, ErrorState, LoadingState } from './StateMessage.tsx';
import { UNKNOWN_STATUS_LABEL, formatAge } from '../data.ts';
import type { Claim, ScreenState } from '../types.ts';

/*
 * La bandeja de reclamos: lo que los demás piden contra tus reportes y lo que
 * tú pediste contra los reportes ajenos. Aprobar libera el contacto de la
 * otra parte; rechazar es una acusación, así que pide confirmación antes de
 * quedar registrada.
 */

const STATUS_LABELS: Record<Claim['status'], string> = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  expired: 'Expirado',
};

/** Las decisiones que se toman sobre un reclamo. */
interface ClaimDecision {
  claim: Claim;
  kind: 'approve' | 'reject';
}

/** Una fila de la bandeja, con el dato ciego que ofrece el reclamante. */
function ClaimRow({
  claim,
  actions,
  single = false,
}: {
  claim: Claim;
  actions?: React.ReactNode;
  single?: boolean;
}) {
  return (
    <li data-testid={`claim-${claim.id}`} className="surface-panel p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-white">{claim.reportTitle}</p>
          <p className="text-xs text-text-muted">
            {claim.claimantAlias} · {formatAge(claim.createdAt)}
          </p>
        </div>
        <span className="rounded-full bg-surface-700/70 px-2.5 py-0.5 text-xs font-semibold text-surface-200">
          {STATUS_LABELS[claim.status] ?? UNKNOWN_STATUS_LABEL}
        </span>
      </div>

      {claim.providedBlindDetail && (
        <p className="surface-inset mt-2 p-2 text-sm text-surface-200">
          <span className="text-xs uppercase tracking-wide text-text-muted">Dato ciego: </span>
          {claim.providedBlindDetail}
        </p>
      )}

      {claim.message && <p className="mt-2 text-sm text-surface-300">“{claim.message}”</p>}

      {actions}

      {claim.status === 'approved' && claim.contact && (
        <div className="mt-3">
          <ContactCard contact={claim.contact} claimId={claim.id} single={single} />
        </div>
      )}
    </li>
  );
}

export default function ClaimInbox({
  claims,
  onApprove,
  onReject,
  state = 'ready',
  onRetry,
  offline = false,
  error = '',
}: {
  claims: Claim[];
  onApprove: (claimId: string) => void | Promise<void>;
  onReject: (claimId: string) => void | Promise<void>;
  state?: ScreenState;
  onRetry?: () => void;
  offline?: boolean;
  error?: string;
}) {
  const [decision, setDecision] = useState<ClaimDecision | null>(null);
  const [busy, setBusy] = useState(false);

  const incoming = claims.filter((claim) => claim.direction === 'incoming');
  const outgoing = claims.filter((claim) => claim.direction === 'outgoing');
  const pending = incoming.filter((claim) => claim.status === 'pending');
  const withContact = incoming.filter((claim) => claim.status === 'approved' && claim.contact);
  // Un nombre de prueba sólo sirve si es único: el nombre corto se usa
  // cuando el elemento es el único de su especie en la pantalla.
  const onlyPending = pending.length === 1;
  const onlyContact = withContact.length === 1;

  const confirm = async () => {
    if (!decision || busy) return;
    const { claim, kind } = decision;
    setDecision(null);
    setBusy(true);
    try {
      await (kind === 'approve' ? onApprove(claim.id) : onReject(claim.id));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-testid="inbox" className="w-full max-w-3xl space-y-5">
      <div>
        <h2 className="mb-1 text-lg font-bold text-white">Bandeja de reclamos</h2>
        <p className="text-sm text-text-muted">
          Apruebas lo que te piden y decides lo que pides. Sin chat: cuando apruebas, se libera la
          tarjeta de contacto.
        </p>
      </div>

      {error && (
        <p
          data-testid="inbox-error"
          role="alert"
          className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      {state === 'loading' && (
        <LoadingState
          title="Cargando la bandeja de reclamos…"
          description="Vemos quién reclamó tus reportes y qué pediste tú."
        />
      )}

      {(state === 'error' || state === 'offline') && (
        <ErrorState
          title="No pudimos cargar la bandeja"
          description="Revisa tu conexión e inténtalo de nuevo."
          onRetry={onRetry}
        />
      )}

      {state === 'ready' && incoming.length === 0 && outgoing.length === 0 && (
        <EmptyState
          title="No hay reclamos todavía"
          description="Cuando alguien reclame uno de tus reportes, o tú reclames el de otra persona, aparecerá aquí."
        />
      )}

      {state === 'ready' && (incoming.length > 0 || outgoing.length > 0) && (
        <>
          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-brand-300">
              Recibidos ({incoming.length})
            </h3>
            {incoming.length === 0 ? (
              <p className="surface-inset p-3 text-sm text-text-muted">
                Nadie ha reclamado tus reportes.
              </p>
            ) : (
              <ul className="space-y-3">
                {incoming.map((claim) => (
                  <ClaimRow
                    key={claim.id}
                    claim={claim}
                    single={onlyContact}
                    actions={
                      claim.status === 'pending' ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            data-testid={`claim-approve-${claim.id}`}
                            disabled={offline || busy}
                            onClick={() => setDecision({ claim, kind: 'approve' })}
                            className="min-h-[44px] cursor-pointer rounded-xl bg-gradient-to-r from-green-600 to-green-700 px-4 py-2 text-sm font-semibold text-white transition-[background-image] duration-base hover:from-green-500 hover:to-green-600 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                          >
                            <span data-testid={onlyPending ? 'claim-approve' : undefined}>
                              Aprobar
                            </span>
                          </button>
                          <button
                            type="button"
                            data-testid={`claim-reject-${claim.id}`}
                            disabled={offline || busy}
                            onClick={() => setDecision({ claim, kind: 'reject' })}
                            className="min-h-[44px] cursor-pointer rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-300 transition-colors duration-fast hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                          >
                            <span data-testid={onlyPending ? 'claim-reject' : undefined}>
                              Rechazar
                            </span>
                          </button>
                        </div>
                      ) : null
                    }
                  />
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-brand-300">
              Enviados ({outgoing.length})
            </h3>
            {outgoing.length === 0 ? (
              <p className="surface-inset p-3 text-sm text-text-muted">
                No has reclamado ningún reporte.
              </p>
            ) : (
              <ul className="space-y-3">
                {outgoing.map((claim) => (
                  <ClaimRow key={claim.id} claim={claim} actions={null} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <Modal
        open={decision !== null}
        onClose={() => setDecision(null)}
        title={decision?.kind === 'reject' ? 'Rechazar el reclamo' : 'Aprobar el reclamo'}
        description={
          decision?.kind === 'reject'
            ? 'Rechazar es una acusación: queda un strike contra el reclamante.'
            : 'Aprobar libera el contacto del reclamante para que coordinen la entrega.'
        }
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setDecision(null)}
              className="min-h-[44px] cursor-pointer rounded-xl border border-surface-600/60 px-4 py-2 text-sm font-semibold text-surface-200 transition-colors duration-fast hover:bg-surface-700/60 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className={`min-h-[44px] cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold text-white transition-[background-image] duration-base focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
                decision?.kind === 'reject'
                  ? 'bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600'
                  : 'bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600'
              }`}
            >
              {decision?.kind === 'reject' ? 'Sí, rechazar' : 'Sí, aprobar'}
            </button>
          </div>
        }
      >
        <p className="text-sm leading-relaxed text-surface-300">
          {decision?.kind === 'reject' ? (
            <>
              Se registrará un strike contra{' '}
              <span className="font-semibold text-white">{decision.claim.claimantAlias}</span>. Un
              strike es una acusación, no una sentencia: un administrador la revisa y puede levantar
              el bloqueo.
            </>
          ) : (
            <>
              <span className="font-semibold text-white">{decision?.claim.claimantAlias}</span> verá
              tu nombre y tu correo institucional para coordinar la entrega del objeto.
            </>
          )}
        </p>
      </Modal>
    </section>
  );
}

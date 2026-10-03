import type { SavedMonthlyTerms } from './billingConfirmation';
import type { ObligationReviewRow, ObligationSituation } from './billingObligations';

export const billingReviewStatusLabels = {
  unreviewed: 'Sem conferência salva',
  pending: 'Revisão pendente salva',
  confirmed: 'Obrigação confirmada',
  revalidate: 'Fontes alteradas — revalidar',
} as const;
export type BillingReviewStatus = keyof typeof billingReviewStatusLabels;

export function billingReviewStatus(saved: SavedMonthlyTerms | undefined, fingerprint: string | undefined): BillingReviewStatus {
  if (!saved) return 'unreviewed';
  // An absent source must never validate a saved obligation, including when
  // both fingerprints are missing or empty in a malformed legacy record.
  if (!fingerprint || saved.sourceFingerprint !== fingerprint) return 'revalidate';
  return saved.decision === 'charge' ? 'confirmed' : 'pending';
}

export function matchesBillingReviewFilter(
  row: ObligationReviewRow, saved: SavedMonthlyTerms | undefined, fingerprint: string | undefined,
  filter: { status: BillingReviewStatus | ''; situation: ObligationSituation | ''; search: string },
) {
  return (!filter.situation || row.situation === filter.situation) &&
    (!filter.status || billingReviewStatus(saved, fingerprint) === filter.status) &&
    `${row.client} ${row.identity}`.toLocaleLowerCase('pt-BR').includes(filter.search.toLocaleLowerCase('pt-BR'));
}

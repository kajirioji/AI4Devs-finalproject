import { formatAuditDateTime } from '@/lib/format'
import type { ValidationRunView } from './contract'
import { strings } from './strings'

const s = strings.invalidated

/**
 * The last invalidated review of the import, while no review came after it (design D8, criterion 4 of the issue).
 * The comparison is the one #9 leaves to the screen: the invalidation against the review of the current run.
 */
export function InvalidatedReviewNotice({ view }: { view: ValidationRunView }) {
  const last = view.lastInvalidatedReview
  const review = view.run?.review
  if (!last || (review && Date.parse(review.reviewedAt) > Date.parse(last.invalidatedAt))) return null

  const why =
    last.reason === 'rerun'
      ? s.rerun(last.newRunId)
      : last.reason === 'settlement_undone'
        ? s.settlementUndone
        : s.inclusionChange
  return (
    <section
      aria-label={s.label}
      className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <p>
        {s.text(
          last.reviewedBy.userName,
          formatAuditDateTime(last.reviewedAt),
          last.invalidatedBy.userName,
          formatAuditDateTime(last.invalidatedAt),
          why,
        )}
      </p>
    </section>
  )
}

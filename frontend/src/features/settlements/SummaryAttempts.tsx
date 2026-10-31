import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { formatAuditDateTime, formatDecimal } from '@/lib/format'
import type { SettlementView } from './contract'
import { importSettlementsQuery } from './queries'
import { strings } from './strings'

const s = strings.summary

/**
 * The attempts of the import of this attempt, in the order of the API (spec "intentos del import"): shown only when
 * there is more than one. A failure to read them leaves the rest of the screen as it is.
 */
export function SummaryAttempts({ view }: { view: SettlementView }) {
  const { data } = useQuery(importSettlementsQuery(view.importId))
  if (!data || data.items.length < 2) return null

  return (
    <section aria-label={s.attempts.title} className="flex flex-col gap-1 text-sm">
      <h2 className="font-medium">{s.attempts.title}</h2>
      <ul className="flex flex-col gap-1">
        {data.items.map((attempt) => {
          const name = s.batchAttempt(attempt.batchNo, attempt.attemptNo)
          const viewing = attempt.batchId === view.batchId
          return (
            <li
              key={attempt.batchId}
              data-undone={attempt.status === 'undone'}
              className={attempt.status === 'undone' ? 'text-muted-foreground' : undefined}
            >
              {viewing ? (
                <span className="font-medium">
                  {name} ({s.attempts.viewing})
                </span>
              ) : (
                <Link
                  to="/settlements/$batchId"
                  params={{ batchId: attempt.batchId }}
                  className="text-primary underline underline-offset-4"
                >
                  {name}
                </Link>
              )}
              {' · '}
              {s.attempts.line(
                s.status[attempt.settledStatus],
                attempt.approvedBy.userName,
                formatAuditDateTime(attempt.processedAt),
                formatDecimal(attempt.amountPayable),
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

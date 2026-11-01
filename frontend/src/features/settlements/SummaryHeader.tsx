import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { formatAuditDateTime, formatBusinessDate } from '@/lib/format'
import { SETTLED_STATUS_TONE, TONE_NOTICE_CLASS, toneOf } from '@/lib/status-tone'
import type { SettlementView } from './contract'
import { SettlementActions } from './SettlementActions'
import { strings } from './strings'

const s = strings.summary

/** The attempt in a compact grid and whether it is Settled (design D11); its date ranges are in Totals by type (D9). */
export function SummaryHeader({ view }: { view: SettlementView }) {
  const tone = toneOf(SETTLED_STATUS_TONE, view.settledStatus)
  const items: [string, ReactNode][] = [
    [s.grid.account, view.accountName],
    [s.grid.batch, s.batchAttempt(view.batchNo, view.attemptNo)],
    [
      s.grid.status,
      <Badge key="status" variant={tone}>
        {s.status[view.settledStatus]}
      </Badge>,
    ],
    [s.grid.processedBy, s.byAt(view.approvedBy.userName, formatAuditDateTime(view.processedAt))],
    [s.grid.settlementDate, view.settlementDate ? formatBusinessDate(view.settlementDate) : s.notSet],
    ...(view.paidBy && view.paidAt
      ? ([[s.grid.paidBy, s.byAt(view.paidBy.userName, formatAuditDateTime(view.paidAt))]] as [string, ReactNode][])
      : []),
    ...(view.undoneBy && view.undoneAt
      ? ([
          [s.grid.undoneBy, s.byAt(view.undoneBy.userName, formatAuditDateTime(view.undoneAt))],
          [s.grid.undoReason, view.undoReason],
        ] as [string, ReactNode][])
      : []),
  ]

  return (
    <section aria-label={s.title(view.batchNo)} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">{s.title(view.batchNo)}</h1>
        <SettlementActions view={view} />
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm lg:grid-cols-5">
        {items.map(([term, definition]) => (
          <div key={term} className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className="font-medium tabular-nums">{definition}</dd>
          </div>
        ))}
      </dl>
      {view.settledStatus === 'pending_payment' && (
        // The payment is still pending: the colours of the tone of the status Badge (design D8, status notice).
        <p data-tone={tone} className={`rounded-md border p-2 text-sm ${TONE_NOTICE_CLASS[tone]}`}>
          {s.notSettled}
        </p>
      )}
      {view.status === 'undone' && (
        <p className="text-sm">
          <Link
            to="/imports/$importId"
            params={{ importId: view.importId }}
            search={{ step: 'analysis' }}
            className="text-primary underline underline-offset-4"
          >
            {s.goToAnalysis}
          </Link>
        </p>
      )}
    </section>
  )
}

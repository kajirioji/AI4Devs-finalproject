import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { PageMessage } from '@/app/pages/PageMessage'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCanProcess } from '@/features/imports/permissions'
import { ApiError } from '@/lib/api/client'
import type { Cycle, SettlementView } from './contract'
import { TotalsByBrand, TotalsByType } from './FiguresTables'
import { PayableBreakdown } from './PayableBreakdown'
import { settlementQuery } from './queries'
import { SummaryExports } from './SummaryExports'
import { SummaryFees, SummaryReserves } from './SummaryFees'
import { SummaryHeader } from './SummaryHeader'
import { SummaryIssues } from './SummaryIssues'
import { SummaryMovements } from './SummaryMovements'
import { strings } from './strings'
import type { SettlementSummarySearch, SummaryTab } from './summary-search'

const s = strings.summary

/** The attempt as the API sent it (design D11): every figure from the view, nothing added up here. */
function SummaryFigures({ view }: { view: SettlementView }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Two columns only from 1280 px: the totals by type have four columns of figures that must stay in view. */}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{s.totals}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p className="tabular-nums">{strings.preSummary.movements(view.movements)}</p>
            <TotalsByType
              totals={view.totals}
              ranges={view.dateRanges}
              reservesReleased={{ qty: view.reservesReleasedQty, amount: view.reserveReleasedAmt }}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{s.payable}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <SummaryReserves view={view} />
            <PayableBreakdown lines={view.payableBreakdown} amountPayable={view.amountPayable} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{s.brands}</CardTitle>
          </CardHeader>
          <CardContent>
            <TotalsByBrand brands={view.brandTotals} />
          </CardContent>
        </Card>
        <SummaryFees view={view} />
      </div>
      <SummaryIssues view={view} />
      <SummaryExports view={view} />
    </div>
  )
}

/** The header of the attempt, then its Summary and Movements tabs (settlements-browse D10), then the way back. */
function Summary({ view }: { view: SettlementView }) {
  const canProcess = useCanProcess()
  const search = useSearch({ from: '/app/settlements/$batchId' })
  const navigate = useNavigate({ from: '/settlements/$batchId' })
  const tab: SummaryTab = search.tab ?? 'summary'
  const cycle: Cycle = search.cycle ?? 'E'

  return (
    <section className="flex flex-col gap-4">
      <SummaryHeader view={view} />
      <Tabs
        value={tab}
        // A new history entry per tab: Back returns to the previous one.
        onValueChange={(value) =>
          void navigate({
            search: (prev: SettlementSummarySearch) => ({
              ...prev,
              tab: value === 'movements' ? 'movements' : undefined,
            }),
            // The tab keeps the focus and the page stays where it is (ui-polish design D13).
            resetScroll: false,
          })
        }
        className="flex flex-col gap-4"
      >
        <TabsList aria-label={s.tabs.label}>
          <TabsTrigger value="summary">{s.tabs.summary}</TabsTrigger>
          <TabsTrigger value="movements">{s.tabs.movements}</TabsTrigger>
        </TabsList>
        <TabsContent value="summary">
          <SummaryFigures view={view} />
        </TabsContent>
        <TabsContent value="movements">
          <SummaryMovements
            view={view}
            cycle={cycle}
            page={search.page ?? 1}
            onChange={(next, options) =>
              void navigate({
                search: (prev: SettlementSummarySearch) => ({
                  ...prev,
                  cycle: next.cycle === 'E' ? undefined : next.cycle,
                  page: next.page > 1 ? next.page : undefined,
                }),
                replace: options?.replace,
                resetScroll: false,
              })
            }
          />
        </TabsContent>
      </Tabs>
      <div className="flex flex-wrap justify-between gap-3 border-t pt-3 text-sm">
        <div className="flex flex-wrap gap-4">
          <Link to="/" className="text-primary underline underline-offset-4">
            {s.backToDashboard}
          </Link>
          <Link
            to="/settlements"
            search={{ accountId: view.accountId }}
            className="text-primary underline underline-offset-4"
          >
            {s.backToList(view.accountName)}
          </Link>
        </div>
        {canProcess && (
          <Link to="/reconciliations/new" className="text-primary underline underline-offset-4">
            {s.newReconciliation}
          </Link>
        )}
      </div>
    </section>
  )
}

/**
 * Reconciliation › Settlement Summary of an attempt (design D1, D11): the 201 of Process seeded in the cache or, on
 * a reload, GET /settlements/{id}. Anyone in scope may read it; only the actions of its header write.
 */
export function SettlementSummaryPage() {
  const { batchId } = useParams({ from: '/app/settlements/$batchId' })
  const query = useQuery(settlementQuery(batchId))

  if (query.isPending) return <Skeleton className="h-40 w-full" aria-label={s.loading} />
  if (query.isError) {
    if (query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 400)) {
      return <PageMessage title={s.notFoundTitle} body={s.notFoundBody} />
    }
    return (
      <div className="flex items-center gap-3 text-sm">
        <span>{s.loadError}</span>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          {strings.retry}
        </Button>
      </div>
    )
  }
  return <Summary view={query.data} />
}

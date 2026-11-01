// What the screen offers by permission and import status (design D10). Presentation only: the API enforces both.
import type { ImportStatus } from '@/lib/api/types'
import { useMe } from '@/lib/session/me'

const EDITABLE: readonly ImportStatus[] = ['uploaded', 'mapped']
const CANCELLABLE: readonly ImportStatus[] = ['uploaded', 'mapped', 'analyzed', 'validated']

export function useCanProcess(): boolean {
  return useMe().permissions.includes('settlement.process')
}

export function useCanPay(): boolean {
  return useMe().permissions.includes('payment.process')
}

/** Files and mapping can change: the user may process and the import is before the analysis. */
export function useImportAccess(status: ImportStatus) {
  const canProcess = useCanProcess()
  return {
    canProcess,
    editable: canProcess && EDITABLE.includes(status),
    cancellable: canProcess && CANCELLABLE.includes(status),
  }
}

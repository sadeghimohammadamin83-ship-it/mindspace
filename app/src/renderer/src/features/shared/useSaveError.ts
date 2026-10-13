import { useCallback } from 'react'
import { useToast } from '@/design-system/components'
import { useI18n } from '@/state/preferences'

/** Shows that a write failed and nothing was saved. Validation details stay in the form. */
export function useSaveError(): (err: unknown) => void {
  const toast = useToast()
  const { t } = useI18n()
  return useCallback(
    (err: unknown) => {
      console.error('Save failed', err)
      toast({ title: t.common.saveFailed, description: t.common.saveFailedHint, tone: 'error' })
    },
    [toast, t]
  )
}

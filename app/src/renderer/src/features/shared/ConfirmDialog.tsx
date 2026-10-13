import { Button, Dialog } from '@/design-system/components'
import { useI18n } from '@/state/preferences'

/** Asks before an action that cannot be undone. The confirm button shows progress and blocks double clicks. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy,
  onConfirm,
  onCancel
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && onCancel()}
      title={title}
      description={description}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={Boolean(busy)}>
            {t.common.cancel}
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={Boolean(busy)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <span className="sr-only">{description}</span>
    </Dialog>
  )
}

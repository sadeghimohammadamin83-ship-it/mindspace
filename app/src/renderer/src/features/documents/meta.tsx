import { FileText, FileType2, Hash } from 'lucide-react'
import type { DocumentFormat, DocumentStatus } from '@shared/documents'
import { Badge } from '@/design-system/components'
import { useI18n } from '@/state/preferences'

export function FormatIcon({ format, size = 15 }: { format: DocumentFormat; size?: number }) {
  const Icon = format === 'pdf' ? FileType2 : format === 'md' ? Hash : FileText
  return <Icon size={size} strokeWidth={1.75} className="text-fg-subtle" aria-hidden />
}

const tones = { imported: 'neutral', processing: 'info', indexed: 'success', no_text: 'warning', failed: 'danger' } as const

export function StatusBadge({ status }: { status: DocumentStatus }) {
  const { t } = useI18n()
  return (
    <Badge tone={tones[status]} dot>
      {t.documents.status[status]}
    </Badge>
  )
}

export function formatBytes(n: number, number: (n: number) => string): string {
  if (n < 1024) return `${number(n)} B`
  if (n < 1024 * 1024) return `${number(Math.round(n / 102.4) / 10)} KB`
  return `${number(Math.round(n / (1024 * 102.4)) / 10)} MB`
}

import { Link } from 'react-router'
import { Compass } from 'lucide-react'
import { buttonClass, EmptyState } from '@/design-system/components'
import { useI18n } from '@/state/preferences'

export default function NotFoundPage() {
  const { t } = useI18n()
  return (
    <EmptyState
      icon={Compass}
      title={t.errors.notFoundTitle}
      description={t.errors.notFoundHint}
      action={
        <Link to="/" className={buttonClass('secondary')}>
          {t.errors.toDashboard}
        </Link>
      }
    />
  )
}

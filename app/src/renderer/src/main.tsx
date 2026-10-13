import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/design-system/base.css'
import { App } from '@/app/App'
import type { Preferences } from '@/state/preferences'

const root = document.getElementById('root')
if (!root) throw new Error('Root element missing')

const data = window.mindspace?.data

/** Stored preferences are read before the first paint, so language and direction never flicker. */
async function loadPreferences(): Promise<Partial<Preferences>> {
  try {
    const result = await data?.getPreferences()
    return result?.ok ? result.value : {}
  } catch {
    return {}
  }
}

function savePreferences(patch: Partial<Preferences>): void {
  void data?.setPreferences(patch).then(
    (r) => !r.ok && console.error('Preference not saved', r.error.message),
    (err: unknown) => console.error('Preference not saved', err)
  )
}

void loadPreferences().then((preferences) => {
  createRoot(root).render(
    <StrictMode>
      <App preferences={preferences} onPreferencesChange={savePreferences} />
    </StrictMode>
  )
})

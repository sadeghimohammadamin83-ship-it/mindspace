import { lazy } from 'react'
import { HashRouter, Route, Routes } from 'react-router'
import { MotionProvider, ToastProvider, TooltipProvider } from '@/design-system/components'
import { PreferencesProvider, useI18n, type Preferences } from '@/state/preferences'
import { WorkspaceProvider } from '@/state/workspace'
import type { DataBridge } from '@shared/ipc'
import type { DocumentsBridge } from '@shared/documents'
import { defaultDocumentsApi, DocumentsProvider } from '@/state/documents'
import { AiProvider, defaultAiApi } from '@/state/ai'
import { BackupProvider, defaultBackupApi } from '@/state/backup'
import type { BackupBridge } from '@shared/backup'
import { defaultRetrievalApi, RetrievalProvider } from '@/state/retrieval'
import type { AiBridge } from '@shared/ai'
import type { RetrievalBridge } from '@shared/retrieval'
import { AppShell } from './AppShell'
import { CaptureDialogProvider } from './CaptureDialog'
import { WorkspaceStatus } from './WorkspaceStatus'

// Each screen is its own chunk, loaded on first visit.
const Dashboard = lazy(() => import('@/features/dashboard/DashboardPage'))
const Capture = lazy(() => import('@/features/capture/CapturePage'))
const Library = lazy(() => import('@/features/library/LibraryPage'))
const Projects = lazy(() => import('@/features/projects/ProjectsPage'))
const ProjectDetail = lazy(() => import('@/features/projects/ProjectDetailPage'))
const Tasks = lazy(() => import('@/features/tasks/TasksPage'))
const Decisions = lazy(() => import('@/features/decisions/DecisionsPage'))
const Documents = lazy(() => import('@/features/documents/DocumentsPage'))
const DocumentDetail = lazy(() => import('@/features/documents/DocumentDetailPage'))
const Tags = lazy(() => import('@/features/tags/TagsPage'))
const Ask = lazy(() => import('@/features/ask/AskPage'))
const Briefing = lazy(() => import('@/features/briefing/BriefingPage'))
const Settings = lazy(() => import('@/features/settings/SettingsPage'))
const NotFound = lazy(() => import('@/features/shared/NotFoundPage'))

function Shell() {
  const { t } = useI18n()
  return (
    <ToastProvider closeLabel={t.common.close}>
      <TooltipProvider>
        <CaptureDialogProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<Dashboard />} />
              <Route path="capture" element={<Capture />} />
              <Route path="library" element={<Library />} />
              <Route path="documents" element={<Documents />} />
              <Route path="documents/:documentId" element={<DocumentDetail />} />
              <Route path="projects" element={<Projects />} />
              <Route path="projects/:projectId" element={<ProjectDetail />} />
              <Route path="tasks" element={<Tasks />} />
              <Route path="decisions" element={<Decisions />} />
              <Route path="tags" element={<Tags />} />
              <Route path="ask" element={<Ask />} />
              <Route path="briefing" element={<Briefing />} />
              <Route path="settings" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </CaptureDialogProvider>
      </TooltipProvider>
    </ToastProvider>
  )
}

interface AppProps {
  /** Data API; defaults to the preload bridge. Tests pass one backed by a temporary database. */
  api?: DataBridge | null
  /** Document/search API; defaults to the preload bridge. */
  documentsApi?: DocumentsBridge | null
  /** Retrieval API (semantic/hybrid search); defaults to the preload bridge. */
  retrievalApi?: RetrievalBridge | null
  /** AI answer API; defaults to the preload bridge. */
  aiApi?: AiBridge | null
  /** Backup API; defaults to the preload bridge. */
  backupApi?: BackupBridge | null
  preferences?: Partial<Preferences>
  onPreferencesChange?: (patch: Partial<Preferences>) => void
}

export function App({ api, documentsApi, retrievalApi, aiApi, backupApi, preferences, onPreferencesChange }: AppProps = {}) {
  return (
    <PreferencesProvider {...(preferences ? { initial: preferences } : {})} {...(onPreferencesChange ? { onChange: onPreferencesChange } : {})}>
      <MotionProvider>
        <WorkspaceProvider
          {...(api !== undefined ? { api } : {})}
          fallback={(state, retry) => <WorkspaceStatus state={state} onRetry={retry} />}
        >
          <DocumentsProvider api={documentsApi !== undefined ? documentsApi : defaultDocumentsApi()}>
            <RetrievalProvider api={retrievalApi !== undefined ? retrievalApi : defaultRetrievalApi()}>
              <AiProvider api={aiApi !== undefined ? aiApi : defaultAiApi()}>
                <BackupProvider api={backupApi !== undefined ? backupApi : defaultBackupApi()}>
                  <HashRouter>
                    <Shell />
                  </HashRouter>
                </BackupProvider>
              </AiProvider>
            </RetrievalProvider>
          </DocumentsProvider>
        </WorkspaceProvider>
      </MotionProvider>
    </PreferencesProvider>
  )
}

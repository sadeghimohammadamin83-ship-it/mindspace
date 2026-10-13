import { useCallback, useState } from 'react'
import type { Task } from '@shared/domain'
import type { TaskInput } from '@/state/workspace'
import type { TaskEditorState } from './TaskEditorDialog'

/** Local open/close state for the shared task editor dialog. */
export function useTaskEditor() {
  const [state, setState] = useState<TaskEditorState>({ open: false })
  const openNew = useCallback((defaults?: Partial<TaskInput>) => setState({ open: true, ...(defaults ? { defaults } : {}) }), [])
  const openEdit = useCallback((task: Task) => setState({ open: true, task }), [])
  const close = useCallback(() => setState((s) => ({ ...s, open: false })), [])
  return { state, openNew, openEdit, close }
}

export type EditorSelection = {
  ide: string
  filePath: string
  startLine: number
  endLine: number
  isEmpty: boolean
  text: string
}

declare module 'claude-code' {
  interface PluginState {
    'editor-context': {
      selection: EditorSelection | null
      ide: string | null
      isPaused: boolean
      isDirty: boolean
      pinned: EditorSelection | null
      recent: string[]
      isRecentHidden: boolean
      isDemo: boolean
    }
  }
}

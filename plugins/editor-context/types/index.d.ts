export type EditorSelection = {
  ide: string
  filePath: string
  startLine: number
  endLine: number
  isEmpty: boolean
  text: string
}

/** What the mod attached to one message, drawn as chips above it on the desktop. */
export type Attached = { text: string; chips: { icon: 'file' | 'pin'; label: string }[] }

declare module 'claude-code' {
  interface PluginState {
    'editor-context': {
      selection: EditorSelection | null
      ide: string | null
      isPaused: boolean
      isDirty: boolean
      pins: EditorSelection[]
      recent: string[]
      isRecentHidden: boolean
      isDemo: boolean
      notice: { kind: string; ide?: string } | null
      isNoticeHidden: boolean
      /** Explain's message is still being worked on: the button ignores presses until its turn completes. */
      isExplaining: boolean
      /** Sharing is on (the Editor tab, or the switch in its card). Off, nothing is sent. */
      isShown: boolean
      /** The last messages that went out with editor context, newest last. */
      attached: Attached[]
    }
  }
}

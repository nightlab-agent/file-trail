/** One file or search tool call, as the pane and the file show it. */
export type Entry = {
  /** ISO time the call was answered. */
  at: string
  tool: string
  /** The path, pattern or command the call named. */
  target: string
  /** ok, error (the tool answered with an error) or blocked (a hook or rule denied it). */
  outcome: 'ok' | 'error' | 'blocked'
  /** Present in a subagent's loop. */
  agentId?: string
}

declare module 'claude-code' {
  interface PluginState {
    'file-trail': { entries: Shaped<Entry[]> }
  }
}

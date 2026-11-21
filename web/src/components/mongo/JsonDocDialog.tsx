import { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { EditorView } from '@codemirror/view'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'

const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--background)', color: 'var(--foreground)', fontSize: '13px', height: '100%' },
  '.cm-content': { fontFamily: 'var(--font-mono)', caretColor: 'var(--primary)' },
  '.cm-gutters': { backgroundColor: 'var(--background)', color: 'var(--muted-foreground)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'color-mix(in oklch, var(--muted) 60%, transparent)' },
  '&.cm-focused': { outline: 'none' },
})

/**
 * Edit or insert a document as JSON. MongoDB Extended JSON is kept as typed
 * ({"$oid": …}, {"$date": …}), so ObjectIds and dates survive the round trip.
 */
export function JsonDocDialog({ open, title, initial, saveLabel, onClose, onSave }: {
  open: boolean; title: string; initial: string; saveLabel: string; onClose: () => void; onSave: (doc: unknown) => Promise<boolean>
}) {
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setText(initial)
  }, [open, initial])
  const error = useMemo(() => {
    try {
      const v = JSON.parse(text)
      return v && typeof v === 'object' && !Array.isArray(v) ? '' : 'A document must be a JSON object: { … }'
    } catch (e) {
      return (e as Error).message
    }
  }, [text])
  const extensions = useMemo(() => [json(), theme, EditorView.lineWrapping], [])

  async function save() {
    if (error) return
    setBusy(true)
    try {
      if (await onSave(JSON.parse(text))) onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={title} className="max-w-3xl">
      <div className="flex h-[min(640px,85vh)] flex-col" onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 's' && (e.preventDefault(), save())}>
        <header className="border-b px-5 py-3.5 pr-14">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">JSON with MongoDB types, e.g. {'{"$oid": "…"}'} or {'{"$date": "2024-01-02T00:00:00Z"}'}</p>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          <CodeMirror value={text} onChange={setText} extensions={extensions} theme="none" height="100%" className="h-full" autoFocus aria-label="Document JSON" />
        </div>
        <footer className="flex items-center gap-2 border-t bg-sidebar/60 px-5 py-3">
          <p role={error ? 'alert' : undefined} className={error ? 'min-w-0 flex-1 truncate text-[13px] text-destructive' : 'flex-1 text-[13px] text-success'}>{error || 'Valid JSON'}</p>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={busy} disabled={!!error} onClick={save}>{saveLabel} (Ctrl S)</Button>
        </footer>
      </div>
    </Dialog>
  )
}

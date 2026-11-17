import { useMemo } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { EditorView, keymap } from '@codemirror/view'
import { Prec } from '@codemirror/state'
import { MySQL, PostgreSQL, SQLite, sql } from '@codemirror/lang-sql'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { DriverName } from '@/lib/api'

const dialects = { postgres: PostgreSQL, mysql: MySQL, sqlite: SQLite }

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.typeName, t.standard(t.name)], color: 'var(--syn-name)' },
])

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--background)', color: 'var(--foreground)', fontSize: '13.5px' },
  '.cm-content': { fontFamily: 'var(--font-mono)', caretColor: 'var(--primary)', padding: '10px 0' },
  '.cm-gutters': { backgroundColor: 'var(--background)', color: 'var(--muted-foreground)', border: 'none', paddingLeft: '6px' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--muted) 60%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--foreground)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in oklch, var(--primary) 25%, transparent) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--primary)', borderLeftWidth: '2px' },
  '.cm-tooltip': { backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden', boxShadow: 'var(--shadow)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--accent-foreground)' },
  '.cm-completionDetail': { color: 'var(--muted-foreground)', fontStyle: 'normal', marginLeft: '8px' },
  '.cm-placeholder': { color: 'var(--muted-foreground)' },
})

type Props = {
  value: string
  onChange: (v: string) => void
  dialect: DriverName
  schema: Record<string, string[]>
  onRun: () => void
  editorRef?: React.Ref<ReactCodeMirrorRef>
}

export function SqlEditor({ value, onChange, dialect, schema, onRun, editorRef }: Props) {
  const extensions = useMemo(
    () => [
      sql({ dialect: dialects[dialect], schema, upperCaseKeywords: true }),
      syntaxHighlighting(highlight),
      theme,
      EditorView.lineWrapping,
      Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => (onRun(), true) }])),
    ],
    [dialect, schema, onRun],
  )
  return (
    <CodeMirror
      ref={editorRef}
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme="none"
      height="100%"
      placeholder="Write SQL here. Press Ctrl+Enter to run."
      basicSetup={{ foldGutter: false, highlightActiveLineGutter: true, autocompletion: true, bracketMatching: true }}
      className="h-full"
      aria-label="SQL editor"
    />
  )
}

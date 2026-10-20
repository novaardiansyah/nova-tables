import { useEffect, useRef } from 'react'
import Editor from '@monaco-editor/react'
import { editorThemeName } from '../monaco.js'
import { Spinner } from './Icon.jsx'

const EDITOR_OPTIONS = {
  fontFamily:
    "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Noto Sans Mono', monospace",
  fontSize: 13,
  lineHeight: 21,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: 'on',
  renderLineHighlight: 'line',
  lineNumbersMinChars: 3,
  folding: true,
  glyphMargin: false,
  bracketPairColorization: { enabled: true },
  padding: { top: 12, bottom: 12 },
  wordWrap: 'off',
  tabSize: 2,
  automaticLayout: true,
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  parameterHints: { enabled: false },
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  renderWhitespace: 'none',
  fixedOverflowWidgets: true,
}

export default function QueryEditor({ seed, theme, onChange, onRun }) {
  const editorRef = useRef(null)
  const handlersRef = useRef({ onChange, onRun })
  const lastSeedRef = useRef(null)
  const seedingRef = useRef(false)

  useEffect(() => {
    handlersRef.current = { onChange, onRun }
  }, [onChange, onRun])

  useEffect(() => {
    if (lastSeedRef.current === null || lastSeedRef.current === seed.id) {
      lastSeedRef.current = seed.id
      return
    }
    lastSeedRef.current = seed.id

    const editor = editorRef.current
    if (!editor) return
    seedingRef.current = true
    editor.setValue(seed.value)
    seedingRef.current = false
    editor.setPosition({ lineNumber: 1, column: 1 })
    if (seed.focus !== false) editor.focus()
  }, [seed])

  function handleMount(editor, monaco) {
    editorRef.current = editor
    editor.addAction({
      id: 'nova.runQuery',
      label: 'Run query',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, monaco.KeyCode.F5],
      run: () => handlersRef.current.onRun?.(),
    })
    editor.focus()
  }

  return (
    <div className="h-full w-full">
      <Editor
        language="sql"
        theme={editorThemeName(theme)}
        defaultValue={seed.value}
        onMount={handleMount}
        onChange={(value) => {
          if (seedingRef.current) return
          handlersRef.current.onChange?.(value ?? '')
        }}
        options={EDITOR_OPTIONS}
        loading={
          <div className="flex items-center gap-2 p-4 text-[length:var(--app-text-12)] text-slate-500">
            <Spinner size={13} />
            Loading editor…
          </div>
        }
      />
    </div>
  )
}

import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

self.MonacoEnvironment = {
  getWorker: () => new editorWorker(),
}

loader.config({ monaco })

export const NOVA_THEME = 'nova-dark'

monaco.editor.defineTheme(NOVA_THEME, {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'D6DCE7' },
    { token: 'keyword', foreground: '6EA8FF' },
    { token: 'keyword.block', foreground: '6EA8FF' },
    { token: 'keyword.choice', foreground: '6EA8FF' },
    { token: 'keyword.try', foreground: '6EA8FF' },
    { token: 'predefined', foreground: 'A78BFA' },
    { token: 'string', foreground: '8FD48B' },
    { token: 'identifier', foreground: 'D6DCE7' },
    { token: 'identifier.quote', foreground: 'F0B775' },
    { token: 'quotedIdentifier', foreground: 'F0B775' },
    { token: 'number', foreground: 'F0B775' },
    { token: 'operator', foreground: '8B93A1' },
    { token: 'delimiter', foreground: '8B93A1' },
    { token: 'comment', foreground: '606A7A' },
    { token: 'comment.quote', foreground: '606A7A' },
  ],
  colors: {
    'editor.background': '#10131A',
    'editor.foreground': '#D6DCE7',
    'editor.lineHighlightBackground': '#141924',
    'editor.lineHighlightBorder': '#00000000',
    'editorLineNumber.foreground': '#39414F',
    'editorLineNumber.activeForeground': '#7B8598',
    'editorCursor.foreground': '#4F8CFF',
    'editor.selectionBackground': '#22344F',
    'editor.inactiveSelectionBackground': '#1B2739',
    'editor.selectionHighlightBackground': '#22304755',
    'editorIndentGuide.background': '#1A1F29',
    'editorIndentGuide.activeBackground': '#2A3340',
    'editorBracketMatch.background': '#22344F66',
    'editorBracketMatch.border': '#4F8CFF66',
    'editorGutter.background': '#10131A',
    'editorWidget.background': '#161B23',
    'editorWidget.border': '#262D38',
    'input.background': '#0C0F14',
    'input.border': '#262D38',
    'focusBorder': '#4F8CFF66',
    'list.hoverBackground': '#1A202B',
    'scrollbarSlider.background': '#232A3566',
    'scrollbarSlider.hoverBackground': '#232A35AA',
    'scrollbarSlider.activeBackground': '#333D4C',
  },
})

export { monaco }

export const THEMES = [
  { id: 'nova', label: 'Nova Blue' },
  { id: 'midnight', label: 'Midnight Violet' },
  { id: 'graphite', label: 'Graphite Amber' },
  { id: 'forest', label: 'Forest Green' },
  { id: 'rose', label: 'Rose Quartz' },
]

export const FONT_FAMILIES = [
  {
    id: 'inter',
    label: 'Inter',
    value: "'Inter', system-ui, 'Segoe UI', Helvetica, Arial, sans-serif",
  },
  {
    id: 'system',
    label: 'System UI',
    value: "system-ui, 'Segoe UI', Helvetica, Arial, sans-serif",
  },
  {
    id: 'jetbrains',
    label: 'JetBrains Mono',
    value: "'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, monospace",
  },
  {
    id: 'mono',
    label: 'Monospace',
    value: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  },
]

export const FONT_SIZES = [11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 16]

const APP_BASE_SIZE = 13

export const DEFAULT_SETTINGS = {
  theme: 'nova',
  appFontSize: 13,
  appFontFamily: 'inter',
  gridFontSize: 12.5,
  gridFontFamily: 'inter',
  jsonFontSize: 12.5,
  jsonFontFamily: 'jetbrains',
}

function normalizeFontSize(value, fallback) {
  const size = Number(value)
  return FONT_SIZES.includes(size) ? size : fallback
}

function normalizeFontFamily(value, fallback) {
  return FONT_FAMILIES.some((family) => family.id === value) ? value : fallback
}

export function normalizeSettings(input) {
  const source = input && typeof input === 'object' ? input : {}

  return {
    theme: THEMES.some((theme) => theme.id === source.theme) ? source.theme : DEFAULT_SETTINGS.theme,
    appFontSize: normalizeFontSize(source.appFontSize, DEFAULT_SETTINGS.appFontSize),
    appFontFamily: normalizeFontFamily(source.appFontFamily, DEFAULT_SETTINGS.appFontFamily),
    gridFontSize: normalizeFontSize(source.gridFontSize, DEFAULT_SETTINGS.gridFontSize),
    gridFontFamily: normalizeFontFamily(source.gridFontFamily, DEFAULT_SETTINGS.gridFontFamily),
    jsonFontSize: normalizeFontSize(source.jsonFontSize, DEFAULT_SETTINGS.jsonFontSize),
    jsonFontFamily: normalizeFontFamily(source.jsonFontFamily, DEFAULT_SETTINGS.jsonFontFamily),
  }
}

export function fontFamilyValue(id) {
  const family = FONT_FAMILIES.find((item) => item.id === id) || FONT_FAMILIES[0]
  return family.value
}

export function applySettings(input) {
  const settings = normalizeSettings(input)
  const root = document.documentElement

  root.dataset.theme = settings.theme
  root.style.setProperty('--app-font-scale', String(settings.appFontSize / APP_BASE_SIZE))
  root.style.setProperty('--app-font-family', fontFamilyValue(settings.appFontFamily))
  root.style.setProperty('--grid-font-size', `${settings.gridFontSize}px`)
  root.style.setProperty('--grid-font-family', fontFamilyValue(settings.gridFontFamily))
  root.style.setProperty('--json-font-size', `${settings.jsonFontSize}px`)
  root.style.setProperty('--json-font-family', fontFamilyValue(settings.jsonFontFamily))

  return settings
}

export const THEMES = [
  { id: 'nova', label: 'Nova Blue' },
  { id: 'midnight', label: 'Midnight Violet' },
  { id: 'graphite', label: 'Graphite Amber' },
  { id: 'forest', label: 'Forest Green' },
  { id: 'rose', label: 'Rose Quartz' },
]

const SANS_STACK =
  "ui-sans-serif, -apple-system, system-ui, 'Segoe UI', 'Helvetica Neue', Arial, 'Liberation Sans', 'DejaVu Sans', 'Noto Sans', 'Noto Sans CJK JP', sans-serif"

const MONO_STACK =
  "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Noto Sans Mono', monospace"

export const FONT_FAMILIES = [
  { id: 'system', label: 'System UI', value: SANS_STACK },
  { id: 'mono', label: 'Monospace', value: MONO_STACK },
]

export const FONT_SIZES = [11, 12, 13, 14, 15, 16]

const APP_BASE_SIZE = 13
const APP_LADDER = [9, 10, 11, 12, 13, 14, 15]

export const DEFAULT_SETTINGS = {
  theme: 'nova',
  appFontSize: 13,
  appFontFamily: 'system',
  gridFontSize: 12,
  gridFontFamily: 'system',
  jsonFontSize: 12,
  jsonFontFamily: 'mono',
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
  const scale = settings.appFontSize / APP_BASE_SIZE

  root.dataset.theme = settings.theme
  APP_LADDER.forEach((size) => {
    root.style.setProperty(`--app-text-${size}`, `${Math.round(size * scale)}px`)
  })
  root.style.setProperty('--app-font-family', fontFamilyValue(settings.appFontFamily))
  root.style.setProperty('--grid-font-size', `${settings.gridFontSize}px`)
  root.style.setProperty('--grid-font-family', fontFamilyValue(settings.gridFontFamily))
  root.style.setProperty('--json-font-size', `${settings.jsonFontSize}px`)
  root.style.setProperty('--json-font-family', fontFamilyValue(settings.jsonFontFamily))

  return settings
}

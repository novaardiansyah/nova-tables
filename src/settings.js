export const THEMES = [
  { id: 'nova', label: 'Nova Blue' },
  { id: 'midnight', label: 'Midnight Violet' },
  { id: 'graphite', label: 'Graphite Amber' },
  { id: 'forest', label: 'Forest Green' },
  { id: 'rose', label: 'Rose Quartz' },
  { id: 'light-nova', label: 'Light Nova' },
  { id: 'light-midnight', label: 'Light Midnight' },
  { id: 'light-graphite', label: 'Light Graphite' },
  { id: 'light-forest', label: 'Light Forest' },
  { id: 'light-rose', label: 'Light Rose' },
]

const SANS_FALLBACK =
  "-apple-system, system-ui, 'Segoe UI', 'Helvetica Neue', Arial, 'Liberation Sans', 'DejaVu Sans', 'Noto Sans', 'Noto Sans CJK JP', sans-serif"

const MONO_FALLBACK =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Noto Sans Mono', monospace"

export const FONT_FAMILIES = [
  { id: 'system', label: 'System UI', value: `ui-sans-serif, ${SANS_FALLBACK}` },
  { id: 'inter', label: 'Inter', value: `'Inter', ${SANS_FALLBACK}` },
  { id: 'hack', label: 'Hack', value: `'Hack', ${MONO_FALLBACK}` },
  { id: 'jetbrains', label: 'JetBrains Mono', value: `'JetBrains Mono', ${MONO_FALLBACK}` },
  { id: 'mono', label: 'Monospace', value: MONO_FALLBACK },
]

export const FONT_SIZES = [11, 12, 13, 14, 15, 16]

export const QUERY_SIZES = [11, 12, 13, 14, 15, 16, 17, 18]

const APP_BASE_SIZE = 13
const APP_LADDER = [9, 10, 11, 12, 13, 14, 15]
const listeners = new Set()

export const DEFAULT_SETTINGS = {
  theme: 'nova',
  appFontSize: 13,
  appFontFamily: 'system',
  gridFontSize: 12,
  gridFontFamily: 'system',
  jsonFontSize: 12,
  jsonFontFamily: 'mono',
  queryFontSize: 13,
  queryFontFamily: 'hack',
}

function normalizeFontSize(value, fallback) {
  const size = Number(value)
  return FONT_SIZES.includes(size) ? size : fallback
}

function normalizeQueryFontSize(value, fallback) {
  const size = Number(value)
  return QUERY_SIZES.includes(size) ? size : fallback
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
    queryFontSize: normalizeQueryFontSize(source.queryFontSize, DEFAULT_SETTINGS.queryFontSize),
    queryFontFamily: normalizeFontFamily(source.queryFontFamily, DEFAULT_SETTINGS.queryFontFamily),
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
  root.style.setProperty('--query-font-size', `${settings.queryFontSize}px`)
  root.style.setProperty('--query-font-family', fontFamilyValue(settings.queryFontFamily))

  listeners.forEach((listener) => listener(settings))

  return settings
}

export function subscribeSettings(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function queryFontOptions(settings) {
  const normalized = normalizeSettings(settings)
  return {
    fontFamily: fontFamilyValue(normalized.queryFontFamily),
    fontSize: normalized.queryFontSize,
    lineHeight: Math.round(normalized.queryFontSize * 1.6),
  }
}

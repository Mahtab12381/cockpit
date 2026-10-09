// The mod's look. Raw hex colors, the same in every terminal theme; the gradient preset
// is picked in the settings and swapped in place by applyTheme, so every drawing reads it.

import type { ThemeName } from '../types'

type Preset = { label: string; primary: string[]; secondary: string[]; chip: string; rowHover: string }

export const THEMES: Record<ThemeName, Preset> = {
  aurora: {
    label: 'aurora',
    primary: ['#22D3EE', '#8B5CF6', '#EC4899'],
    secondary: ['#F59E0B', '#EC4899', '#8B5CF6'],
    chip: '#8B5CF6',
    rowHover: '#2E2A4A',
  },
  sunset: {
    label: 'sunset',
    primary: ['#FBBF24', '#F97316', '#EC4899'],
    secondary: ['#FDE047', '#F97316', '#DB2777'],
    chip: '#EA580C',
    rowHover: '#3A2A20',
  },
  ocean: {
    label: 'ocean',
    primary: ['#38BDF8', '#3B82F6', '#6366F1'],
    secondary: ['#2DD4BF', '#38BDF8', '#6366F1'],
    chip: '#2563EB',
    rowHover: '#1E2A44',
  },
  forest: {
    label: 'forest',
    primary: ['#A3E635', '#34D399', '#14B8A6'],
    secondary: ['#FDE047', '#A3E635', '#34D399'],
    chip: '#059669',
    rowHover: '#1E3A2E',
  },
  neon: {
    label: 'neon',
    primary: ['#FF4FD8', '#A855F7', '#22D3EE'],
    secondary: ['#F472B6', '#C084FC', '#67E8F9'],
    chip: '#C026D3',
    rowHover: '#3B1E46',
  },
}

export const THEME_NAMES = Object.keys(THEMES) as ThemeName[]
export const DEFAULT_THEME: ThemeName = 'aurora'

// the current theme's gradients, swapped in place by applyTheme
export const AURORA: string[] = [...THEMES.aurora.primary]
export const SUNSET: string[] = [...THEMES.aurora.secondary]
export const MINT = ['#34D399', '#22D3EE'] as const
// usage bars: green while there is plenty left, through amber, to red near the limit
export const HEAT = ['#34D399', '#F59E0B', '#F43F5E'] as const

export const THEME = {
  on: '#34D399',
  off: '#6B7280',
  muted: '#9CA3AF',
  faint: '#4B5563',
  track: '#374151',
  chipText: '#FFFFFF',
  chip: THEMES.aurora.chip,
  rowHover: THEMES.aurora.rowHover,
  border: THEMES.aurora.primary[1]!,
  borderOff: '#374151',
  warn: '#F59E0B',
  danger: '#F43F5E',
}

export function applyTheme(name: ThemeName): void {
  const preset = THEMES[name] ?? THEMES[DEFAULT_THEME]
  AURORA.splice(0, AURORA.length, ...preset.primary)
  SUNSET.splice(0, SUNSET.length, ...preset.secondary)
  THEME.chip = preset.chip
  THEME.rowHover = preset.rowHover
  THEME.border = preset.primary[1]!
}

export const isThemeName = (raw: unknown): raw is ThemeName => typeof raw === 'string' && raw in THEMES

const hex = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
const toHex = (rgb: number[]) => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')

// One color per position, blended evenly across the stops.
export function gradient(count: number, stops: readonly string[] = AURORA): string[] {
  if (count <= 0) return []
  if (count === 1 || stops.length === 1) return Array.from({ length: count }, () => stops[0]!)
  const rgb = stops.map(hex)
  return Array.from({ length: count }, (_, i) => {
    const t = (i / (count - 1)) * (rgb.length - 1)
    const at = Math.min(rgb.length - 2, Math.floor(t))
    const f = t - at
    const a = rgb[at]!
    const b = rgb[at + 1]!
    return toHex(a.map((v, k) => v + (b[k]! - v) * f))
  })
}

// used% → a color from mint (plenty left) through amber to rose (nearly out)
export const usageColor = (used: number) => (used >= 85 ? THEME.danger : used >= 60 ? THEME.warn : THEME.on)

export const LIGHT_THEMES = [
  'ayu-light',
  'catppuccin-latte',
  'everforest-light',
  'github-light',
  'github-light-default',
  'github-light-high-contrast',
  'gruvbox-light-hard',
  'gruvbox-light-medium',
  'gruvbox-light-soft',
  'horizon-bright',
  'kanagawa-lotus',
  'light-plus',
  'material-theme-lighter',
  'min-light',
  'night-owl-light',
  'one-light',
  'rose-pine-dawn',
  'slack-ochin',
  'snazzy-light',
  'solarized-light',
  'vitesse-light',
] as const
export const DARK_THEMES = [
  'andromeeda',
  'aurora-x',
  'ayu-dark',
  'ayu-mirage',
  'catppuccin-frappe',
  'catppuccin-macchiato',
  'catppuccin-mocha',
  'dark-plus',
  'dracula',
  'dracula-soft',
  'everforest-dark',
  'github-dark',
  'github-dark-default',
  'github-dark-dimmed',
  'github-dark-high-contrast',
  'gruvbox-dark-hard',
  'gruvbox-dark-medium',
  'gruvbox-dark-soft',
  'horizon',
  'houston',
  'kanagawa-dragon',
  'kanagawa-wave',
  'laserwave',
  'material-theme',
  'material-theme-darker',
  'material-theme-ocean',
  'material-theme-palenight',
  'min-dark',
  'monokai',
  'night-owl',
  'nord',
  'one-dark-pro',
  'plastic',
  'poimandres',
  'red',
  'rose-pine',
  'rose-pine-moon',
  'slack-dark',
  'solarized-dark',
  'synthwave-84',
  'tokyo-night',
  'vesper',
  'vitesse-black',
  'vitesse-dark',
] as const

export type LightTheme = typeof LIGHT_THEMES[number]
export type DarkTheme = typeof DARK_THEMES[number]
export type CodeTheme = LightTheme | DarkTheme
export type CodeThemeMode = 'light' | 'dark'

export const CODE_THEME_MODE_KEY = 'codearchive-code-theme-mode'

export function isLightTheme(value: string): value is LightTheme {
  return LIGHT_THEMES.some(theme => theme === value)
}

export function isDarkTheme(value: string): value is DarkTheme {
  return DARK_THEMES.some(theme => theme === value)
}

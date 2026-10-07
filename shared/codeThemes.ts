export const LIGHT_THEMES = ['github-light', 'vitesse-light', 'catppuccin-latte', 'solarized-light', 'one-light'] as const
export const DARK_THEMES = ['github-dark', 'vitesse-dark', 'catppuccin-mocha', 'dracula', 'one-dark-pro'] as const

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

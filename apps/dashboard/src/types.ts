export type Platform = 'SWEA' | 'PROGRAMMERS'

export type ViewName = 'solutions' | 'guide' | 'settings'

export type User = {
  id: number
  githubId: string
  githubLogin: string
  name?: string
  email?: string
}

export const GITHUB_LOGIN_URL = '/api/oauth2/authorization/github' as const

export type GithubAuthProvider = {
  enabled: boolean
  loginUrl: typeof GITHUB_LOGIN_URL
}

export type AuthProviders = {
  github: GithubAuthProvider
}

export type Solution = {
  captureId: string
  platform: Platform
  problemNumber: string
  title: string
  problemUrl: string
  language: string
  sourceCode: string
  result: 'ACCEPTED' | string
  observedAt?: string
  solvedAt?: string
  executionTime?: number | string
  memoryUsage?: number | string
  memoryValue?: number | string
  memoryUnit?: 'KB' | 'KiB' | 'MB' | 'MiB' | 'UNKNOWN' | string
}

export type Capture = Solution & {
  captureId: string
}

export type BulkResponse = {
  acceptedCaptureIds: string[]
  failures: Array<{ captureId: string; message: string }>
}

export type ExtensionCapability = string

export type ExtensionCaptureResponse = {
  captures?: Capture[]
}

export type Toast = {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
}

export type AccountSettings = {
  version: number
  name: string | null
  nickname: string | null
  copyHeader: boolean
  downloadHeader: boolean
  downloadFilenameTemplate: string
  gitPathTemplate: string
  githubCommitMessageTemplate: string
  lightTheme: LightTheme
  darkTheme: DarkTheme
  autoSyncEnabled: boolean
  githubAutoCommitEnabled: boolean
  githubTargetConfigured: boolean
  githubStatus: 'AVAILABLE' | 'TARGET_MISSING' | string
  githubInstallationId: number | null
  githubOwner: string | null
  githubRepository: string | null
  githubBranch: string | null
  githubRootPath: string | null
  githubSetupUrl?: string | null
}
/** Opaque, device-bound relay material. This is deliberately not a GitHub credential. */
export type RelayGrant = {
  secret: string
  generation: number
  endpoint: string
  expiresAt: string
}
export type GithubInstallation = { id: number; accountLogin: string }
export type GithubInstallationStart = {
  status: 'AVAILABLE' | 'INSTALL_REQUIRED'
  installations: GithubInstallation[]
  installUrl: string | null
}
export type GithubRepositoryTarget = { id: number; owner: string; name: string; fullName: string; privateRepository: boolean; defaultBranch: string }
export type GithubBranchTarget = { name: string; protectedBranch: boolean; commitSha: string }
export type GithubDirectoryTarget = { currentPath: string; parentPath: string; directories: string[] }
export type GithubPage<T> = { items: T[]; hasMore: boolean }
export const LIGHT_THEMES = ['github-light', 'vitesse-light', 'catppuccin-latte', 'solarized-light', 'one-light'] as const
export const DARK_THEMES = ['github-dark', 'vitesse-dark', 'catppuccin-mocha', 'dracula', 'one-dark-pro'] as const
export type LightTheme = typeof LIGHT_THEMES[number]
export type DarkTheme = typeof DARK_THEMES[number]

import type { LightTheme, DarkTheme } from '../../../shared/codeThemes'

export type Platform = 'SWEA' | 'PROGRAMMERS'

export type ViewName = 'solutions' | 'community' | 'guide' | 'settings'

export type User = {
  id: number
  githubId: string
  githubLogin: string
  name?: string
  email?: string
  avatarUrl?: string
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
  id?: number
  captureId: string
  platform: Platform
  problemNumber: string
  title: string
  problemUrl: string
  language: string
  languageKey?: string
  sourceCode: string
  result: 'ACCEPTED' | string
  observedAt?: string
  solvedAt?: string
  executionTime?: number | string
  memoryUsage?: number | string
  memoryValue?: number | string
  memoryUnit?: 'KB' | 'KiB' | 'MB' | 'MiB' | 'UNKNOWN' | string
  visibility?: 'private' | 'published'
  publishedAt?: string | null
}

export type CommunityAuthor = { name: string; nickname: string | null; avatarUrl: string | null }
export type CommunitySummary = { id: number; platform: Platform; problemNumber: string; title: string; language: string; languageKey: string; solvedAt: string | null; publishedAt: string; author: CommunityAuthor }
export type CommunityDetail = CommunitySummary & { problemUrl: string; sourceCode: string; executionTime: number | string | null; memoryValue: number | string | null; memoryUnit: string | null }
export type CommunityPage = { items: CommunitySummary[]; page: number; size: number; total: number; hasMore: boolean }

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
  githubHeader: boolean
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
export type GithubRepositoryTarget = { id: number; owner: string; name: string; fullName: string; privateRepository: boolean; defaultBranch: string | null }
export type GithubBranchTarget = { name: string; protectedBranch: boolean; commitSha: string }
export type GithubDirectoryTarget = { currentPath: string; parentPath: string; directories: string[] }
export type GithubTreeEntry = { name: string; path: string; type: 'tree' | 'blob' | 'commit'; size: number }
export type GithubTreePage = { path: string; headSha: string | null; items: GithubTreeEntry[]; page: number; hasMore: boolean; truncated: boolean }
export type GithubAddFileRequest = { branch: string; path: string; content: string; message: string; expectedHeadSha: string; placeholder: boolean }
export type GithubPage<T> = { items: T[]; hasMore: boolean }
export { LIGHT_THEMES, DARK_THEMES } from '../../../shared/codeThemes'
export type { LightTheme, DarkTheme } from '../../../shared/codeThemes'

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

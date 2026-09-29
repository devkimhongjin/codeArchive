// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GithubRepositoryBrowser } from './GithubRepositoryBrowser'

const mocks = vi.hoisted(() => ({ installations: vi.fn(), repositories: vi.fn(), branches: vi.fn(), emptyBranch: vi.fn(), tree: vi.fn(), file: vi.fn(), edit: vi.fn(), previewDelete: vi.fn(), commitDelete: vi.fn() }))
vi.mock('./api', async original => ({
  ...await original<typeof import('./api')>(),
  getGithubInstallations: mocks.installations,
  getGithubRepositories: mocks.repositories,
  getGithubBranches: mocks.branches,
  getGithubEmptyDefaultBranch: mocks.emptyBranch,
  getGithubTree: mocks.tree,
  getGithubFile: mocks.file,
  editGithubFile: mocks.edit,
  previewGithubTreeOperation: mocks.previewDelete,
  commitGithubTreeOperation: mocks.commitDelete,
}))
vi.mock('./CodeBlock', () => ({ CodeBlock: ({ code }: { code: string }) => <pre>{code}</pre> }))

const target = { installationId: 77, owner: 'owner', repository: 'repo', branch: 'main', rootPath: 'solutions' }
function view() {
  return render(<GithubRepositoryBrowser githubId="123" target={target} lightTheme="github-light" darkTheme="github-dark" codeThemeMode="light" onExpectedAccountChange={vi.fn()} />)
}

beforeEach(() => {
  mocks.installations.mockResolvedValue([{ id: 77, accountLogin: 'owner' }])
  mocks.repositories.mockResolvedValue({ items: [{ id: 9, owner: 'owner', name: 'repo' }], hasMore: false })
  mocks.branches.mockResolvedValue({ items: [{ name: 'main', protectedBranch: false }], hasMore: false })
  mocks.emptyBranch.mockResolvedValue({ defaultBranch: 'main' })
  mocks.tree.mockImplementation((_id: string, _installation: number, _repository: number, _branch: string, path = '') => Promise.resolve({ path, headSha: 'a'.repeat(40), items: path ? [{ name: '풀이.java', path: `${path}/풀이.java`, type: 'blob', size: 9 }] : [{ name: '한글', path: '한글', type: 'tree', size: 0 }], page: 1, hasMore: false, truncated: false }))
  mocks.file.mockResolvedValue({ path: '한글/풀이.java', headSha: 'a'.repeat(40), blobSha: 'b'.repeat(40), mode: '100644', size: 9, content: 'class A{}', unavailableReason: null })
  mocks.edit.mockResolvedValue({ commitSha: 'c'.repeat(40) })
  mocks.previewDelete.mockResolvedValue({ previewId: 'opaque-preview', operation: 'DELETE', branch: 'main', sourcePath: '한글/풀이.java', destinationPath: null, message: 'Delete 한글/풀이.java', expectedHeadSha: 'a'.repeat(40), changes: [{ fromPath: '한글/풀이.java', toPath: null }] })
  mocks.commitDelete.mockResolvedValue({ commitSha: 'c'.repeat(40), recovery: 'Use GitHub to revert' })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('opens the saved repository at its root and reads a Unicode-named file only after selection', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  view()
  fireEvent.click(await screen.findByRole('button', { name: /한글/ }))
  fireEvent.click(await screen.findByRole('button', { name: /풀이.java/ }))
  expect(await screen.findByText('class A{}')).toBeTruthy()
  expect(mocks.tree).toHaveBeenCalledWith('123', 77, 9, 'main')
  expect(mocks.tree).toHaveBeenCalledWith('123', 77, 9, 'main', '한글')
  expect(mocks.file).toHaveBeenCalledWith('123', 77, 9, 'main', '한글/풀이.java')
  fireEvent.click(screen.getByRole('button', { name: '경로 복사' }))
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('한글/풀이.java'))
})

it('does not browse a repository that is not in the verified installation', async () => {
  mocks.repositories.mockResolvedValue({ items: [{ id: 10, owner: 'other', name: 'repo' }], hasMore: false })
  view()
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  expect(mocks.branches).not.toHaveBeenCalled()
  expect(mocks.tree).not.toHaveBeenCalled()
})

it('shows an empty saved repository when its default branch has no commits yet', async () => {
  mocks.branches.mockResolvedValue({ items: [], hasMore: false })
  mocks.tree.mockResolvedValue({ path: '', headSha: null, items: [], page: 1, hasMore: false, truncated: false })
  view()
  expect(await screen.findByText('이 폴더에 파일이 없습니다.')).toBeTruthy()
  expect(mocks.emptyBranch).toHaveBeenCalledWith('123', 77, 9)
})

it('does not render a file fetched from another branch head', async () => {
  mocks.file.mockResolvedValue({ path: '한글/풀이.java', headSha: 'c'.repeat(40), blobSha: 'b'.repeat(40), mode: '100644', size: 9, content: 'stale secret', unavailableReason: null })
  view()
  fireEvent.click(await screen.findByRole('button', { name: /한글/ }))
  fireEvent.click(await screen.findByRole('button', { name: /풀이.java/ }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByText('stale secret')).toBeNull()
})

it('requires an explicit before-and-after preview before editing the selected file', async () => {
  view()
  fireEvent.click(await screen.findByRole('button', { name: /한글/ }))
  fireEvent.click(await screen.findByRole('button', { name: /풀이.java/ }))
  fireEvent.click(await screen.findByRole('button', { name: '이 파일 수정' }))
  fireEvent.change(screen.getByLabelText('수정할 파일 내용'), { target: { value: 'class B{}' } })
  fireEvent.click(screen.getByRole('button', { name: '수정 미리보기' }))
  expect(screen.getByLabelText('수정 전 파일').textContent).toBe('class A{}')
  expect(screen.getByLabelText('수정 후 파일').textContent).toBe('class B{}')
  expect(mocks.edit).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '이 변경을 커밋' }))
  await waitFor(() => expect(mocks.edit).toHaveBeenCalledWith('123', 77, 9, expect.objectContaining({ path: '한글/풀이.java', content: 'class B{}', expectedHeadSha: 'a'.repeat(40), expectedBlobSha: 'b'.repeat(40) })))
})

it('requires a server-verified file list and a separate confirmation before delete', async () => {
  view()
  fireEvent.click(await screen.findByRole('button', { name: /한글/ }))
  fireEvent.click(await screen.findByRole('button', { name: /풀이.java/ }))
  fireEvent.click(await screen.findByRole('button', { name: '이 파일 삭제' }))
  expect(mocks.commitDelete).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '삭제 변경 미리보기' }))
  expect(await screen.findByLabelText('삭제될 파일 목록')).toBeTruthy()
  expect(mocks.previewDelete).toHaveBeenCalledWith('123', 77, 9, expect.objectContaining({ operation: 'DELETE', sourcePath: '한글/풀이.java', expectedHeadSha: 'a'.repeat(40) }))
  expect(mocks.commitDelete).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '확인한 파일 삭제 커밋' }))
  await waitFor(() => expect(mocks.commitDelete).toHaveBeenCalledWith('123', 77, 9, 'opaque-preview'))
})

it('allows deleting the current folder only through a matching preview', async () => {
  mocks.previewDelete.mockResolvedValue({ previewId: 'folder-preview', operation: 'DELETE', branch: 'main', sourcePath: '한글', destinationPath: null, message: 'Delete 한글', expectedHeadSha: 'a'.repeat(40), changes: [{ fromPath: '한글/풀이.java', toPath: null }] })
  view()
  fireEvent.click(await screen.findByRole('button', { name: /한글/ }))
  fireEvent.click(await screen.findByRole('button', { name: '현재 폴더 삭제' }))
  fireEvent.click(screen.getByRole('button', { name: '삭제 변경 미리보기' }))
  expect(await screen.findByLabelText('삭제될 파일 목록')).toBeTruthy()
  expect(mocks.previewDelete).toHaveBeenCalledWith('123', 77, 9, expect.objectContaining({ sourcePath: '한글', expectedHeadSha: 'a'.repeat(40) }))
})

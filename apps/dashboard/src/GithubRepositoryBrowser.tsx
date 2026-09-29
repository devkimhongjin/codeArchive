import { useEffect, useRef, useState } from 'react'
import { ApiError, commitGithubTreeOperation, editGithubFile, getGithubBranches, getGithubEmptyDefaultBranch, getGithubFile, getGithubInstallations, getGithubRepositories, getGithubTree, previewGithubTreeOperation } from './api'
import { CodeBlock } from './CodeBlock'
import type { DarkTheme, GithubEditFileRequest, GithubFileView, GithubSavedTarget, GithubTreeEntry, GithubTreeOperationPreview, GithubTreePage, LightTheme } from './types'
import type { CodeThemeMode } from '../../../shared/codeThemes'

type VerifiedTarget = { repositoryId: number; protectedBranch: boolean }

const safeEntry = (entry: GithubTreeEntry) => entry.name.length > 0 && entry.name.length <= 255 &&
  !['.', '..', '.git'].includes(entry.name.toLowerCase()) && !/[\\/\x00-\x1f\x7f]/.test(entry.name)

function browseError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 403) return 'GitHub App에서 이 저장소에 접근할 수 없습니다. 연결 권한을 확인해 주세요.'
    if (error.status === 404) return '파일 또는 브랜치를 찾을 수 없습니다. 저장소를 새로고침해 주세요.'
    if (error.status === 409) return 'GitHub 계정 또는 저장소 상태가 변경됐습니다. 다시 확인해 주세요.'
  }
  return '저장소 내용을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

async function allPages<T>(fetchPage: (page: number) => Promise<{ items: T[]; hasMore: boolean }>): Promise<T[]> {
  const results: T[] = []
  for (let page = 1; page <= 100; page++) {
    const current = await fetchPage(page)
    results.push(...current.items)
    if (!current.hasMore) return results
  }
  throw new Error('GitHub 대상 목록이 확인 가능한 범위를 초과했습니다.')
}

export function GithubRepositoryBrowser({ githubId, target, lightTheme, darkTheme, codeThemeMode, onExpectedAccountChange }: {
  githubId: string
  target: GithubSavedTarget
  lightTheme: LightTheme
  darkTheme: DarkTheme
  codeThemeMode: CodeThemeMode
  onExpectedAccountChange: (expectedGithubId: string) => void
}) {
  const [verified, setVerified] = useState<VerifiedTarget | null>(null)
  const [tree, setTree] = useState<GithubTreePage | null>(null)
  const [file, setFile] = useState<GithubFileView | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [fileBusy, setFileBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [editMessage, setEditMessage] = useState('')
  const [editPreview, setEditPreview] = useState<GithubEditFileRequest | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [editSuccess, setEditSuccess] = useState<string | null>(null)
  const [deletePath, setDeletePath] = useState<string | null>(null)
  const [deleteMessage, setDeleteMessage] = useState('')
  const [deletePreview, setDeletePreview] = useState<GithubTreeOperationPreview | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null)
  const browseGeneration = useRef(0)
  const fileGeneration = useRef(0)

  const accountError = (cause: unknown) => {
    if (cause instanceof ApiError && cause.status === 409 && cause.message === 'GitHub account changed; reconnect required') {
      onExpectedAccountChange(githubId)
      return true
    }
    return false
  }

  const clearEditor = () => { setEditing(false); setEditText(''); setEditMessage(''); setEditPreview(null); setEditError(null) }
  const clearDelete = () => { setDeletePath(null); setDeleteMessage(''); setDeletePreview(null); setDeleteError(null) }

  const verifyTarget = async () => {
    const generation = ++browseGeneration.current
    ++fileGeneration.current
    setBusy(true); setError(null); setVerified(null); setTree(null); setFile(null); setSelectedPath(null); setFileError(null); setCopyStatus(null); setEditSuccess(null); setDeleteSuccess(null); clearEditor(); clearDelete()
    try {
      const installations = await getGithubInstallations(githubId)
      if (!installations.some(item => item.id === target.installationId)) throw new Error('installation unavailable')
      const repositories = await allPages(page => getGithubRepositories(githubId, target.installationId, page))
      const repository = repositories.find(item => item.owner === target.owner && item.name === target.repository)
      if (!repository) throw new Error('repository unavailable')
      const branches = await allPages(page => getGithubBranches(githubId, target.installationId, repository.id, page))
      const chosenBranch = branches.find(item => item.name === target.branch)
      if (!chosenBranch) {
        if (branches.length) throw new Error('branch unavailable')
        const empty = await getGithubEmptyDefaultBranch(githubId, target.installationId, repository.id)
        if (empty.defaultBranch !== target.branch) throw new Error('branch unavailable')
      }
      const root = await getGithubTree(githubId, target.installationId, repository.id, target.branch)
      if (generation !== browseGeneration.current) return
      setVerified({ repositoryId: repository.id, protectedBranch: chosenBranch?.protectedBranch ?? false })
      setTree(root)
    } catch (cause) {
      if (generation !== browseGeneration.current || accountError(cause)) return
      setError(browseError(cause))
    } finally { if (generation === browseGeneration.current) setBusy(false) }
  }

  useEffect(() => {
    void verifyTarget()
    return () => { ++browseGeneration.current; ++fileGeneration.current }
  }, [githubId, target.installationId, target.owner, target.repository, target.branch])

  const openFolder = async (path: string) => {
    if (!verified || busy) return
    const generation = ++browseGeneration.current
    ++fileGeneration.current
    setBusy(true); setError(null); setTree(null); setFile(null); setSelectedPath(null); setFileError(null); setCopyStatus(null); clearEditor(); clearDelete()
    try {
      const next = await getGithubTree(githubId, target.installationId, verified.repositoryId, target.branch, path)
      if (generation === browseGeneration.current) setTree(next)
    } catch (cause) {
      if (generation !== browseGeneration.current || accountError(cause)) return
      setError(browseError(cause))
    } finally { if (generation === browseGeneration.current) setBusy(false) }
  }

  const loadMore = async () => {
    if (!verified || !tree?.hasMore || busy) return
    const previous = tree
    const generation = ++browseGeneration.current
    setBusy(true); setError(null)
    try {
      const next = await getGithubTree(githubId, target.installationId, verified.repositoryId, target.branch, previous.path, previous.page + 1)
      if (generation !== browseGeneration.current) return
      if (next.headSha !== previous.headSha || next.path !== previous.path) {
        setTree(null); setFile(null); setError('브랜치 내용이 변경됐습니다. 폴더를 새로고침해 주세요.')
      } else setTree({ ...next, items: [...previous.items, ...next.items] })
    } catch (cause) {
      if (generation !== browseGeneration.current || accountError(cause)) return
      setError(browseError(cause))
    } finally { if (generation === browseGeneration.current) setBusy(false) }
  }

  const openFile = async (entry: GithubTreeEntry) => {
    if (!verified || !tree?.headSha || busy || !safeEntry(entry)) return
    const generation = ++fileGeneration.current
    setSelectedPath(entry.path); setFile(null); setFileError(null); setCopyStatus(null); setFileBusy(true); clearEditor(); clearDelete()
    if (entry.type !== 'blob') {
      setFileError('서브모듈은 여기서 열 수 없습니다.')
      setFileBusy(false)
      return
    }
    try {
      const result = await getGithubFile(githubId, target.installationId, verified.repositoryId, target.branch, entry.path)
      if (generation !== fileGeneration.current) return
      if (result.headSha !== tree.headSha) { setFileError('브랜치 내용이 변경됐습니다. 폴더를 새로고침해 주세요.'); return }
      setFile(result)
    } catch (cause) {
      if (generation !== fileGeneration.current || accountError(cause)) return
      setFileError(browseError(cause))
    } finally { if (generation === fileGeneration.current) setFileBusy(false) }
  }

  const segments = tree?.path ? tree.path.split('/') : []
  const sortedItems = [...(tree?.items ?? [])].sort((left, right) =>
    (left.type === 'tree' ? 0 : 1) - (right.type === 'tree' ? 0 : 1) || left.name.localeCompare(right.name, 'ko'))
  const fileLanguage = selectedPath?.split('.').pop() ?? 'text'
  const unavailableMessage = file?.unavailableReason === 'FILE_TOO_LARGE' ? '64KB를 넘는 파일은 미리보기를 제공하지 않습니다.'
    : file?.unavailableReason === 'NON_TEXT' ? '텍스트로 확인할 수 없는 파일입니다.'
      : file?.unavailableReason ? '이 형식의 파일은 미리보기를 제공하지 않습니다.' : null

  const copyFilePath = async () => {
    if (!file || file.path !== selectedPath) return
    try { await navigator.clipboard.writeText(file.path); setCopyStatus('파일 경로를 복사했습니다.') }
    catch { setCopyStatus('파일 경로를 복사하지 못했습니다.') }
  }

  const previewEdit = () => {
    setEditError(null); setEditPreview(null)
    if (!file || file.content === null || !tree?.headSha || file.headSha !== tree.headSha || verified?.protectedBranch) { setEditError('파일과 브랜치를 다시 확인해 주세요.'); return }
    if (editText === file.content) { setEditError('변경된 내용이 없습니다.'); return }
    if (new TextEncoder().encode(editText).length > 65536 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(editText)) { setEditError('수정할 파일은 제어 문자가 없는 64KB 이내 텍스트여야 합니다.'); return }
    const message = editMessage.trim() || `Edit ${file.path}`
    if (message.length > 200 || /[\x00-\x1f\x7f]/.test(message)) { setEditError('커밋 메시지는 한 줄, 200자 이내여야 합니다.'); return }
    setEditPreview({ branch: target.branch, path: file.path, content: editText, message, expectedHeadSha: file.headSha, expectedBlobSha: file.blobSha })
  }

  const confirmEdit = async () => {
    if (!editPreview || !verified || !file || !tree?.headSha || editBusy) return
    if (verified.protectedBranch || file.path !== editPreview.path || file.headSha !== editPreview.expectedHeadSha || file.blobSha !== editPreview.expectedBlobSha || tree.headSha !== editPreview.expectedHeadSha || target.branch !== editPreview.branch || editText !== editPreview.content || (editMessage.trim() || `Edit ${file.path}`) !== editPreview.message) {
      setEditPreview(null); setEditError('파일 또는 미리보기 내용이 변경됐습니다. 다시 확인해 주세요.'); return
    }
    const generation = browseGeneration.current
    setEditBusy(true); setEditError(null); setEditPreview(null)
    try {
      const result = await editGithubFile(githubId, target.installationId, verified.repositoryId, editPreview)
      if (generation !== browseGeneration.current) return
      if (!/^[0-9a-f]{40}$/i.test(result.commitSha)) throw new Error('commit outcome invalid')
      const folder = tree.path
      await openFolder(folder)
      if (generation + 1 !== browseGeneration.current) return
      setEditSuccess(`커밋 완료 · ${result.commitSha.slice(0, 7)} · 파일을 다시 선택하면 최신 내용을 볼 수 있습니다.`)
    } catch (cause) {
      if (generation !== browseGeneration.current && generation + 1 !== browseGeneration.current) return
      if (accountError(cause)) return
      setEditError(cause instanceof ApiError && cause.status === 409 ? '브랜치 또는 파일이 바뀌었습니다. 저장소를 새로고침한 뒤 다시 편집해 주세요.' : '커밋 결과를 확인하지 못했습니다. 다시 시도하기 전에 GitHub 저장소를 확인해 주세요.')
    } finally { setEditBusy(false) }
  }

  const previewDelete = async () => {
    if (!deletePath || !verified || !tree?.headSha || deleteBusy || verified.protectedBranch) return
    const message = deleteMessage.trim() || `Delete ${deletePath}`
    if (message.length > 200 || /[\x00-\x1f\x7f]/.test(message)) { setDeleteError('커밋 메시지는 한 줄, 200자 이내여야 합니다.'); return }
    const generation = browseGeneration.current
    setDeleteBusy(true); setDeleteError(null); setDeletePreview(null)
    try {
      const preview = await previewGithubTreeOperation(githubId, target.installationId, verified.repositoryId, { operation: 'DELETE', branch: target.branch, sourcePath: deletePath, destinationPath: null, message, expectedHeadSha: tree.headSha })
      if (generation !== browseGeneration.current) return
      if (preview.operation !== 'DELETE' || preview.branch !== target.branch || preview.sourcePath !== deletePath || preview.destinationPath !== null || preview.message !== message || preview.expectedHeadSha !== tree.headSha || !preview.changes.length || preview.changes.some(change => change.toPath !== null || change.fromPath !== deletePath && !change.fromPath.startsWith(`${deletePath}/`))) throw new Error('preview mismatch')
      setDeletePreview(preview)
    } catch (cause) {
      if (generation !== browseGeneration.current || accountError(cause)) return
      setDeleteError(cause instanceof ApiError && cause.status === 409 ? '브랜치나 항목이 변경됐습니다. 저장소를 새로고침해 주세요.' : '삭제 미리보기를 확인하지 못했습니다. 항목을 다시 선택해 주세요.')
    } finally { setDeleteBusy(false) }
  }

  const confirmDelete = async () => {
    if (!deletePreview || !deletePath || !verified || !tree?.headSha || deleteBusy) return
    if (verified.protectedBranch || deletePreview.operation !== 'DELETE' || deletePreview.branch !== target.branch || deletePreview.sourcePath !== deletePath || deletePreview.expectedHeadSha !== tree.headSha || deletePreview.message !== (deleteMessage.trim() || `Delete ${deletePath}`)) { setDeletePreview(null); setDeleteError('삭제 대상이나 브랜치가 바뀌었습니다. 다시 미리보기 해주세요.'); return }
    const generation = browseGeneration.current
    const refreshPath = tree.path === deletePath ? tree.path.split('/').slice(0, -1).join('/') : tree.path
    setDeleteBusy(true); setDeleteError(null); setDeletePreview(null)
    try {
      const result = await commitGithubTreeOperation(githubId, target.installationId, verified.repositoryId, deletePreview.previewId)
      if (generation !== browseGeneration.current) return
      if (!/^[0-9a-f]{40}$/i.test(result.commitSha)) throw new Error('commit outcome invalid')
      await openFolder(refreshPath)
      if (generation + 1 !== browseGeneration.current) return
      setDeleteSuccess(`삭제 커밋 완료 · ${result.commitSha.slice(0, 7)}`)
    } catch (cause) {
      if (generation !== browseGeneration.current && generation + 1 !== browseGeneration.current) return
      if (accountError(cause)) return
      setDeleteError(cause instanceof ApiError && cause.status === 409 ? '브랜치 또는 항목이 바뀌었습니다. 새로고침 후 다시 확인해 주세요.' : '삭제 커밋 결과를 확인하지 못했습니다. 다시 시도하기 전에 GitHub 저장소를 확인해 주세요.')
    } finally { setDeleteBusy(false) }
  }

  return <section className="github-repository-browser" aria-label="연결된 GitHub 저장소 파일">
    <div className="github-browser-heading">
      <div><span className="card-kicker">CONNECTED REPOSITORY</span><h3>{target.owner} / {target.repository}</h3><p>브랜치 {target.branch} · 자동 커밋 위치 {target.rootPath ? `/${target.rootPath}` : '/'}</p></div>
      <button type="button" className="ghost-button" onClick={() => void verifyTarget()} disabled={busy || editBusy || deleteBusy}>저장소 새로고침</button>
    </div>
    {busy && !tree && <p role="status">저장소를 확인하는 중…</p>}
    {editSuccess && <p role="status" className="github-browser-success">{editSuccess}</p>}
    {deleteSuccess && <p role="status" className="github-browser-success">{deleteSuccess}</p>}
    {error && <p role="alert">{error}</p>}
    {tree && <>
      <nav className="github-browser-breadcrumb" aria-label="저장소 경로">
        <button type="button" onClick={() => void openFolder('')} disabled={busy || editBusy || deleteBusy}>루트</button>
        {segments.map((part, index) => <span key={`${index}:${part}`}>/ <button type="button" onClick={() => void openFolder(segments.slice(0, index + 1).join('/'))} disabled={busy || editBusy || deleteBusy}>{part}</button></span>)}
      </nav>
      <div className="github-browser-layout">
        <div className="github-browser-list" aria-label="파일·폴더 목록">
          {tree.path && <button type="button" onClick={() => void openFolder(segments.slice(0, -1).join('/'))} disabled={busy || editBusy || deleteBusy}>📁 ..</button>}
          {sortedItems.map(entry => <button type="button" key={`${entry.path}:${entry.type}`} className={selectedPath === entry.path ? 'is-selected' : ''} onClick={() => entry.type === 'tree' ? void openFolder(entry.path) : void openFile(entry)} disabled={busy || editBusy || deleteBusy || !safeEntry(entry)}>
            <span aria-hidden="true">{entry.type === 'tree' ? '📁' : '📄'}</span><span>{entry.name}</span>{entry.type === 'commit' && <small>서브모듈</small>}
          </button>)}
          {!tree.items.length && <p>이 폴더에 파일이 없습니다.</p>}
          {tree.hasMore && <button type="button" className="ghost-button" onClick={() => void loadMore()} disabled={busy || editBusy || deleteBusy}>파일 더 보기</button>}
          {tree.truncated && <p role="status">일부 항목을 확인할 수 없습니다. GitHub에서 저장소를 확인해 주세요.</p>}
        </div>
        <div className="github-browser-preview">
          {selectedPath ? <>
            <div className="github-browser-file-heading"><strong>{selectedPath}</strong>{file && <><span>{file.size.toLocaleString()} bytes · {file.blobSha.slice(0, 7)}</span><button type="button" className="ghost-button" onClick={() => void copyFilePath()}>경로 복사</button></>}</div>
            {copyStatus && <p role="status">{copyStatus}</p>}
            {fileBusy && <p role="status">파일을 불러오는 중…</p>}
            {fileError && <p role="alert">{fileError}</p>}
            {unavailableMessage && <p role="status">{unavailableMessage}</p>}
            {file?.content !== null && file?.content !== undefined && (file.content ? <CodeBlock code={file.content} language={fileLanguage} lightTheme={lightTheme} darkTheme={darkTheme} activeMode={codeThemeMode} /> : <p>빈 파일입니다.</p>)}
            {file?.content !== null && file?.content !== undefined && !verified?.protectedBranch && !editing && <button type="button" className="ghost-button github-browser-edit-toggle" onClick={() => { clearDelete(); setEditing(true); setEditText(file.content ?? ''); setEditMessage(''); setEditPreview(null); setEditError(null) }}>이 파일 수정</button>}
            {editing && file && <div className="github-browser-editor">
              <label>파일 내용<textarea aria-label="수정할 파일 내용" value={editText} onChange={event => { setEditText(event.target.value); setEditPreview(null); setEditError(null) }} rows={12} disabled={editBusy} /></label>
              <label>커밋 메시지<input aria-label="파일 수정 커밋 메시지" value={editMessage} maxLength={200} placeholder={`Edit ${file.path}`} onChange={event => { setEditMessage(event.target.value); setEditPreview(null); setEditError(null) }} disabled={editBusy} /></label>
              <div className="github-browser-editor-actions"><button type="button" className="ghost-button" onClick={previewEdit} disabled={editBusy}>수정 미리보기</button><button type="button" className="ghost-button" onClick={clearEditor} disabled={editBusy}>취소</button></div>
              {editError && <p role="alert">{editError}</p>}
              {editPreview && <div className="github-browser-edit-preview"><strong>커밋 전 확인 · {target.owner}/{target.repository} · {editPreview.branch}</strong><p>{editPreview.path} · 기준 HEAD {editPreview.expectedHeadSha.slice(0, 7)} · 파일 {editPreview.expectedBlobSha.slice(0, 7)}</p><p>커밋: {editPreview.message}</p><div><pre aria-label="수정 전 파일">{file.content}</pre><pre aria-label="수정 후 파일">{editPreview.content}</pre></div><button type="button" className="primary-button" onClick={() => void confirmEdit()} disabled={editBusy}>{editBusy ? '커밋 중…' : '이 변경을 커밋'}</button></div>}
            </div>}
          </> : <div className="github-browser-empty"><strong>{tree.path || `${target.owner}/${target.repository}`}</strong><p>왼쪽에서 폴더를 탐색하거나 파일을 선택해 내용을 확인하세요.</p><small>{tree.items.length}개 항목 · {verified?.protectedBranch ? '보호된 브랜치' : '일반 브랜치'}</small></div>}
          {!verified?.protectedBranch && tree.headSha && !editing && (file && selectedPath === file.path && (file.mode === '100644' || file.mode === '100755') || !selectedPath && tree.path) && !deletePath && <button type="button" className="ghost-button github-browser-edit-toggle" onClick={() => { clearEditor(); setDeletePath(file && selectedPath === file.path ? file.path : tree.path); setDeleteMessage(''); setDeletePreview(null); setDeleteError(null) }}>{file && selectedPath === file.path ? '이 파일 삭제' : '현재 폴더 삭제'}</button>}
          {deletePath && <div className="github-browser-editor"><strong>삭제 대상: {deletePath}</strong><p>삭제는 되돌리기 전까지 GitHub 저장소에서 보이지 않습니다. 먼저 변경 파일을 확인해 주세요.</p><label>커밋 메시지<input aria-label="삭제 커밋 메시지" value={deleteMessage} maxLength={200} placeholder={`Delete ${deletePath}`} onChange={event => { setDeleteMessage(event.target.value); setDeletePreview(null); setDeleteError(null) }} disabled={deleteBusy} /></label><div className="github-browser-editor-actions"><button type="button" className="ghost-button" onClick={() => void previewDelete()} disabled={deleteBusy}>삭제 변경 미리보기</button><button type="button" className="ghost-button" onClick={clearDelete} disabled={deleteBusy}>취소</button></div>{deleteError && <p role="alert">{deleteError}</p>}{deletePreview && <div className="github-browser-edit-preview"><strong>삭제 커밋 전 확인 · {target.owner}/{target.repository} · {deletePreview.branch}</strong><p>{deletePreview.sourcePath} · 기준 HEAD {deletePreview.expectedHeadSha.slice(0, 7)} · 파일 {deletePreview.changes.length}개</p><p>커밋: {deletePreview.message}</p><pre aria-label="삭제될 파일 목록">{deletePreview.changes.map(change => change.fromPath).join('\n')}</pre><button type="button" className="primary-button" onClick={() => void confirmDelete()} disabled={deleteBusy}>{deleteBusy ? '커밋 중…' : '확인한 파일 삭제 커밋'}</button></div>}</div>}
        </div>
      </div>
    </>}
  </section>
}

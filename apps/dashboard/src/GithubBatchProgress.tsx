import { useEffect, useRef, useState } from 'react'
import { extensionMessage, extensionRuntime } from './extensionEnvironment'
import type { GithubBatchTask } from '../../extension/src/githubBatchTask'
import type { User } from './types'

export function GithubBatchProgress({ user }: { user: User | null }) {
  const [task, setTask] = useState<GithubBatchTask | null>(null), [message, setMessage] = useState('')
  const account = user ? `${user.id}:${user.githubId}` : ''
  const currentAccount = useRef(account); currentAccount.current = account
  useEffect(() => {
    setTask(null); setMessage('')
    if (!account || !extensionRuntime()) return
    let active = true, reading = false
    const refresh = async () => {
      if (reading) return
      reading = true
      try { const result = await extensionMessage<{ task: GithubBatchTask | null }>({ type: 'GET_GITHUB_BATCH', account }); if (active) { setTask(result.task?.account === account ? result.task : null); setMessage('') } }
      catch { if (active) setMessage('백그라운드 작업 상태를 확인하지 못했습니다. 확장 연결을 확인해 주세요.') }
      finally { reading = false }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 2000)
    window.addEventListener('codearchive-github-batch-started', refresh)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('codearchive-github-batch-started', refresh) }
  }, [account])
  if (!task || task.account !== account) return null
  const values = Object.values(task.states), succeeded = values.filter(value => value === 'SUCCEEDED').length,
    failed = values.filter(value => value === 'FAILED').length, unknown = values.filter(value => value === 'UNKNOWN').length
  const action = async (type: 'CANCEL_GITHUB_BATCH' | 'RESUME_GITHUB_BATCH') => {
    try { const result = await extensionMessage<{ task: GithubBatchTask | null }>({ type, account }); if (currentAccount.current !== account) return; if (result.task?.account === account) setTask(result.task); setMessage('') }
    catch (error) { if (currentAccount.current === account) setMessage(error instanceof Error ? error.message : '요청을 완료하지 못했습니다.') }
  }
  return <section className="github-batch-progress" aria-label="백그라운드 일괄 커밋 진행 상황">
    <div><strong>GitHub 일괄 커밋 {task.status === 'DONE' ? '처리 완료' : task.status === 'PAUSED' ? '확인 필요' : '진행 중'}</strong><span>{task.owner}/{task.repository} · {task.branch}</span></div>
    <p>서버 접수 {task.offset}/{task.captureIds.length}건 · 완료 {succeeded}건 · 실패 {failed}건 · 결과 확인 필요 {unknown}건</p>
    <progress aria-label="일괄 커밋 처리 진행률" max={task.captureIds.length} value={succeeded + failed + unknown} />
    <p>{task.cancelRequested ? '추가 요청을 중단했습니다. 이미 접수한 커밋의 결과는 계속 확인합니다.' : '다른 탭으로 이동하거나 관리 화면을 닫아도 확장 프로그램에서 계속 처리합니다.'}</p>
    {task.error && <p role="status">{task.error}</p>}{message && <p role="status">{message}</p>}
    {task.status === 'PAUSED' && <button className="ghost-button" onClick={() => void action('RESUME_GITHUB_BATCH')}>작업 이어가기</button>}
    {task.status !== 'DONE' && !task.cancelRequested && <button className="ghost-button" onClick={() => void action('CANCEL_GITHUB_BATCH')}>추가 요청 중단</button>}
  </section>
}

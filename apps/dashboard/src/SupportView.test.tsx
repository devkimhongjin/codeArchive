// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SupportView } from './SupportView'
const mocks = vi.hoisted(() => ({ access: vi.fn(), list: vi.fn(), adminList: vi.fn(), detail: vi.fn(), adminDetail: vi.fn(), create: vi.fn(), me: vi.fn(), adminReply: vi.fn(), status: vi.fn() }))
const ApiMockError = vi.hoisted(() => class ApiError extends Error { constructor(message = 'error', readonly status = 500) { super(message) } })
vi.mock('./api', () => ({ ApiError: ApiMockError, getSupportAccess: mocks.access, getSupportTickets: mocks.list, getSupportAdminTickets: mocks.adminList, getSupportTicket: mocks.detail, getSupportAdminTicket: mocks.adminDetail, createSupportTicket: mocks.create, getMe: mocks.me, replySupportAdminTicket: mocks.adminReply, setSupportAdminStatus: mocks.status }))
const user = { id: 1, githubId: '42', githubLogin: 'tester' }
const summary = { id: 7, category: 'BUG' as const, title: 'ticket', status: 'OPEN' as const, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', closedAt: null }
const ticket = { inquiry: summary, messages: [{ id: 1, authorRole: 'USER' as const, body: 'body', createdAt: '2026-01-01T00:00:00Z' }], admin: false }
const page = { items: [summary], page: 0, size: 20, total: 1, hasMore: false }
const props = { user, mode: 'live' as const, onLogin: vi.fn(), onAuthInvalid: vi.fn() }
async function openTicket() { await waitFor(() => screen.getByText('ticket')); fireEvent.click(screen.getByText('ticket')); await waitFor(() => screen.getByText('접수 내용')) }
function administrator() { mocks.access.mockResolvedValue({ admin: true }); mocks.adminList.mockResolvedValue(page); mocks.adminDetail.mockResolvedValue({ ...ticket, admin: true }) }
describe('SupportView', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.resetAllMocks(); mocks.access.mockResolvedValue({ admin: false }); mocks.list.mockResolvedValue({ ...page, items: [], total: 0 }); mocks.adminList.mockResolvedValue({ ...page, items: [], total: 0 }); mocks.detail.mockResolvedValue(ticket); mocks.me.mockResolvedValue(user)
  })
  it('requires login without reading private tickets', () => { render(<SupportView {...props} user={null} mode="local" />); expect(screen.getByText('GitHub로 로그인')).toBeTruthy(); expect(mocks.access).not.toHaveBeenCalled() })
  it('validates and submits one inquiry for the current account', async () => {
    mocks.create.mockResolvedValue(ticket); render(<SupportView {...props} />); await waitFor(() => screen.getByLabelText('제목'))
    fireEvent.click(screen.getByText('문의 등록')); expect(mocks.create).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: ' title ' } }); fireEvent.change(screen.getByLabelText('내용'), { target: { value: ' body ' } }); fireEvent.click(screen.getByText('문의 등록'))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith('42', { category: 'BUG', title: 'title', body: 'body' }))
  })
  it('opens the verified administrator inbox directly without a composer or toggle', async () => {
    administrator(); render(<SupportView {...props} />); await waitFor(() => expect(mocks.adminList).toHaveBeenCalledWith('42', 0))
    expect(mocks.list).not.toHaveBeenCalled(); expect(screen.queryByText('전체 문의 관리자 보기')).toBeNull(); expect(screen.queryByLabelText('제목')).toBeNull(); expect(screen.queryByText('새 문의')).toBeNull()
  })
  it('keeps access checking until the server verifies authority', async () => {
    mocks.access.mockImplementation(() => new Promise(() => {})); render(<SupportView {...props} user={{ ...user, githubLogin: 'devkimhongjin' }} />)
    expect(screen.queryByLabelText('제목')).toBeNull(); expect(mocks.adminList).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled()
  })
  it('shows only the state and current answer to an ordinary user, without chat, close or delete', async () => {
    mocks.list.mockResolvedValue(page); mocks.detail.mockResolvedValue({ ...ticket, inquiry: { ...summary, status: 'IN_REVIEW' }, messages: [...ticket.messages, { id: 2, authorRole: 'ADMIN', body: 'old answer', createdAt: summary.createdAt }, { id: 3, authorRole: 'ADMIN', body: 'current answer', createdAt: summary.createdAt }] })
    render(<SupportView {...props} />); await openTicket(); expect(screen.getByText('current answer')).toBeTruthy(); expect(screen.queryByText('old answer')).toBeNull()
    expect(screen.getByText('오류 제보 · 확인중')).toBeTruthy(); expect(screen.queryByRole('textbox')).toBeNull(); expect(screen.queryByText('문의 종료')).toBeNull(); expect(screen.queryByText('문의 삭제')).toBeNull(); expect(screen.queryByText('답변 보내기')).toBeNull(); expect(screen.queryByLabelText('처리 상태')).toBeNull()
  })
  it('lets only the verified administrator set review state and save a single answer', async () => {
    administrator(); mocks.status.mockResolvedValue({ ...ticket, inquiry: { ...summary, status: 'IN_REVIEW' }, admin: true }); mocks.adminReply.mockResolvedValue({ ...ticket, admin: true })
    render(<SupportView {...props} />); await openTicket()
    expect(Array.from((screen.getByLabelText('처리 상태') as HTMLSelectElement).options).map(option => option.text)).toEqual(['접수됨', '확인중', '답변완료'])
    fireEvent.change(screen.getByLabelText('처리 상태'), { target: { value: 'IN_REVIEW' } }); await waitFor(() => expect(mocks.status).toHaveBeenCalledWith('42', 7, 'IN_REVIEW'))
    await waitFor(() => expect((screen.getByText('답변 저장') as HTMLButtonElement).disabled).toBe(true))
    fireEvent.change(screen.getByLabelText('관리자 답변'), { target: { value: 'answer' } }); fireEvent.click(screen.getByText('답변 저장'))
    await waitFor(() => expect(mocks.adminReply).toHaveBeenCalledWith('42', 7, 'answer'))
    expect(screen.queryByText('문의 종료')).toBeNull(); expect(screen.queryByText('문의 삭제')).toBeNull()
  })
  it('preloads the current administrator answer for editing', async () => {
    administrator(); mocks.adminDetail.mockResolvedValue({ ...ticket, admin: true, messages: [...ticket.messages, { id: 2, authorRole: 'ADMIN', body: 'saved answer', createdAt: summary.createdAt }] }); render(<SupportView {...props} />); await openTicket()
    expect((screen.getByLabelText('관리자 답변') as HTMLTextAreaElement).value).toBe('saved answer')
  })
  it('fences an account-switched pending access check', async () => {
    let release!: (value: { admin: boolean }) => void; mocks.access.mockImplementationOnce(() => new Promise(resolve => { release = resolve })).mockResolvedValue({ admin: false })
    const view = render(<SupportView {...props} />); view.rerender(<SupportView {...props} user={{ ...user, githubId: '43' }} />); release({ admin: true })
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith('43', 0)); expect(mocks.adminList).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalledWith('42', 0)
  })
  it('clears a previous administrator detail immediately when the account changes', async () => {
    administrator(); const view = render(<SupportView {...props} />); await openTicket(); mocks.access.mockImplementation(() => new Promise(() => {}))
    view.rerender(<SupportView {...props} user={{ ...user, githubId: '43' }} />)
    expect(screen.queryByText('body')).toBeNull(); expect(screen.queryByLabelText('관리자 답변')).toBeNull()
  })
  it('clears private state and invalidates authentication on 401', async () => {
    mocks.access.mockRejectedValueOnce(new ApiMockError('expired', 401)); render(<SupportView {...props} />)
    await waitFor(() => expect(props.onAuthInvalid).toHaveBeenCalledTimes(1)); expect(mocks.list).not.toHaveBeenCalled()
  })
  it('clears detail and drafts on a 409 before an administrator write', async () => {
    administrator(); render(<SupportView {...props} />); await openTicket(); mocks.me.mockRejectedValueOnce(new ApiMockError('changed', 409))
    fireEvent.change(screen.getByLabelText('관리자 답변'), { target: { value: 'draft' } }); fireEvent.click(screen.getByText('답변 저장'))
    await waitFor(() => expect(props.onAuthInvalid).toHaveBeenCalledTimes(1)); expect(screen.queryByLabelText('관리자 답변')).toBeNull(); expect(mocks.adminReply).not.toHaveBeenCalled()
  })
  it('does not dispatch a pending create after account switching before getMe', async () => {
    let release!: (value: typeof user) => void; mocks.me.mockImplementationOnce(() => new Promise(resolve => { release = resolve })); const view = render(<SupportView {...props} />); await waitFor(() => screen.getByLabelText('제목'))
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: 'title' } }); fireEvent.change(screen.getByLabelText('내용'), { target: { value: 'body' } }); fireEvent.click(screen.getByText('문의 등록')); view.rerender(<SupportView {...props} user={{ ...user, githubId: '43' }} />); release(user)
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith('43', 0)); expect(mocks.create).not.toHaveBeenCalled(); expect(props.onAuthInvalid).not.toHaveBeenCalled()
  })
  it('loads the next bounded page', async () => {
    mocks.list.mockResolvedValue({ ...page, items: [], total: 21, hasMore: true }); render(<SupportView {...props} />); await waitFor(() => expect(mocks.list).toHaveBeenCalledWith('42', 0)); fireEvent.click(screen.getByText('다음')); await waitFor(() => expect(mocks.list).toHaveBeenCalledWith('42', 1))
  })
  it('keeps the composer clear when a late detail arrives after 새 문의', async () => {
    let release!: (value: typeof ticket) => void; mocks.list.mockResolvedValue(page); mocks.detail.mockImplementation(() => new Promise(resolve => { release = resolve })); render(<SupportView {...props} />); await waitFor(() => screen.getByText('ticket')); fireEvent.click(screen.getByText('ticket')); await waitFor(() => expect(release).toBeTypeOf('function')); fireEvent.click(screen.getByRole('button', { name: '새 문의' })); release(ticket)
    await waitFor(() => screen.getByText('문의 등록')); expect(screen.queryByText('접수 내용')).toBeNull()
  })
})

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SiteLoginStatus } from './SiteLoginStatus'
afterEach(cleanup)

it('shows each site state with a sign-in link only where needed', async () => {
  let calls = 0
  const load = async () => { calls++; return { sites: [
    { platform: 'JUNGOL', state: 'SIGNED_IN' }, { platform: 'SWEA', state: 'SIGNED_IN', name: '닉네임' }, { platform: 'PROGRAMMERS', state: 'SIGNED_OUT' }] } }
  render(<SiteLoginStatus load={load} />)
  await waitFor(() => expect(screen.getByText('로그인됨 · 닉네임')).toBeTruthy())
  const rows = [...document.querySelectorAll('.site-login-list li')]
  expect(rows.map(row => row.getAttribute('data-state'))).toEqual(['SIGNED_IN', 'SIGNED_IN', 'SIGNED_OUT'])
  const programmers = rows[2]!.querySelector('a')!
  expect(programmers.textContent).toBe('로그인')
  expect(programmers.getAttribute('href')).toMatch(/^https:\/\/programmers\.co\.kr\/account\/sign_in/)
  expect(programmers.getAttribute('target')).toBe('_blank')
  expect(rows[0]!.querySelector('a')!.textContent).toBe('사이트 열기')
  // Coming back from signing in elsewhere checks again, once per focus.
  const before = calls
  fireEvent.focus(window)
  await waitFor(() => expect(calls).toBe(before + 1))
})

it('never takes a link or unknown platform from the extension answer and reports failures', async () => {
  render(<SiteLoginStatus load={async () => ({ sites: [{ platform: 'EVIL', state: 'SIGNED_IN', loginUrl: 'https://evil.test' }] })} />)
  await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/확인하지 못했습니다/))
  expect([...document.querySelectorAll('a')].every(link => /^https:\/\/(jungol\.co\.kr|swexpertacademy\.com|programmers\.co\.kr)\//.test(link.getAttribute('href')!))).toBe(true)
})

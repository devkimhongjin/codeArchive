// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { CodeBlock } from './CodeBlock'
afterEach(cleanup)
it('highlights actual Java tokens while preserving code as text', async () => {
  const code = 'class Main { String text = "<script>alert(1)</script>"; }'
  const { container } = render(<CodeBlock code={code} language="Java" />)
  await waitFor(() => expect(container.querySelector('code span[style]')).not.toBeNull(), { timeout: 10000 })
  expect(container.querySelector('code')?.textContent).toBe(code)
  expect(container.querySelector('script')).toBeNull()
})
it('does not show old asynchronous highlighting after switching solutions', async () => {
  const { rerender, container } = render(<CodeBlock code="class Old {}" language="Java" />)
  rerender(<CodeBlock code="new <literal>" language="Unknown" />)
  expect(screen.getByRole('region', { name: '소스 코드' })).toBeTruthy()
  await waitFor(() => expect(container.querySelector('code')?.textContent).toBe('new <literal>'))
})
it('applies the active Shiki light and dark foreground/background palettes to the DOM', async () => {
  const original = window.matchMedia
  try {
    window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia
    const { container, rerender } = render(<CodeBlock code="const value = 1" language="JavaScript" lightTheme="solarized-light" darkTheme="dracula" />)
    await waitFor(() => expect(container.querySelector('.code-viewer')?.getAttribute('data-shiki-theme')).toBe('solarized-light'))
    const light = container.querySelector<HTMLElement>('.code-viewer')!
    expect(light.style.backgroundColor).not.toBe('')
    expect(light.querySelector<HTMLElement>('pre')?.style.color).not.toBe('')
    const lightBackground = light.style.backgroundColor
    window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia
    rerender(<CodeBlock code="const value = 1" language="JavaScript" lightTheme="solarized-light" darkTheme="one-dark-pro" />)
    await waitFor(() => expect(container.querySelector('.code-viewer')?.getAttribute('data-shiki-theme')).toBe('one-dark-pro'))
    const dark = container.querySelector<HTMLElement>('.code-viewer')!
    expect(dark.style.backgroundColor).not.toBe('')
    expect(dark.style.backgroundColor).not.toBe(lightBackground)
  } finally { window.matchMedia = original }
})

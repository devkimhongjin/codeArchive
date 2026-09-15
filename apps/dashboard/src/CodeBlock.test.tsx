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

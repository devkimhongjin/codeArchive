// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'
import { bundledThemesInfo } from 'shiki'
import { DARK_THEMES, LIGHT_THEMES, isLightTheme, type CodeTheme, type DarkTheme, type LightTheme } from '../../../shared/codeThemes'
import { CodeThemePreview } from './CodeThemePreview'

afterEach(cleanup)
function Preview() {
  const [theme, setTheme] = useState<CodeTheme>('github-light')
  const light = isLightTheme(theme)
  return <CodeThemePreview lightTheme={light ? theme as LightTheme : 'github-light'} darkTheme={light ? 'github-dark' : theme as DarkTheme} mode={light ? 'light' : 'dark'} onChange={setTheme} />
}

it('matches every bundled Shiki theme and previews its actual palette and unchanged sample', async () => {
  expect([...LIGHT_THEMES, ...DARK_THEMES].sort()).toEqual(bundledThemesInfo.map(theme => theme.id).sort())
  expect(LIGHT_THEMES.every(id => bundledThemesInfo.find(theme => theme.id === id)?.type === 'light')).toBe(true)
  expect(DARK_THEMES.every(id => bundledThemesInfo.find(theme => theme.id === id)?.type === 'dark')).toBe(true)
  render(<Preview />)
  const picker = screen.getByLabelText('코드 보기 테마')
  expect(picker.querySelectorAll('option')).toHaveLength(65)
  const viewer = screen.getByRole('region', { name: '소스 코드' })
  const code = viewer.querySelector('code')!.textContent
  for (const { id, type } of bundledThemesInfo) {
    fireEvent.change(picker, { target: { value: id } })
    await waitFor(() => expect(viewer.getAttribute('data-shiki-theme')).toBe(id))
    expect(viewer.style.backgroundColor).not.toBe('')
    expect(viewer.style.colorScheme).toBe(type)
    expect(viewer.querySelector('code')!.textContent).toBe(code)
  }
})

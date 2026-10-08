import { CodeBlock, CodeThemeSelect } from './CodeBlock'
import type { CodeTheme, CodeThemeMode, DarkTheme, LightTheme } from '../../../shared/codeThemes'

const sample = `// 코드 테마 미리보기
public class Main {
    public static void main(String[] args) {
        String message = "Hello, CodeArchive!";
        int answer = 42;
        if (answer > 0) {
            System.out.println(message + " " + answer);
        }
    }
}`

export function CodeThemePreview({ lightTheme, darkTheme, mode, onChange }: {
  lightTheme: LightTheme; darkTheme: DarkTheme; mode: CodeThemeMode; onChange: (theme: CodeTheme) => void
}) {
  const theme = mode === 'dark' ? darkTheme : lightTheme
  return <section className="settings-theme-preview" aria-label="코드 테마 미리보기">
    <label htmlFor="settings-code-theme">코드 보기 테마</label>
    <CodeThemeSelect id="settings-code-theme" value={theme} onChange={onChange} />
    <div className="settings-theme-preview-heading"><strong>테마 미리보기</strong><span>Java · {theme}</span></div>
    <CodeBlock code={sample} language="Java" lightTheme={lightTheme} darkTheme={darkTheme} activeMode={mode} />
  </section>
}

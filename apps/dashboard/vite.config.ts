import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { buildDefines, resolveBuildInfo } from '../../shared/build-info.mjs'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const apiProxyTarget = env.CODEARCHIVE_API_PROXY_TARGET || 'http://localhost:8080'
  const buildInfo = resolveBuildInfo({ env: { ...process.env, ...env }, cwd: process.cwd() })

  return {
    plugins: [react()],
    define: buildDefines(buildInfo),
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: true,
        },
      },
    },
  }
})

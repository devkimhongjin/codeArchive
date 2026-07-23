<script setup lang="ts">
import { ref } from 'vue'

interface PingMessage {
  type: 'PING'
  payload: null
}

interface BackgroundResponse {
  success: boolean
  data?: {
    received: boolean
  }
}

const backgroundStatus = ref('확인 전')

function openDashboard(): void {
  const dashboardUrl = chrome.runtime.getURL('src/dashboard/index.html')

  chrome.tabs.create({
    url: dashboardUrl,
  })
}

async function checkBackground(): Promise<void> {
  backgroundStatus.value = '확인 중'

  const message: PingMessage = {
    type: 'PING',
    payload: null,
  }

  try {
    const response = (await chrome.runtime.sendMessage(
      message,
    )) as BackgroundResponse

    backgroundStatus.value = response?.success ? '정상 연결' : '응답 오류'
  } catch (error: unknown) {
    console.error('[CodeArchive] Background connection failed:', error)

    backgroundStatus.value = '연결 실패'
  }
}
</script>

<template>
  <main class="popup">
    <h1>CodeArchive</h1>

    <p>
      Background:
      <strong>{{ backgroundStatus }}</strong>
    </p>

    <div class="actions">
      <button type="button" @click="checkBackground">연결 확인</button>

      <button type="button" @click="openDashboard">대시보드 열기</button>
    </div>
  </main>
</template>

<style scoped>
.popup {
  box-sizing: border-box;
  width: 320px;
  min-height: 180px;
  padding: 20px;
}

.actions {
  display: flex;
  gap: 8px;
}

button {
  padding: 8px 12px;
  cursor: pointer;
}
</style>

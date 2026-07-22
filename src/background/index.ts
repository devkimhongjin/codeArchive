console.info('[CodeArchive] Background service worker loaded')

chrome.runtime.onInstalled.addListener(() => {
  console.info('[CodeArchive] Extension installed')
})

chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ): boolean => {
    console.info('[CodeArchive] Message received:', message)

    sendResponse({
      success: true,
      data: {
        received: true,
      },
    })

    return false
  },
)
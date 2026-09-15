/** Keep ACKs bounded to the captures from the current pending page. */
export function acceptedIdsForAck(acceptedCaptureIds: unknown, pendingCaptureIds: string[]): string[] {
  if (!Array.isArray(acceptedCaptureIds)) return []
  const pending = new Set(pendingCaptureIds)
  const seen = new Set<string>()
  return acceptedCaptureIds.filter((captureId): captureId is string => {
    if (typeof captureId !== 'string' || !pending.has(captureId) || seen.has(captureId)) return false
    seen.add(captureId)
    return true
  })
}

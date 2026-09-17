export type RequestFence = {
  generation: number
  operation: number
}

export function requestIsCurrent(fence: RequestFence, generation: number, operation: number, active = true) {
  return active && fence.generation === generation && fence.operation === operation
}

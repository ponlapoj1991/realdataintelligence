export const runWhenIdle = (fn: () => void, timeoutMs = 1200) => {
  const w = window as any
  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(() => fn(), { timeout: timeoutMs })
    return
  }
  window.setTimeout(fn, 0)
}


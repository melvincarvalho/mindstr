// Live updates over the Solid notifications protocol (solid-0.1) that JSS
// speaks: connect to the Updates-Via WebSocket, `sub <url>`, and the server
// sends `pub <url>` whenever the resource changes.

export function watch(resourceUrl, updatesVia, { onChange, onStatus = () => {} }) {
  let ws
  let timer
  let retry = 0
  let stopped = false
  let wasLive = false

  const connect = () => {
    try {
      ws = new WebSocket(new URL(updatesVia, resourceUrl).href)
    } catch {
      return onStatus(false)
    }
    ws.onopen = () => ws.send('sub ' + resourceUrl)
    ws.onmessage = e => {
      const [cmd, url] = String(e.data).trim().split(/\s+/)
      if (url !== resourceUrl) return
      if (cmd === 'ack') {
        retry = 0
        onStatus(true)
        if (wasLive) onChange() // we may have missed updates while disconnected
        wasLive = true
      } else if (cmd === 'pub') {
        onChange()
      }
    }
    ws.onclose = () => {
      onStatus(false)
      if (!stopped) timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++))
    }
    ws.onerror = () => ws.close()
  }

  connect()
  return () => {
    stopped = true
    clearTimeout(timer)
    ws?.close()
  }
}

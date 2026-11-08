// Tokens, cost and timing for Claude requests (make/ and the app).

// Prices in $ per million tokens [input, output] (platform.claude.com pricing, 4 Nov 2026)
export const PRICES = { haiku: [0.1, 0.5], sonnet: [2, 10], opus: [4, 20] }
export const family = model => (/haiku/.test(model) ? 'haiku' : /sonnet/.test(model) ? 'sonnet' : 'opus')

export const cost = (req, model, prices = PRICES) => {
  const [pin, pout] = prices[family(model)] || [0, 0]
  return ((req.input || 0) * pin + (req.output || 0) * pout) / 1e6
}
export const money = usd => (usd < 0.01 ? `${(usd * 100).toFixed(2)}¢` : `$${usd.toFixed(usd < 1 ? 3 : 2)}`)

// A request's tokens from the stream's usage events: input tokens come with message_start,
// output tokens as a running figure in message_delta.
export function tally(usage, req) {
  if (usage.input_tokens !== undefined) {
    req.input = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0)
  }
  if (usage.output_tokens !== undefined) req.output = usage.output_tokens
}

// How long a request took: the total, the wait for the first node, and the average gap after it.
const seconds = ms => `${(ms / 1000).toFixed(1)}s`
export function stopwatch(now = () => performance.now()) {
  const start = now()
  let first = null
  return {
    firstNode() { first ??= now() },
    took(nodes) {
      const end = now()
      if (first === null) return seconds(end - start)
      const each = nodes > 1 ? (end - first) / (nodes - 1) : null
      const gap = each === null ? '' : `, ${each < 1000 ? `${Math.round(each)}ms` : seconds(each)} each`
      return `${seconds(end - start)} (first node ${seconds(first - start)}${gap})`
    }
  }
}

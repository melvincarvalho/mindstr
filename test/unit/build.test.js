import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adopt, buildMap, buildRequest, buildSystem, countNodes, outlineOnly, rooted, waitingLabel } from '../../js/build.js'
import { cost, money, stopwatch, tally } from '../../js/usage.js'

const settings = { depth: '2', breadth: '4', style: 'plan', links: 'no', lang: 'French', model: 'claude-haiku-4-5', think: 'no' }

test('buildSystem follows the settings', () => {
  const s = buildSystem(settings)
  assert.match(s, /the root has 4 branches/)
  assert.match(s, /Nest at most 2 levels/)
  assert.match(s, /under 30 nodes/)
  assert.match(s, /A plan of action/)
  assert.match(s, /No links\./)
  assert.match(s, /Language: French\./)
})

test('buildRequest: a topic, or a URL to fetch first', () => {
  assert.deepEqual(buildRequest('volcanoes'), { urls: [], content: 'Mind map of: volcanoes', extra: {} })
  const r = buildRequest('https://example.com/ the pricing')
  assert.deepEqual(r.urls, ['https://example.com/'])
  assert.equal(r.content, 'Mind map of the page at https://example.com/ (the pricing). Fetch first, then map what it says.')
  assert.equal(r.extra.tools[0].name, 'web_fetch')
})

test('outlineOnly drops chatter; rooted gives loose bullets one root', () => {
  assert.equal(outlineOnly("I'll fetch the page first.# Title\n- a\nok then\n  - b"), '# Title\n- a\n  - b\n')
  const two = [{ name: 'a', kids: [] }, { name: 'b', kids: [] }]
  assert.equal(rooted(two, 'https://www.example.com/x')[0].name, 'example.com/x')
  assert.equal(rooted([two[0]], 'q')[0], two[0])
})

test('adopt keeps ids stable as the outline grows', () => {
  const ids = new Map()
  const first = [{ name: 'root', kids: [{ name: 'a', kids: [] }] }]
  adopt(first, ids)
  const again = [{ name: 'root', kids: [{ name: 'a', kids: [] }, { name: 'b', kids: [] }] }]
  adopt(again, ids)
  assert.equal(again[0].id, '#this')
  assert.equal(again[0].kids[0].id, first[0].kids[0].id)
  assert.match(again[0].kids[1].id, /^#[a-z2-9]{6}$/)
})

test('buildMap streams growing trees, counts tokens, and ends with done', async () => {
  let asked
  const stream = async function * (opts) {
    asked = opts
    yield { usage: { input_tokens: 100 } }
    for (const text of ['Sure.\n# Volc', 'anoes\n- Types\n', '  - Shield\n- Hazards']) yield { text }
    yield { usage: { output_tokens: 40 } }
  }
  const steps = []
  for await (const step of buildMap('volcanoes', { key: 'k', settings, stream })) steps.push({ n: countNodes(step.tree), done: !!step.done, usage: { ...step.usage } })
  assert.equal(asked.key, 'k')
  assert.equal(asked.model, 'claude-haiku-4-5')
  assert.equal(asked.messages[0].content, 'Mind map of: volcanoes')
  assert.deepEqual(steps.map(s => s.n), [2, 3, 4]) // a node appears when its line is complete; the unfinished last line arrives with done
  assert.deepEqual(steps.at(-1), { n: 4, done: true, usage: { input: 100, output: 40 } })
})

test('buildMap without an outline says so', async () => {
  const stream = async function * () { yield { text: 'Sorry, I cannot.' } }
  await assert.rejects(async () => { for await (const _ of buildMap('x', { key: 'k', settings, stream })) {} }, /no outline/)
})

test('usage: tally, cost, money, stopwatch', () => {
  const req = {}
  tally({ input_tokens: 10, cache_read_input_tokens: 5 }, req)
  tally({ output_tokens: 7 }, req)
  assert.deepEqual(req, { input: 15, output: 7 })
  assert.equal(cost({ input: 1e6, output: 1e6 }, 'claude-sonnet-5-5'), 12)
  assert.equal(money(0.004), '0.40¢')
  assert.equal(money(0.021), '$0.021')
  let t = 0
  const w = stopwatch(() => t)
  t = 1000; w.firstNode()
  t = 3000
  assert.equal(w.took(5), '3.0s (first node 1.0s, 500ms each)')
})

test('waitingLabel: what the centre node says while a build waits (#63)', () => {
  assert.equal(waitingLabel('coffee'), 'Building coffee…')
  assert.equal(waitingLabel('https://www.example.com/'), 'Reading example.com…')
  assert.equal(waitingLabel('https://github.com/luke-jr/bips/blob/bip-blake2b-pow/bip-blake2b-pow.mediawiki'), 'Reading github.com/…/bip-blake2b-pow.mediawiki…')
  assert.equal(waitingLabel('x'.repeat(200)), 'Building ' + 'x'.repeat(32) + '…')
  assert.equal(waitingLabel('https://example.com/' + 'y'.repeat(200)).length, 53)
})

test('buildMap drops what the model wrote before the page was fetched (#65)', async () => {
  const stream = async function * () {
    yield { text: '# Fetching page\n' }
    yield { toolResult: true }
    for (const text of ['# weightless: abliteration\n- Core idea\n', '- Results\n']) yield { text }
  }
  const names = []
  for await (const step of buildMap('https://example.com/x', { key: 'k', settings, stream })) names.push(step.tree.name)
  assert.equal(names.at(-1), 'weightless: abliteration')
  assert.ok(!names.some(n => /Fetching/.test(n)), 'the chatter never shows, even while streaming')
})

test('buildMap with a link still builds if the model never fetched (#65)', async () => {
  const stream = async function * () { yield { text: '# Title\n- a\n- b\n' } }
  const steps = []
  for await (const step of buildMap('https://example.com/x', { key: 'k', settings, stream })) steps.push(step)
  assert.equal(steps.length, 1)
  assert.equal(steps[0].done, true)
  assert.equal(steps[0].tree.kids.length, 2)
})

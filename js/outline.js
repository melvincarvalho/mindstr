// Plain-text outlines ↔ trees, for copy/paste and import/export.
// A tree is { name, link?, kids: [tree] }.

// Markdown-ish text → array of trees. Understands "# headings", "- / * / + / 1." bullets
// and indentation (spaces or tabs).
export function parseOutline(text) {
  const roots = []
  const stack = [] // { level, node }
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    if (!raw.trim()) continue
    const indent = raw.match(/^[\t ]*/)[0].replace(/\t/g, '    ').length
    let line = raw.trim()
    let level
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      level = (heading[1].length - 1) * 100 // headings outrank any list indent
      line = heading[2]
    } else {
      level = 1000 + indent
      line = line.replace(/^([-*+]|\d+[.)])\s+/, '')
    }
    line = line.replace(/^\[[ xX]\]\s+/, '') // task-list boxes
    let link
    const md = line.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
    if (md) [, line, link] = md
    const node = { name: line.slice(0, 200), kids: [], ...(link ? { link } : {}) }
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
    if (stack.length) stack[stack.length - 1].node.kids.push(node)
    else roots.push(node)
    stack.push({ level, node })
  }
  return roots
}

// tree → Markdown: the root as a heading, descendants as nested bullets.
export function toMarkdown(tree) {
  const label = n => (n.link ? `[${n.name}](${n.link})` : n.name)
  const lines = [`# ${label(tree)}`, '']
  const walk = (n, depth) => {
    for (const k of n.kids) {
      lines.push(`${'  '.repeat(depth)}- ${label(k)}`)
      walk(k, depth + 1)
    }
  }
  walk(tree, 0)
  return lines.join('\n') + '\n'
}

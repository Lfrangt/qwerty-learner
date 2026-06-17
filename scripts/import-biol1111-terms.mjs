import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DICTIONARY_ID = 'BIOL_1111_Course_Terms'
const OUTPUT_PATH = path.join('public', 'dicts', `${DICTIONARY_ID}.json`)
const DICTIONARY_RESOURCE_PATH = path.join('src', 'resources', 'dictionary.ts')

const sourceDirs = [
  ...(process.env.BIOL1111_SOURCE_DIRS ? process.env.BIOL1111_SOURCE_DIRS.split(path.delimiter) : []),
  path.join(os.homedir(), 'Library', 'Mobile Documents', 'iCloud~md~obsidian', 'Documents', 'Khalil的笔记', '课程', 'BIOL 1111', '笔记md'),
  path.join(os.homedir(), 'Documents', 'Summer_2026', 'BIOL_1111', 'notes'),
]

const STOP_TERMS = new Set(['answer', 'blank', 'definition', 'english', 'function', 'location', 'question', 'term', 'type'])

const SOURCE_INCLUDE_PATTERN = /Glossary|术语对照表|单词背诵包|考前冲刺包|考前救急包/i
const SOURCE_EXCLUDE_PATTERN = /模拟|考试卷|Fill_in|Anki|易考点|思维导图|Cheatsheet|_笔记|导读|详细|源课件|Outline/i

function listMarkdownFiles(entryPath) {
  if (!fs.existsSync(entryPath)) return []
  const stat = fs.statSync(entryPath)
  if (stat.isFile()) return entryPath.endsWith('.md') ? [entryPath] : []
  return fs.readdirSync(entryPath, { withFileTypes: true }).flatMap((entry) => listMarkdownFiles(path.join(entryPath, entry.name)))
}

function splitMarkdownRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cleanCell(cell))
}

function isSeparatorRow(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
}

function cleanCell(value) {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]\([^)]*\)/g, (match) => match.replace(/^\[|\]\([^)]*\)$/g, ''))
    .replace(/[`*_~#]/g, '')
    .replace(/⭐|❌|✅/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeHeader(value) {
  return cleanCell(value).toLowerCase()
}

function containsChinese(value) {
  return /[\u3400-\u9fff]/.test(value)
}

function looksLikeTerm(value) {
  if (!value || containsChinese(value)) return false
  if (!/[A-Za-z]/.test(value)) return false
  if (/[.!?。？！=°]/.test(value)) return false
  if (/\bvs\b|^not\b|^there\b|^only\b|^many\b|^which\b|^blank\b/i.test(value)) return false
  if (/\b(forms?|is|are|was|were|means?|replaces?|gives?|has|have|can|linked|composed|holds?|made)\b/i.test(value)) return false
  if (/^IMG\d+|^\d|\/\d|\d{2,}|[()]/.test(value)) return false
  if (value.length > 64) return false
  const words = value.match(/[A-Za-z][A-Za-z0-9+-]*/g) ?? []
  if (words.length === 0 || words.length > 6) return false
  if (words.length === 1 && value.length < 2) return false
  if (STOP_TERMS.has(value.toLowerCase())) return false
  if (/^(if|what|why|how|where|when|which|this|that)\b/i.test(value)) return false
  return true
}

function toDisplayTerm(value) {
  const cleaned = cleanCell(value)
    .replace(/^[\d.)\-\s]+/, '')
    .replace(/\s*→\s*/g, ' to ')
    .trim()

  if (/^[A-Z0-9+-]{2,}$/.test(cleaned)) return cleaned
  if (/^pH$/.test(cleaned)) return cleaned
  return cleaned.toLowerCase()
}

function splitTermVariants(value, header) {
  const variants = new Set()
  const cleaned = cleanCell(value)

  const addVariant = (term) => {
    const normalized = toDisplayTerm(term)
    if (!looksLikeTerm(normalized)) return
    if (/organ system/i.test(header) && !/\bsystem$/i.test(normalized)) {
      variants.add(`${normalized} system`)
      return
    }
    variants.add(normalized)
  }

  const addPart = (part) => {
    const parenthetical = part.match(/^([^()]+)\(([^()]+)\)$/)
    if (parenthetical) {
      addVariant(parenthetical[1])
      addVariant(parenthetical[2])
      return
    }
    addVariant(part)
  }

  cleaned
    .split(/\s+\/\s+|\s+or\s+/i)
    .map((part) => part.trim())
    .forEach(addPart)

  if (variants.size === 0) addVariant(cleaned)
  return [...variants]
}

function isTermHeader(header) {
  return (
    /^english$/.test(header) ||
    /english term|english exam|英文考试词|^英文$|^term$|^tissue$|^type$|^property$|organ system|^hormone$/.test(header)
  )
}

function isAnswerHeader(header, headers) {
  return /^answer$/.test(header) && headers.some((item) => /blank|missing/.test(item))
}

function buildTranslations(headers, cells, termIndexes) {
  const values = []
  for (let index = 0; index < cells.length; index += 1) {
    if (termIndexes.includes(index)) continue
    const header = headers[index] ?? ''
    const cell = cleanCell(cells[index] ?? '')
    if (!cell || cell.length < 2) continue
    if (/^[-—]+$/.test(cell)) continue
    if (containsChinese(cell)) {
      values.push(cell)
      continue
    }
    if (/definition|explanation|function|keyword|location|effect|structure|判断|题目|考|记法|线索/.test(header)) {
      values.push(cell)
    }
  }

  return [...new Set(values)].map((item) => (item.length > 180 ? `${item.slice(0, 177)}...` : item)).slice(0, 4)
}

function addEntry(entries, term, translations) {
  if (!translations.length) return
  const key = term.toLowerCase()
  const existing = entries.get(key)
  if (existing) {
    existing.trans = [...new Set([...existing.trans, ...translations])].slice(0, 4)
    return
  }
  entries.set(key, {
    name: term,
    trans: translations,
    usphone: '',
    ukphone: '',
  })
}

function collectFromTable(entries, headerCells, rows) {
  const headers = headerCells.map(normalizeHeader)
  for (const row of rows) {
    if (row.length !== headerCells.length) continue

    let termIndexes = headers
      .map((header, index) => (isTermHeader(header) || isAnswerHeader(header, headers) ? index : -1))
      .filter((index) => index >= 0)

    if (termIndexes.length === 0 && looksLikeTerm(row[0]) && row.slice(1).some(containsChinese)) {
      termIndexes = [0]
    }

    const translations = buildTranslations(headers, row, termIndexes)
    for (const termIndex of termIndexes) {
      const header = headers[termIndex] ?? ''
      splitTermVariants(row[termIndex] ?? '', header).forEach((term) => addEntry(entries, term, translations))
    }
  }
}

function collectEntriesFromMarkdown(filePath, entries) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].includes('|') || !isSeparatorRow(lines[index + 1])) continue

    const header = splitMarkdownRow(lines[index])
    const rows = []
    index += 2
    while (index < lines.length && lines[index].includes('|') && !/^\s*$/.test(lines[index])) {
      rows.push(splitMarkdownRow(lines[index]))
      index += 1
    }
    collectFromTable(entries, header, rows)
  }
}

function shuffle(entries) {
  let seed = 0x8c3f5a21
  const random = () => {
    seed += 0x6d2b79f5
    let value = seed
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
  for (let index = entries.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[entries[index], entries[target]] = [entries[target], entries[index]]
  }
  return entries
}

function updateDictionaryLength(length) {
  if (!fs.existsSync(DICTIONARY_RESOURCE_PATH)) return
  const source = fs.readFileSync(DICTIONARY_RESOURCE_PATH, 'utf8')
  const matcher = new RegExp(`(id: '${DICTIONARY_ID}',[\\s\\S]*?length: )\\d+`)
  const updated = source.replace(matcher, `$1${length}`)
  if (updated !== source) fs.writeFileSync(DICTIONARY_RESOURCE_PATH, updated)
}

const files = [...new Set(sourceDirs.flatMap(listMarkdownFiles))]
  .filter((file) => SOURCE_INCLUDE_PATTERN.test(path.basename(file)) && !SOURCE_EXCLUDE_PATTERN.test(path.basename(file)))
  .sort()
if (files.length === 0) {
  console.error('No BIOL 1111 markdown files found. Set BIOL1111_SOURCE_DIRS to override the source directories.')
  process.exit(1)
}

const entries = new Map()
files.forEach((file) => collectEntriesFromMarkdown(file, entries))

const dictionary = shuffle([...entries.values()].sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' })))

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(dictionary, null, 2)}\n`)
updateDictionaryLength(dictionary.length)

console.log(`Imported ${dictionary.length} BIOL 1111 terms from ${files.length} markdown files.`)
console.log(
  dictionary
    .slice(0, 12)
    .map((entry) => entry.name)
    .join(', '),
)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DICTIONARY_RESOURCE_PATH = path.join('src', 'resources', 'dictionary.ts')
const OUTPUT_DIR = path.join('public', 'dicts')
const DESKTOP_DIR = path.join(os.homedir(), 'Desktop')

const SOURCE_FILES = {
  coreVocabulary: path.join(DESKTOP_DIR, '多邻国核心词汇-2026.html'),
  passageWords: path.join(DESKTOP_DIR, '4类英文短问掌握多邻国3000必备词.html'),
  speaking: path.join(DESKTOP_DIR, '多邻国口语2026.html'),
  writing: path.join(DESKTOP_DIR, '多邻国参考整体写作模板.html'),
  clozeClassic: path.join(DESKTOP_DIR, '完形经典必做题笔记.html'),
  clozeReal: path.join(DESKTOP_DIR, '完形真题整理.html'),
}

const DICTIONARIES = [
  {
    id: 'DET_Core_Vocabulary_2026',
    name: '多邻国核心词汇 2026',
    description: '从桌面 DET 核心词汇资料导入的高频词',
    url: '/dicts/DET_Core_Vocabulary_2026.json',
    collect: collectCoreVocabulary,
  },
  {
    id: 'DET_3000_Passage_Words',
    name: '多邻国 3000 短文核心词',
    description: '从 4 类短文资料标粗词导入的 DET 高频词',
    url: '/dicts/DET_3000_Passage_Words.json',
    collect: collectPassageWords,
  },
  {
    id: 'DET_3000_Passage_Sentences',
    name: '多邻国 3000 短文句子',
    description: '从 4 类短文资料切分出的英文短句',
    url: '/dicts/DET_3000_Passage_Sentences.json',
    collect: collectPassageSentences,
  },
  {
    id: 'DET_Speaking_2026_Sentences',
    name: '多邻国口语 2026 句型',
    description: '从桌面 DET 口语资料导入的可背诵句型',
    url: '/dicts/DET_Speaking_2026_Sentences.json',
    collect: collectSpeakingSentences,
  },
  {
    id: 'DET_Writing_Template_2026',
    name: '多邻国写作模板 2026',
    description: '从桌面 DET 写作模板拆分出的短句型块',
    url: '/dicts/DET_Writing_Template_2026.json',
    collect: collectWritingTemplates,
  },
  {
    id: 'DET_Cloze_Completion_Answers',
    name: '多邻国完形答案词',
    description: '从完形资料导入的答案词，保留前缀提示',
    url: '/dicts/DET_Cloze_Completion_Answers.json',
    collect: collectClozeAnswers,
  },
]

function readSource(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing DET source file: ${filePath}`)
  }
  return fs.readFileSync(filePath, 'utf8')
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

function cleanHtml(value) {
  return decodeEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<img\b[^>]*>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanTerm(value) {
  return cleanHtml(value)
    .replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '')
    .toLowerCase()
}

function cleanChinese(value) {
  return cleanHtml(value)
    .replace(/^（|）$/g, '')
    .trim()
}

function looksLikeEnglish(value) {
  return /^[A-Za-z][A-Za-z0-9 ,.'!?;:()/-]*[A-Za-z0-9.!?)]$/.test(value) && !/[\u3400-\u9fff]/.test(value)
}

function looksLikeWord(value) {
  return /^[a-z][a-z-]{2,30}$/.test(value)
}

function normalizeSentence(value) {
  return cleanHtml(value)
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s*…+\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitSentences(text) {
  const normalized = normalizeSentence(text)
    .replace(/([.!?])(?=[A-Z])/g, '$1 ')
    .replace(/([.!?])\s+/g, '$1|')

  return normalized
    .split('|')
    .map((item) => item.trim())
    .filter((item) => looksLikeEnglish(item) && item.length >= 18 && item.length <= 160)
}

function addEntry(entries, name, trans) {
  const cleanName = normalizeSentence(name)
  if (!cleanName) return
  const translations = (Array.isArray(trans) ? trans : [trans]).map((item) => normalizeSentence(String(item))).filter(Boolean)
  if (translations.length === 0) return

  const key = cleanName.toLowerCase()
  const existing = entries.get(key)
  if (existing) {
    existing.trans = [...new Set([...existing.trans, ...translations])].slice(0, 4)
    return
  }

  entries.set(key, {
    name: cleanName,
    trans: [...new Set(translations)].slice(0, 4),
    usphone: '',
    ukphone: '',
  })
}

function shuffle(entries, seed = 0x4d455421) {
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

function collectCoreVocabulary() {
  const html = readSource(SOURCE_FILES.coreVocabulary)
  const entries = new Map()
  const rowPattern =
    /<tr><td class="word en">([\s\S]*?)<\/td><td class="pos en">([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><td class="freq">([\s\S]*?)<\/td><td class="type">([\s\S]*?)<\/td><\/tr>/g

  for (const match of html.matchAll(rowPattern)) {
    const word = cleanTerm(match[1])
    if (!looksLikeWord(word)) continue
    const pos = cleanHtml(match[2])
    const meaning = cleanHtml(match[3])
    const frequency = cleanHtml(match[4])
    const taskType = cleanHtml(match[5])
    addEntry(entries, word, [`${pos} ${meaning}`, `频次 ${frequency}；常考：${taskType}`])
  }

  return shuffle([...entries.values()], 0x20260001)
}

function collectPassageWords() {
  const html = readSource(SOURCE_FILES.passageWords)
  const entries = new Map()
  const wordPattern = /<span class="w">([\s\S]*?)<\/span>\s*<span class="cn">([\s\S]*?)<\/span>/g

  for (const match of html.matchAll(wordPattern)) {
    const word = cleanTerm(match[1])
    if (!looksLikeWord(word)) continue
    const meaning = cleanChinese(match[2])
    addEntry(entries, word, meaning)
  }

  return shuffle([...entries.values()], 0x20260002)
}

function collectPassageSentences() {
  const html = readSource(SOURCE_FILES.passageWords)
  const entries = new Map()
  let section = '4 类短文'
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  const blockPattern = /<h2>[\s\S]*?<\/h2>|<p>([\s\S]*?)<\/p>/g

  for (const match of body.matchAll(blockPattern)) {
    const block = match[0]
    if (block.startsWith('<h2>')) {
      section = cleanHtml(block).replace(/^[①②③④]\s*/, '')
      continue
    }

    const paragraph = block.replace(/<span class="cn">[\s\S]*?<\/span>/g, '').replace(/<span class="w">([\s\S]*?)<\/span>/g, '$1')
    splitSentences(paragraph).forEach((sentence) => addEntry(entries, sentence, section))
  }

  return shuffle([...entries.values()], 0x20260003)
}

function collectSpeakingSentences() {
  const html = readSource(SOURCE_FILES.speaking)
  const entries = new Map()

  for (const match of html.matchAll(/<(?:li|p) class="en">([\s\S]*?)<\/(?:li|p)>/g)) {
    if (/…/.test(match[1])) continue
    const sentence = normalizeSentence(match[1])
    if (looksLikeEnglish(sentence) && sentence.length <= 160) {
      addEntry(entries, sentence, 'DET 口语句型')
    }
  }

  const completedTemplates = [
    'I think this choice is better. First, it is useful. For example, it saves time. Besides, it makes life easier. So that is why I hold this opinion.',
    'I really like reading books because it helps me relax.',
    'I prefer studying in a quiet place mainly because it helps me focus.',
    'It is beneficial because it helps people improve their efficiency and reduce stress.',
    'I think the main reason is that it brings convenience and saves a lot of time.',
  ]
  completedTemplates.forEach((sentence) => addEntry(entries, sentence, 'DET 口语补全模板'))

  return shuffle([...entries.values()], 0x20260004)
}

function collectWritingTemplates() {
  const entries = new Map()
  const templates = [
    ['Recently, this issue has caused debate.', '开头：引出话题'],
    ['I reckon that it is beneficial.', '开头：表达支持'],
    ['I think this choice is reasonable.', '开头：表达观点'],
    ['From my perspective, it is useful.', '观点：个人立场'],
    ['Firstly, this point is worth considering.', '主体段一：起句'],
    ['In the face of problems, perseverance matters.', '主体段一：困难与坚持'],
    ['Perseverance can create positive results.', '主体段一：坚持的作用'],
    ['It can bring positive impacts.', '理由：正面影响'],
    ['It helps students solve problems.', '理由：学生场景'],
    ['It should be taken into account.', '理由：强调重要性'],
    ['Secondly, this idea also matters.', '主体段二：起句'],
    ['It supports individual development.', '主体段二：个人发展'],
    ['It also benefits the community.', '主体段二：社区影响'],
    ['Perseverance is a catalyst for growth.', '主体段二：高级表达'],
    ['For example, it can save time.', '例子：节省时间'],
    ['Besides, it can reduce stress.', '补充：减少压力'],
    ['More importantly, it improves efficiency.', '补充：提高效率'],
    ['However, every choice has drawbacks.', '让步：承认缺点'],
    ['We should consider both sides.', '让步：双面分析'],
    ['Overall, the advantages are stronger.', '总结：利大于弊'],
    ['In conclusion, I support this choice.', '结尾：总结观点'],
    ['I prefer this choice because it brings balance.', '选择题结尾'],
    ['This is a key element of a harmonious society.', '结尾：高级收束'],
  ]

  templates.forEach(([sentence, trans]) => addEntry(entries, sentence, trans))
  return [...entries.values()]
}

function collectClozeAnswers() {
  const entries = new Map()
  const files = [SOURCE_FILES.clozeReal, SOURCE_FILES.clozeClassic]

  for (const filePath of files) {
    const html = readSource(filePath)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    const sourceName = path.basename(filePath, '.html')
    for (const match of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
      const text = cleanHtml(match[1])
      if (!text.includes('_')) continue

      const cloze = text.match(/^([A-Za-z][A-Za-z]*\s*(?:_+\s*)+)(.+)$/)
      if (!cloze) continue

      const hint = cloze[1].replace(/\s+/g, ' ').trim()
      const answers = cloze[2]
        .trim()
        .split(/[\/;,，、]|\s+or\s+/i)
        .map((answer) => cleanTerm(answer))
        .filter((answer) => looksLikeWord(answer) && answer.length >= 4)

      answers.forEach((answer) => addEntry(entries, answer, [`完形提示：${hint}`, sourceName]))
    }
  }

  return shuffle([...entries.values()], 0x20260005)
}

function formatResourceEntry(resource) {
  return `  {
    id: '${resource.id}',
    name: '${resource.name}',
    description: '${resource.description}',
    category: '国际考试',
    tags: ['Duolingo', 'DET'],
    url: '${resource.url}',
    length: ${resource.length},
    language: 'en',
    languageCategory: 'en',
  },`
}

function updateDictionaryResources(resources) {
  const source = fs.readFileSync(DICTIONARY_RESOURCE_PATH, 'utf8')
  const generatedBlock = resources.map(formatResourceEntry).join('\n')
  const markerStart = '  // Codex DET desktop materials start\n'
  const markerEnd = '  // Codex DET desktop materials end\n'
  const block = `${markerStart}${generatedBlock}\n${markerEnd}`

  if (source.includes(markerStart)) {
    const updated = source.replace(new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`), block)
    fs.writeFileSync(DICTIONARY_RESOURCE_PATH, updated)
    return
  }

  const anchor = /(\s*\{\n\s*id: 'Duolingo_Reading_Core_100_115',[\s\S]*?\n\s*\},\n)/
  const updated = source.replace(anchor, `$1${block}`)
  if (updated === source) throw new Error('Could not insert DET desktop dictionary resources.')
  fs.writeFileSync(DICTIONARY_RESOURCE_PATH, updated)
}

const resourceSummaries = []

for (const dictionary of DICTIONARIES) {
  const entries = dictionary.collect()
  const outputPath = path.join(OUTPUT_DIR, `${dictionary.id}.json`)
  fs.writeFileSync(outputPath, `${JSON.stringify(entries, null, 2)}\n`)
  resourceSummaries.push({
    id: dictionary.id,
    name: dictionary.name,
    description: dictionary.description,
    url: dictionary.url,
    length: entries.length,
  })
}

updateDictionaryResources(resourceSummaries)

console.log('Imported DET desktop typing dictionaries:')
for (const resource of resourceSummaries) {
  console.log(`- ${resource.id}: ${resource.length}`)
}

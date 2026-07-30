#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = process.cwd()
const localeDir = path.join(repoRoot, 'src/renderer/i18n/locales')
const skillDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const glossary = JSON.parse(fs.readFileSync(path.join(skillDir, 'references/glossary.json'), 'utf8'))

const localeArgIndex = process.argv.indexOf('--locales')
const requestedLocales =
  localeArgIndex >= 0 && process.argv[localeArgIndex + 1]
    ? new Set(process.argv[localeArgIndex + 1].split(',').map((s) => s.trim()).filter(Boolean))
    : null
const keyFileIndex = process.argv.indexOf('--keys-file')
const strictKeys =
  keyFileIndex >= 0 && process.argv[keyFileIndex + 1]
    ? new Set(
        fs
          .readFileSync(process.argv[keyFileIndex + 1], 'utf8')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      )
    : null
const strictAll = process.argv.includes('--strict')

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function protectedTokens(text) {
  return (String(text || '').match(/{{[^}]+}}|<\/?[A-Za-z0-9]+>/g) || []).sort()
}

function sameMultiset(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasWholeWord(source, term) {
  return new RegExp(`\\b${escapeRe(term)}\\b`, 'i').test(source)
}

function includesForcedTerm(translation, forced) {
  return translation.toLowerCase().includes(forced.toLowerCase())
}

const verbatimGuardTerms = glossary.keepVerbatim.filter((term) => /^[A-Za-z][A-Za-z0-9]{4,}$/.test(term))

function hasStem(text, term) {
  return new RegExp(`\\b${escapeRe(term)}`).test(text)
}

function entryIssues(source, translation, locale) {
  const issues = []
  if (!sameMultiset(protectedTokens(source), protectedTokens(translation))) {
    issues.push('占位符/标签不一致')
  }

  const forcedTerms = glossary.translateAs[locale] || {}
  for (const [term, forced] of Object.entries(forcedTerms)) {
    if (hasWholeWord(source, term) && !includesForcedTerm(translation, forced)) {
      issues.push(`缺少强制译法 ${term}=>${forced}`)
    }
  }

  for (const term of verbatimGuardTerms) {
    if (hasStem(source, term) && !hasStem(translation, term)) {
      issues.push(`丢失应保留术语 ${term}`)
    }
  }

  return issues
}

if (!fs.existsSync(localeDir)) {
  console.error(`未找到 locale 目录：${localeDir}`)
  process.exit(2)
}

const enFile = path.join(localeDir, 'en/translation.json')
const en = readJson(enFile)
const enKeys = Object.keys(en).sort()
const localeNames = fs
  .readdirSync(localeDir)
  .filter((name) => fs.existsSync(path.join(localeDir, name, 'translation.json')))
  .filter((name) => !requestedLocales || requestedLocales.has(name))
  .sort()

let problemCount = 0
let warningCount = 0

for (const locale of localeNames) {
  const file = path.join(localeDir, locale, 'translation.json')
  const json = readJson(file)
  const keys = Object.keys(json).sort()
  const problems = []
  const warnings = []

  for (const key of enKeys) {
    if (!(key in json)) {
      problems.push({ key, issues: ['缺少 key'] })
      continue
    }

    const value = json[key]
    if (!value) {
      problems.push({ key, issues: ['value 为空'] })
      continue
    }

    const source = en[key] || key
    if (locale === 'en') {
      if (!source) problems.push({ key, issues: ['英文源文为空'] })
      continue
    }

    const issues = entryIssues(source, value, locale)
    if (issues.length) {
      const strictForKey = strictAll || strictKeys?.has(key)
      ;(strictForKey ? problems : warnings).push({ key, issues })
    }
  }

  for (const key of keys) {
    if (!(key in en)) problems.push({ key, issues: ['多余 key：en 中不存在'] })
  }

  if (problems.length) {
    problemCount += problems.length
    console.log(`✗ ${locale}: ${problems.length} 个问题`)
    for (const { key, issues } of problems.slice(0, 80)) {
      console.log(`    ${JSON.stringify(key.slice(0, 100))}: ${issues.join('; ')}`)
    }
    if (problems.length > 80) console.log(`    ... 还有 ${problems.length - 80} 个`)
  } else {
    console.log(`✓ ${locale}: 通过（${keys.length} 个 key）`)
  }
  if (warnings.length) {
    warningCount += warnings.length
    console.log(`  警告 ${locale}: ${warnings.length} 个`)
    for (const { key, issues } of warnings.slice(0, 30)) {
      console.log(`    ${JSON.stringify(key.slice(0, 100))}: ${issues.join('; ')}`)
    }
    if (warnings.length > 30) console.log(`    ... 还有 ${warnings.length - 30} 个`)
  }
}

if (problemCount) {
  console.error(`\n发现 ${problemCount} 个 i18n 问题。`)
  process.exit(1)
}

console.log(
  warningCount
    ? `\n已检查的 locale 文件 key 都完整。另有 ${warningCount} 个占位符/glossary 警告。`
    : '\n已检查的 locale 文件 key 完整，且通过 glossary/占位符校验。'
)

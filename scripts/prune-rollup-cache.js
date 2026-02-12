/**
 * Prune .rollup-smart-cache: keep only the N most recent entries (and optionally
 * entries from the last X days). rollup-plugin-smart-cache never expires entries,
 * so the cache grows indefinitely; this script prevents that.
 *
 * Usage: node scripts/prune-rollup-cache.js [maxEntries] [maxAgeDays]
 *   maxEntries  - keep at most this many cache entries (default: 15)
 *   maxAgeDays  - also keep entries newer than this many days (default: 7)
 *   We keep: the maxEntries most recent entries, and any entry from the last maxAgeDays.
 *
 * Or: node scripts/prune-rollup-cache.js --clear  (same as clean:cache, remove all)
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')
const cacheDir = path.join(projectRoot, '.rollup-smart-cache')

const DEFAULT_MAX_ENTRIES = 15
const DEFAULT_MAX_AGE_DAYS = 7

function parseArgs() {
  const args = process.argv.slice(2)
  if (args[0] === '--clear' || args[0] === '--all') {
    return { clear: true }
  }
  const maxEntries = Math.max(1, parseInt(args[0], 10) || DEFAULT_MAX_ENTRIES)
  const maxAgeDays = Math.max(0, parseInt(args[1], 10) ?? DEFAULT_MAX_AGE_DAYS)
  return { maxEntries, maxAgeDays, clear: false }
}

function findMetadataFiles(dir, baseDir, list) {
  if (!fs.existsSync(dir)) return
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      findMetadataFiles(full, baseDir, list)
    } else if (e.name === 'metadata.json' && e.isFile()) {
      list.push(full)
    }
  }
}

function getEntryDir(metadataPath) {
  return path.dirname(metadataPath)
}

function getEntrySize(entryDir) {
  let total = 0
  function walk(d) {
    if (!fs.existsSync(d)) return
    const entries = fs.readdirSync(d, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile()) total += fs.statSync(full).size
    }
  }
  walk(entryDir)
  return total
}

function main() {
  const { clear, maxEntries, maxAgeDays } = parseArgs()

  if (!fs.existsSync(cacheDir)) {
    console.log('.rollup-smart-cache does not exist, nothing to prune')
    process.exit(0)
  }

  if (clear) {
    fs.rmSync(cacheDir, { recursive: true, force: true })
    console.log('✓ .rollup-smart-cache cleared')
    process.exit(0)
  }

  const metadataFiles = []
  findMetadataFiles(cacheDir, cacheDir, metadataFiles)

  if (metadataFiles.length === 0) {
    console.log('No cache entries found')
    process.exit(0)
  }

  const now = Date.now()
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000
  const entries = []

  for (const mpath of metadataFiles) {
    let timestamp = 0
    try {
      const data = JSON.parse(fs.readFileSync(mpath, 'utf8'))
      timestamp = data.timestamp || 0
    } catch (_) {
      timestamp = 0
    }
    const entryDir = getEntryDir(mpath)
    entries.push({
      path: entryDir,
      metadataPath: mpath,
      timestamp,
      size: getEntrySize(entryDir)
    })
  }

  entries.sort((a, b) => b.timestamp - a.timestamp)

  // Keep at most maxEntries most recent; also keep any entry from last maxAgeDays
  const toKeep = new Set()
  const cutoff = now - maxAgeMs
  for (const e of entries) {
    if (e.timestamp >= cutoff) toKeep.add(e.path)
  }
  for (let i = 0; i < Math.min(maxEntries, entries.length); i++) {
    toKeep.add(entries[i].path)
  }
  // Hard cap: if we have more than maxEntries, keep only the maxEntries most recent
  if (toKeep.size > maxEntries) {
    toKeep.clear()
    for (let i = 0; i < Math.min(maxEntries, entries.length); i++) {
      toKeep.add(entries[i].path)
    }
  }

  const toDelete = entries.filter(e => !toKeep.has(e.path))
  let freed = 0
  let deletedCount = 0

  for (const e of toDelete) {
    try {
      freed += e.size
      fs.rmSync(e.path, { recursive: true, force: true })
      deletedCount++
    } catch (err) {
      console.warn('Failed to delete', e.path, err.message)
    }
  }

  const freedMB = (freed / (1024 * 1024)).toFixed(2)
  console.log(`Pruned .rollup-smart-cache: removed ${deletedCount} entries, freed ${freedMB} MB (kept ${toKeep.size} most recent)`)
  process.exit(0)
}

main()

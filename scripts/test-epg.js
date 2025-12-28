#!/usr/bin/env node

import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

process.env.MEGACUBO_AS_LIBRARY = '1'

const mainPath = path.join(__dirname, '..', 'main.mjs')
const { default: megacubo } = await import(pathToFileURL(mainPath))

async function run () {
  console.log('Initializing Megacubo core in headless mode…')

  const timezone = { minutes: 0, name: 'UTC', offset: 0 }
  const langFolder = path.join(megacubo.paths.cwd, 'lang')

  await megacubo.lang.load('pt,en', 'pt', langFolder, timezone)
  console.log('Lang loaded ~~~~~~~~~~~~')

  await megacubo.renderer.ready(null, true)
  console.log('Renderer ready ~~~~~~~~~~~~')

  if (!megacubo.recommendations.initialized) {
    console.log('Initializing recommendations...')
    await megacubo.recommendations.initialize()
    console.log('Recommendations initialized')
  }

  const direct = await megacubo.recommendations.aiClient.expandTags({ horror: 1 })
  console.log('directExpand:', direct)

  const tagsBefore = await megacubo.recommendations.tags.expand({ horror: 1 })
  console.log('tagsBefore:', tagsBefore)

  await new Promise(resolve => setTimeout(resolve, 4000))

  const tagsAfter = await megacubo.recommendations.tags.expand({ horror: 1 })
  console.log('tagsAfter:', tagsAfter)
  console.log('Done.')
  process.exit(0)
}

run().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import storage from '../www/nodejs/modules/storage/storage.js'
import config from '../www/nodejs/modules/config/config.js'
import smartRecommendations from '../www/nodejs/modules/smart-recommendations/index.mjs'
import { Tags } from '../www/nodejs/modules/smart-recommendations/tags.mjs'

// --- Test scaffolding -----------------------------------------------------

// In-memory storage stub
const storageMap = new Map()
storage.get = async (key) => storageMap.get(key)
storage.set = async (key, value) => {
  storageMap.set(key, value)
  return true
}
storage.delete = async (key) => {
  storageMap.delete(key)
  return true
}

// Config stub (simple in-memory map)
const configData = Object.create(null)
config.get = (key, defaultValue = null) => {
  if (Object.prototype.hasOwnProperty.call(configData, key)) {
    return configData[key]
  }
  return defaultValue
}
config.set = (key, value) => {
  configData[key] = value
  return true
}
config.on = () => {}

// Minimal global.channels stub used by Tags constructor
const noop = () => {}
const dummyEmitter = new EventEmitter()
dummyEmitter.on = noop

global.channels = {
  history: { epg: { data: [], on: noop } },
  trending: {
    currentRawEntries: [],
    on: noop,
    getRawEntries: async () => []
  },
  search: {
    searchSuggestionEntries: async () => []
  },
  on: noop,
  channelList: { channelsIndex: {} },
  entryTerms: () => [],
  getChannelCategory: () => null
}

global.osd = { show: noop, hide: noop }

global.version = 'test'

// Stub AI client that always returns additional tags
const aiClientStub = {
  initialized: true,
  enabled: true,
  calls: 0,
  async expandTags () {
    this.calls += 1
    return {
      success: true,
      expandedTags: {
        terror: 1,
        suspense: 0.95,
        horror: 0.85
      }
    }
  }
}

smartRecommendations.aiClient = aiClientStub
smartRecommendations.isReady = () => true
smartRecommendations.expandUserTags = async () => ({})

// --- Test -----------------------------------------------------------------

const tags = new Tags()
tags.backgroundQueue = { add: async () => {} }
tags.expandedTagsCache.clear()

const input = { terror: 1 }
const expanded = await tags.expand({ ...input })

assert.ok(expanded.suspense, 'expanded tags should include new entries')
assert.ok(expanded.horror, 'expanded tags should include multiple entries')
assert.equal(expanded.suspense, 0.95 / 2, 'new tags are merged with halved weight')
assert.equal(aiClientStub.calls, 1, 'AI client called once on cache miss')

const cacheKey = tags.generateCacheKey({ terror: 1 }, {})
const cachedExpansion = tags.getExpandedTagsFromCache(cacheKey)
assert.ok(cachedExpansion, 'expanded tags should be cached')
assert.ok(Object.keys(cachedExpansion).includes('suspense'), 'cache stores AI expanded tags')

const second = await tags.expand({ terror: 1 })
assert.equal(second.suspense, expanded.suspense, 'cached expansion reused on subsequent calls')
assert.equal(aiClientStub.calls, 1, 'AI client not called again when cache hit occurs')

console.log(second)

console.log('✓ tags.expand immediate AI expansion behaves as expected')
process.exit(0)

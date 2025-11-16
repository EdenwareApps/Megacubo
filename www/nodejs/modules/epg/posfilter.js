import mega from '../mega/mega.js'

const inflightByPath = new Map()

const hasMetaStreamClass = entry => {
    if (!entry || typeof entry !== 'object') {
        return false
    }
    const cls = entry.class
    if (typeof cls === 'string') {
        return cls.includes('entry-meta-stream')
    }
    if (Array.isArray(cls)) {
        return cls.some(c => typeof c === 'string' && c.includes('entry-meta-stream'))
    }
    return false
}

const isMetaChannelEntry = entry => {
    if (!entry || typeof entry !== 'object') {
        return false
    }
    if (hasMetaStreamClass(entry)) {
        return true
    }
    if (typeof entry.url === 'string' && mega.isMega(entry.url)) {
        return true
    }
    return false
}

export default async function channelEpgPosFilter(entries, path) {
    if (!Array.isArray(entries) || !entries.length) {
        return entries || []
    }

    const channelsApi = global?.channels
    if (!channelsApi || typeof channelsApi.epgChannelsAddLiveNow !== 'function') {
        return entries
    }

    const metaEntries = entries.filter(isMetaChannelEntry)
    if (!metaEntries.length) {
        return entries
    }

    const key = typeof path === 'string' ? path : ''
    if (inflightByPath.has(key)) {
        try {
            await inflightByPath.get(key)
        } catch (err) {
            console.error('Menu pos filter (EPG) pending task failed:', err)
        }
        return entries
    }

    const task = (async () => {
        try {
            await channelsApi.epgChannelsAddLiveNow(metaEntries)
        } catch (err) {
            console.error('Menu pos filter (EPG) failed:', err)
        }
    })()

    inflightByPath.set(key, task)
    try {
        await task
    } finally {
        inflightByPath.delete(key)
    }

    try {
        channelsApi.trending.updateTopProgramme(entries)
    } catch (err) {
        console.error('Menu pos filter (EPG) trending update failed:', err)
    }

    return entries
}

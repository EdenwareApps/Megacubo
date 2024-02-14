const pLimit = require('p-limit'), EntriesGroup = require('../entries-group')

class Watching extends EntriesGroup {
    constructor() {
        super('watching')
        this.timer = 0
        this.currentEntries = null
        this.currentRawEntries = null
        this.updateIntervalSecs = global.cloud.expires['watching-country'] || 300
        global.config.on('change', (keys, data) => {
            if (keys.includes('only-known-channels-in-been-watched') || keys.includes('parental-control') || keys.includes('parental-control-terms')) {
                this.update().catch(console.error)
            }
        })
        global.storage.get('watching-current').then(data => {
            global.channels.ready(() => {
                if (!this.currentRawEntries || !this.currentRawEntries.length) {
                    this.currentRawEntries = data
                    this.update(data).catch(console.error)
                } else if (Array.isArray(data)) {
                    this.currentEntries && this.currentEntries.forEach((c, i) => {
                        data.forEach(e => {
                            if (typeof (c.trend) == 'undefined' && typeof (e.trend) != 'undefined') {
                                this.currentEntries[i].trend = e.trend
                                return true
                            }
                        })
                    })
                }
                global.channels.on('loaded', () => this.update().catch(console.error)) // on each "loaded"
            })
        }).catch(err => {
            console.error(err)
        })
    }
    title() {
        return global.lang.TRENDING
    }
    ready() {
        return new Promise((resolve, reject) => {
            if (this.currentRawEntries !== null) {
                resolve()
            } else {
                this.once('update', resolve)
                if (!this.updating) this.update().catch(reject)
            }
        })
    }
    showChannelOnHome() {
        return global.lists.manager.get().length || global.config.get('communitary-mode-lists-amount')
    }
    async update(rawEntries = null) {
        this.updating = true
        clearTimeout(this.timer)
        let prv = this.entry()
        await this.process(rawEntries).catch(err => {
            if (!this.currentRawEntries) {
                this.currentEntries = []
                this.currentRawEntries = []
            }
        })
        this.updating = false
        this.emit('update')
        clearTimeout(this.timer) // clear again to be sure
        this.timer = setTimeout(() => this.update().catch(console.error), this.updateIntervalSecs * 1000)
        let nxt = this.entry()
        if (this.showChannelOnHome() && global.explorer.path == '' && (prv.details != nxt.details || prv.name != nxt.name)) {
            global.explorer.updateHomeFilters()
        } else {
            this.updateView()
        }
    }
    updateView() {
        if (global.explorer.path == this.title()) {
            global.explorer.refresh()
        }
    }
    async hook(entries, path) {
        if (path == '') {
            let pos = 0, entry = this.entry()
            if (!entry.originalName) {
                entries.some((e, i) => {
                    if (e.name == global.lang.TOOLS) {
                        pos = i + 1
                        return true
                    }
                })
            }
            entries = entries.filter(e => e.hookId != this.key)
            entries.splice(pos, 0, entry)
        }
        return entries
    }
    extractUsersCount(e) {
        if (e.users) {
            return e.users
        }
        let n = String(e.label || e.details).match(new RegExp('([0-9]+)($|[^&])'))
        return n && n.length ? parseInt(n[1]) : 0
    }
    async entries() {
        if (!global.lists.loaded()) {
            return [global.lists.manager.updatingListsEntry()]
        }
        await this.ready()
        let list = this.currentEntries ? global.deepClone(this.currentEntries, true) : []
        list = list.map((e, i) => {
            e.position = (i + 1)
            return e
        })
        if (!list.length) {
            list = [{ name: global.lang.EMPTY, fa: 'fas fa-info-circle', type: 'action', class: 'entry-empty' }]
        } else {
            const acpolicy = global.config.get('parental-control')
            if (['remove', 'block'].includes(acpolicy)) {
                list = global.lists.parentalControl.filter(list)
            } else if (acpolicy == 'only') {
                list = global.lists.parentalControl.only(list)
            }
        }
        this.currentTopProgrammeEntry = false
        list = this.prepare(list)
        const es = await global.channels.epgChannelsAddLiveNow(list, false)
        if (es.length) {
            es.some(e => {
                if (e.programme && e.programme.i) {
                    this.currentTopProgrammeEntry = e
                    return true
                }
            })
        }
        if(!global.lists.loaded(true)) {
            es.unshift(global.lists.manager.noListsEntry())
        }
        return es
    }
    applyUsersPercentages(entries) {
        let totalUsersCount = 0
        entries.forEach(e => totalUsersCount += e.users)
        let pp = totalUsersCount / 100
        entries.forEach((e, i) => {
            entries[i].usersPercentage = e.users / pp
        })
        return entries
    }
    async getRawEntries() {
        let data = []
        const countries = await global.lang.getActiveCountries()
        const validator = a => Array.isArray(a) && a.length
        const limit = pLimit(3)
        const tasks = countries.map(country => {
            return async () => {
                let es = await global.cloud.get('watching-country.' + country, false, validator).catch(console.error)
                Array.isArray(es) && data.push(...es)
            }
        }).map(limit)
        await Promise.allSettled(tasks)
        data.forEach((e, i) => {
            if (e.logo && !e.icon) {
                data[i].icon = e.logo
                delete data[i].logo
            }
        })
        return data
    }
    async process(rawEntries) {
        let data = Array.isArray(rawEntries) ? rawEntries : (await this.getRawEntries())
        let recoverNameFromMegaURL = true
        if (!Array.isArray(data) || !data.length) return []
        data = global.lists.prepareEntries(data)
        data = data.filter(e => (e && typeof (e) == 'object' && typeof (e.name) == 'string')).map(e => {
            const isMega = global.mega.isMega(e.url)
            if (isMega && recoverNameFromMegaURL) {
                let n = global.mega.parse(e.url)
                if (n && n.name) {
                    e.name = global.ucWords(n.name)
                }
            }
            e.name = global.lists.sanitizeName(e.name)
            e.users = this.extractUsersCount(e)
            e.details = ''
            if (!isMega) {
                e.url = global.mega.build(e.name)
            }
            return e
        })
        data = global.lists.parentalControl.filter(data)
        this.currentRawEntries = data.slice(0)
        const adultContentOnly = global.config.get('parental-control') == 'only', onlyKnownChannels = !adultContentOnly && global.config.get('only-known-channels-in-been-watched')
        let groups = {}, gcount = {}, gentries = []
        let sentries = await global.search.searchSuggestionEntries()
        let gsearches = [], searchTerms = sentries.map(s => s.search_term).filter(s => s.length >= 3).filter(s => !global.channels.isChannel(s)).filter(s => global.lists.parentalControl.allow(s)).map(s => global.lists.terms(s))
        data.forEach((entry, i) => {
            let ch = global.channels.isChannel(entry.terms.name)
            if (!ch) {
                searchTerms.some(terms => {
                    if (global.lists.match(terms, entry.terms.name)) {
                        const name = terms.join(' ')
                        gsearches.includes(name) || gsearches.push(name)
                        ch = { name }
                        return true
                    }
                })
            }
            if (ch) {
                let term = ch.name
                if (typeof (groups[term]) == 'undefined') {
                    groups[term] = []
                    gcount[term] = 0
                }
                if (typeof (entry.users) != 'undefined') {
                    entry.users = this.extractUsersCount(entry)
                }
                gcount[term] += entry.users
                delete data[i]
            } else {
                if (onlyKnownChannels) {
                    delete data[i]
                } else {
                    if (!global.mega.isMega(entry.url)) {
                        const mediaType = global.lists.mi.mediaType(entry)
                        entry.url = global.mega.build(entry.name, { mediaType })
                    }
                    data[i] = global.channels.toMetaEntry(entry)
                }
            }
        })
        Object.keys(groups).forEach(n => {
            const name = global.ucWords(n)
            gentries.push(global.channels.toMetaEntry({
                name,
                type: 'group',
                fa: 'fas fa-play-circle',
                users: gcount[n],
                url: global.mega.build(name, { terms: n.split(' '), mediaType: gsearches.includes(n) ? 'all' : 'live' })
            }))
        })
        data = data.filter(e => {
            return !!e
        })
        data.push(...gentries)
        data = data.sortByProp('users', true)
        data = this.addTrendAttr(data)
        data = this.applyUsersPercentages(data)
        this.currentEntries = data
        global.storage.set('watching-current', this.currentRawEntries, {
            permanent: true,
            expiration: true
        }).catch(console.error) // do not await
        global.updateUserTasks().catch(console.error) // do not await
        return data
    }
    addTrendAttr(entries) {
        if (this.currentEntries) {
            const k = entries.some(e => e.usersPercentage) ? 'usersPercentage' : 'users'
            entries.map(e => {
                this.currentEntries.some(c => {
                    if (c.url == e.url) {
                        if (e[k] > c[k]) {
                            e.trend = 1
                        } else if (e[k] < c[k]) {
                            e.trend = -1
                        } else if (typeof (c.trend) == 'number') {
                            e.trend = c.trend
                        }
                        return true
                    }
                })
                return e
            })
        }
        return entries
    }
    async order(entries) {
        if (this.currentRawEntries) {
            let up = [], es = entries.slice(0)
            this.currentRawEntries.forEach(r => {
                es.some((e, i) => {
                    if (r.url == e.url) {
                        e.users = r.users
                        up.push(e)
                        delete es[i]
                        return true
                    }
                })
            })
            up.push(...es.filter(e => { return !!e }))
            return up
        }
        return entries
    }
    entry() {
        const entry = { name: this.title(), details: global.lang.BEEN_WATCHED, fa: 'fas fa-chart-bar', hookId: this.key, type: 'group', renderer: this.entries.bind(this) }
        if (this.currentEntries && this.showChannelOnHome()) {
            let top = this.currentTopProgrammeEntry
            if (top) {
                let s = top.users == 1 ? 'user' : 'users'
                entry.name = this.title()
                entry.class = 'entry-icon'
                entry.originalName = top.name
                if (entry.rawname) entry.rawname = top.name
                entry.prepend = '<i class="fas fa-chart-bar"></i> '
                entry.details = top.programme.t + ' &middot; <i class="fas fa-' + s + '"></i> ' + global.lang.X_WATCHING.format(top.users)
                entry.programme = top.programme
            }
        }
        return entry
    }
}

module.exports = Watching

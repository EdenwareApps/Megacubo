
const Events = require('events'), Limiter = require('../limiter')
const IPTVOrgProvider = require('./providers/iptv-org')

class PublicIPTVListsDiscovery extends Events {
    constructor(opts = {}) {
        super()
        this.factor = 0.1
        this.key = 'public-iptv-lists-discovery'
        this.opts = Object.assign({
            countries: ['us', 'br'],
            limit: 256
        }, opts)
        this.providers = []
        this.privateProperties = ['perceivedHealth', 'perceivedHealthTestCount'] // value between 0 and 1, like heath, but for user personal experience which smoothly increases health (between 0 and 1 too)
        this.knownLists = []
        this.allowedAtts = ['url', 'name', 'image', 'length', 'health', 'perceivedHealth', 'lastModified'] 
        this.on('registered', () => {
            process.nextTick(() => { // delay a bit to wait for any other registering
                if(this.providers.length > 1 && this.providers.every(p => p.ready)){
                    this.isReady = true
                    this.emit('ready')
                    this.save().catch(console.error)
                } else {
                    this.isReady = false
                }
            })
        })
        this.on('found', () => this.save().catch(console.error))
        this.saver = new Limiter(() => {
            global.storage.set(this.key, this.knownLists, true)
        }, 10000)
        this.restore().catch(console.error)
        const iptv = new IPTVOrgProvider()
        this.register(iptv.discovery.bind(iptv), 24 * 3600)
        global.ui.on('download-p2p-discovery-lists', lists => this.add(lists))
    }
    async restore(){
        const data = await global.storage.promises.get(this.key).catch(console.error)
        Array.isArray(data) && this.add(data)
    }
    async save(){
        this.saver.call()
    }
    register(provider){
        provider.ready = false
        this.providers.push(provider)
        provider().then(this.add.bind(this)).catch(console.error).finally(() => {
            provider.ready = true
            this.emit('registered')
        })
    }
    ready(){
        return new Promise(resolve => {
            if(this.isReady){
                return resolve()
            }
            this.once('ready', resolve)
        })
    }
    async get(amount=8) {
        await this.ready()
        const filteredLists = this.knownLists
            // .filter(list => this.opts.countries.includes(list.country))
            .sort((a, b) => {
                if (a.health === -1) return 1
                if (b.health === -1) return -1
                return b.health - a.health
            })
            .slice(0, amount)

        return filteredLists
    }
    details(url) {
        return this.knownLists.find(l => l.url === url)
    }
    add(lists) {
        const now = new Date().getTime() / 1000
        const aYear = 365 * (30 * 24) // aprox
        const oneYearAgo = now - aYear, newOnes = []
        lists.forEach(list => {
            const existingListIndex = this.knownLists.findIndex(l => l.url === list.url)
            if (existingListIndex === -1) {

                this.knownLists.push(Object.assign({
                    health: -1,
                    perceivedHealth: 0,
                    perceivedHealthTestCount: 0
                }, {
                    ...this.cleanAtts(list),
                    lastModified: Math.max(oneYearAgo, list.lastModified || 0)
                }))
                newOnes.push(list.url)
            } else {
                const existingList = this.knownLists[existingListIndex]
                const lastModified = new Date(list.lastModified)
                if (lastModified > existingList.lastModified) {
                    this.assimilate(existingListIndex, this.cleanAtts(list))
                }
            }
        })
        if (newOnes.length) {
            this.cleanupKnownLists()
            this.emit('found', newOnes)
        }
    }
    cleanAtts(list){
        Object.keys(list).forEach(k => {
            if(!this.allowedAtts.includes(k)){
                delete list[k]
            }
        })
        return list
    }
    assimilate(existingListIndex, list){
        const existingList = this.knownLists[existingListIndex]
        const health = this.averageHealth({ health: existingList.health, perceivedHealth: list.health}) // average health from both
        this.knownLists[existingListIndex] = {
            ...list,
            health,
            name: existingList.name || list.name, // trusting more on own info
            image: existingList.image || list.image,
            countries: existingList.countries.concat(list.countries.filter(c => !existingList.countries.includes(c))),
            perceivedHealth: existingList.perceivedHealth, // perceived health is personal, should not be merged
            perceivedHealthTestCount: existingList.perceivedHealthTestCount,
            lastModified: list.lastModified
        }
    }
    reportHealth(sourceListUrl, success) {
        return this.knownLists.some((list, i) => {
            if(list.url === sourceListUrl) {
                const value = success ? 1 : 0
                if(typeof(list.perceivedHealthTestCount) != 'number'){
                    list.perceivedHealthTestCount = 0
                }
                if(list.perceivedHealthTestCount < (1 / this.factor)){
                    list.perceivedHealthTestCount++
                }
                if(typeof(list.perceivedHealth) == 'number' && list.perceivedHealthTestCount > 1){
                    this.knownLists[i].perceivedHealth = ((list.perceivedHealth * (list.perceivedHealthTestCount - 1)) + value) / list.perceivedHealthTestCount
                } else {
                    this.knownLists[i].perceivedHealth = value
                }
                this.save().catch(console.error)
                return true
            }
        })
    }
    averageHealth(list) {
        let health = 0, values = [list.health, list.perceivedHealth].filter(n => {
            return typeof(n) == 'number' && n >= 0 && n <= 1
        })
        if(values.length) {
            values.forEach(v => health += v)
            health /= values.length
        }
        return health
    }
    validateField(type, value){
        switch(type){
            /*
            { 
                url, 
                name, 
                image, 
                length, 
                health, 
                perceivedHealth, 
                lastModified, 
                !country, 
                !counts: {
                    hls: 0, 
                    video: 0,
                    mpegts: 0,
                    domains: {
                        'example.com': 2,
                        'teste.tv': 1
                    }
                }
            }
            */
            case 'name':fc
                return typeof(value) == 'string' && value.length
            case 'length':
                return typeof(value) == 'number' && value >= 0
            case 'image':
            case 'url':
                return global.validateURL(value)
            case 'lastModified':
                return this.validateTimestamp(value)
            default:
                return true               
        }
    }
    validateTimestamp(timestampSecs){
        if (typeof(seconds) != 'number' || seconds < 0) {
            return false
        }          
        const timestamp = seconds * 1000
        if (isNaN(timestamp)) {
            return false
        }          
        const date = new Date(timestamp)
        if (date.toUTCString() === 'Invalid Date' || date.getFullYear() < 2000) {
            return false
        }          
        return true
    }
    learn(list, isTrusted){
        let ks
        if(list.index && list.index.meta && (ks = Object.keys(list.index.meta))){
            const i = this.knownLists.findIndex(l => l.url == list.url)
            if(i !== -1){
                let learned
                ks.forEach(k => {
                    if(this.validateField(k, list.index.meta[k]) && list.index.meta[k] != this.knownLists[i][k]){
                        this.knownLists[i][k] = list.index.meta[k]
                        learned = true
                    }
                })
                if(this.knownLists[i].length != list.index.length){
                    this.knownLists[i].length = list.index.length
                    learned = true
                }
                if(learned) {
                    this.save().catch(console.error)
                    return true
                }
            }
        }
    }
    sort() {
        this.knownLists = this.knownLists.map(a => {
            a.averageHealth = this.averageHealth(a)
            return a
        })
        this.knownLists.sort((a, b) => b.averageHealth - a.averageHealth)
        return health
    }
    cleanupKnownLists() {
        if (this.knownLists.length > this.opts.limit) {
            this.sort()
            this.knownLists.splice(this.opts.limit)
        }
    }
}

module.exports = PublicIPTVListsDiscovery

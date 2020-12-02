const Events = require('events')

class Trackers extends Events {
    constructor(){
        super()
        this.trackers = []
        this.updateInterval = 24 * 3600
        this.trackersListKey = 'trackers-list'
        this.trackersListLastUpdateKey = 'trackers-list-updated-at'
        this.trackersListUrl = global.config.get('trackers-list-url')
        global.storage.get(this.trackersListKey, trackers => {
            if(Array.isArray(trackers) && trackers.length > this.trackers.length && !this.compare(this.trackers, trackers)){
                this.trackers = trackers
                this.emit('trackers', this.trackers)
                global.storage.get(this.trackersListLastUpdateKey, updatedAt => {
                    let now = this.time()
                    if(!updatedAt || updatedAt < (now - this.updateInterval)){
                        this.update()
                    }
                })
            } else {
                this.update()
            }
        })
    }
    time(){
        return ((new Date()).getTime() / 1000)
    }
    update(){
        if(this.trackersListUrl){
            global.Download.promise({
                url: this.trackersListUrl,
                responseType: 'text',
                timeout: 60000,
                retry: 2
            }).then(body => {
                if(!body){
                    console.error('Server returned empty')
                } else {
                    let trackers = body.split("\n").filter(s => s.indexOf('://') != -1).map(s => s.trim())
                    if(Array.isArray(trackers) && trackers.length >= 5 && !this.compare(this.trackers, trackers)){
                        let now = this.time()
                        this.trackers = trackers
                        global.storage.set(this.trackersListKey, this.trackers, true)
                        global.storage.set(this.trackersListLastUpdateKey, now, true)
                        this.emit('trackers', this.trackers)
                    } else {
                        console.error('Invalid trackers list', body)
                    }
                }
            }).catch(console.error)
        }
    }
    compare(a1, a2) {
        if (a1.length != a2.length) {
            return false
        }      
        a1 = a1.slice()
        a1.sort()
        a2 = a2.slice()
        a2.sort()      
        for (var i = 0; i < a1.length; i++) {
            if (a1[i] != a2[i]) {
                return false
            }
        }      
        return true
    }
    parse(query){
        if(Array.isArray(trs)){
            return trs
        }
        var trs = []
        if(query.indexOf('?') != -1){
            query = query.split('?')[1]
        }
        query.split('&').forEach(q => {
            q = q.split('=')
            if(q.length == 2 && q[0].toLowerCase() == 'tr' && trs.indexOf(q[1]) == -1){
                trs.push(q[1])
            }
        })
        return trs.map(decodeURIComponent)
    }
    name(url){
        var match = url.match(new RegExp('dn=([^&]+)'));
        if(match){
            return urldecode(match[1])
        }
        return 'Unknown'
    }
    hash(uri){
        var m = uri.match(new RegExp('btih:([A-Za-z0-9]{40})'))
        if(m.length){
            return m[1]
        }
        var m = uri.match(new RegExp('([A-Za-z0-9]{40})'))
        if(m.length){
            return m[1]
        }
        return ''
    }
    compile(trs){
        if(!Array.isArray(trs)){
            return trs
        }
        return trs.getUnique().map(tr => { return 'tr=' + encodeURIComponent(tr)}).join('&')
    }
    has(uri, tr){
        return uri.indexOf('tr=' + encodeURIComponent(tr)) != -1
    }
    add(uri, trs){
        if(!Array.isArray(trs)){
            trs = this.parse(trs)
        }
        trs.forEach(tr => {
            if(!this.has(uri, tr)){
                if(uri.indexOf('?') == -1){
                    uri += '?'
                } else {
                    uri += '&'
                }
                uri += 'tr='+tr
            }
        })
        return uri.replace('&&', '&')       
    }
    fill(url, limit){
        let trs = this.parse(url)
        if(trs.length < limit){
            let atrs = this.trackers.filter(tr => {
                return !this.has(url, tr)
            }).slice(0, limit - trs.length)
            url = this.add(url, atrs)
        }
        return url
    }
    remove(uri, trs){
        uri = uri.split('?')
        if(uri.length > 1){
            if(!Array.isArray(trs)){
                trs = this.parse(trs)
            }
            uri[1] = uri[1].split('&').filter(tr => {
                tr = tr.split('=')
                if(tr.length > 1){
                    if(trs.indexOf(tr[1]) != -1){
                        return false
                    }
                }
                return true
            }).join('&')
        }
        return uri.join('?')
    }
}

module.exports = Trackers

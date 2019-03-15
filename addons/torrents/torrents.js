
var torrentsSearchEngines = {}

function torrentsSearch(terms, callback) {
    var already = [], cheerio = require('cheerio')
    if(!jQuery.isArray(torrentsSearchEngines)){
        torrentsSearchEngines = [];
        let dir = path.resolve('addons/torrents/search_engines')
        fs.readdir(path.resolve(dir), (err, files) => {
            files.forEach((file) => {
                let f = require(dir + '/' + file), n = file.replace('.js', '').replace(new RegExp('[^A-Za-z0-9]+'), '')
                if(typeof(f) == 'function'){
                    torrentsSearchEngines[n] = f;
                }
            })
            torrentsSearch(terms, callback)
        })
    } else {
        let complete = 0;
        Object.keys(torrentsSearchEngines).forEach((n) => {
            torrentsSearchEngines[n](terms, (err, entries) => {
                complete++;
                console.warn(n, err, entries)
                entries = entries.filter((entry) => {
                    var hash = getMagnetHash(entry.url)
                    if(already.indexOf(hash) != -1){
                        return false
                    }
                    already.push(hash)
                    return true
                })
                callback(err, entries, complete == torrentsSearchEngines.length)
            }, {path, cheerio, request})
        })
    }
}

function torrentLabel(uri){
    var p = torrentPercentage(uri)
    return p >= 0 ? Lang.RECEIVING+': '+parseInt(p) + '%' : Lang.RECEIVED
}

var torrentPercentages = null;
function torrentPercentage(uri, percent){
    if(torrentPercentages === null){
        torrentPercentages = Store.get('torrent-status') || {}
    }
    var hash = getMagnetHash(uri)
    if(typeof(percent) == 'number'){
        torrentPercentages[hash] = percent
        Store.set('torrent-status', torrentPercentages)
    }

    return typeof(torrentPercentages[hash])=='undefined' ? -1 : torrentPercentages[hash]
}

function updateTorrentsListingState(uri, p){
    if(Menu.path == torrentsEntryName){
        Menu.getEntries(false, true, true).each((i, e) => {
            e = jQuery(e)
            let data = e.data('entry-data')
            if(data.url && data.url == uri){
                let t = e.text().trim(), nt
                p = p > 99 ? '['+Lang.COMPLETE+']' : '['+parseInt(p)+'%]'
                nt = p + ' ' + t.replace(new RegExp('^\\[[^\\]]+\\]', 'i'), '')
                e.find('.entry-name').text(nt)
                console.warn('TORR', t, nt, p)
            }
        })
    }
}

var localTorrentsEntries = false
function torrentsAddLocal(entries, cb){
    let lcb = (localTorrentsEntries) => {
        if(jQuery.isArray(localTorrentsEntries)){
            entries = entries.concat(localTorrentsEntries)
        }
        cb(entries)
    }
    if(localTorrentsEntries){
        lcb(localTorrentsEntries)
    } else {
        localTorrentsEntries = []
        var folder = torrentsFolder + path.sep + 'torrent-stream';
        fs.readdir(folder, (err, files) => {
            if(err){
                mkdirp(folder)
                lcb(false)
                throw err;
            } else {
                async.forEach(files, (file, callback) => {
                    var subFolder = folder + path.sep + file;
                    console.warn('RIGHTT', subFolder)
                    if(isDir(subFolder)){
                        console.log(subFolder)
                        fs.readdir(subFolder, (err, files) => {
                            if(files && files.length){
                                let uri = 'magnet:?xt=urn:btih:'+file+'&dn='+encodeURIComponent(files[0]),  p = torrentPercentage(uri)
                                localTorrentsEntries.push({
                                    prepend: p >= 0 ? '['+ (p > 99 ? Lang.COMPLETE : parseInt(p)+'%') +']' : '',
                                    name: files[0],
                                    type: 'stream',
                                    logo: 'fa-magnet',
                                    url: uri
                                })
                            }
                            callback()
                        })
                    } else {
                        let e = getExt(file)
                        if(e && e.length < 5 && ['torrent', 'json'].indexOf(e) == -1){
                            getLocalJSON(file.replace('.torrent', '.json'), (err, _trackers) => {
                                let uri = 'magnet:?xt=urn:btih:'+file+'&dn='+encodeURIComponent(name), p = torrentPercentage(uri)
                                if(jQuery.isArray(_trackers)){
                                    uri = Trackers.add(uri, _trackers)
                                }
                                localTorrentsEntries.push({
                                    prepend: p >= 0 ? '['+ (p > 99 ? Lang.COMPLETE : parseInt(p)+'%') +']' : '',
                                    name: file.replace('.' + e.toUpperCase(), '').replace('.' + e, ''),
                                    type: 'stream',
                                    logo: 'fa-magnet',
                                    url: uri
                                })
                            })
                        }
                        callback()
                    }
                }, () => {
                    console.warn('RIGHTT', localTorrentsEntries)
                    lcb(localTorrentsEntries)
                })
            }
        })
    }
}

var torrentOption = registerMediaType({
    'type': 'magnet',
    'name': torrentsEntryName,
    'icon': 'fa-magnet',
    'testable': false,
    'recordable': false,
    'categories': false,
    'categories_cb': (entries, cb) => {
        console.warn('RIGHTT', entries)
        torrentsAddLocal(entries, cb)
    },
    'search': (terms, cb) => {
        torrentsSearch(terms + ' mp4 aac', (err, results) => {
            if(err){
                console.error(err)
            }
            cb(results)
        })
    },
    'check': (url) => {
        if(typeof(url)!='string') return false;
        return url.substr(0, 7) == 'magnet:';            
    },
    'save': () => {
        if(Playback.active && Playback.active.peerflix && Playback.active.peerflix.torrent) {
            folder = torrentsFolder + path.sep + 'torrent-stream' + path.sep + Playback.active.peerflix.torrent.infoHash + path.sep + Playback.active.peerflix.torrent.name;
            nw.Shell.shomInFolder(absolutize(folder))
        }
    }
}, false)

addFilter('toolsEntries', entries => {
    entries.unshift(torrentOption)
    return entries
})

registerDialingAction('magnet-search', 'fa-magnet', (terms) => {
    goSearch(terms.toLowerCase(), 'magnet')
})
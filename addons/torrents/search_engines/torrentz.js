/*
Name: TorrentZ
*/
module.exports = (terms, callback, modules) => {
    var torrentz = require(modules.path.resolve('addons/torrents/node_modules/node-torrentz'))
    if(torrentz){	
        torrentz.search(terms, (results) => {
            var score, entries = [];
            for(var i in results.torrents) {
                score = results.torrents[i].seeds + results.torrents[i].peers;
                entries.push({
                    url: 'magnet:?xt=urn:btih:'+results.torrents[i].hash+'&dn='+encodeURIComponent(results.torrents[i].title)+'&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80&tr=udp%3A%2F%2Fopentor.org%3A2710&tr=udp%3A%2F%2Ftracker.ccc.de%3A80&tr=udp%3A%2F%2Ftracker.blackunicorn.xyz%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969',
                    name: results.torrents[i].title || 'Untitled',
                    label: 'TorrentZ, '+results.torrents[i].categories.filter((c) => { return c.length > 1 }).join(', '),
                    score: score
                })
            }
            callback(null, entries)
        })
    } else {
        callback('Module unavailable.', [])
    }
}
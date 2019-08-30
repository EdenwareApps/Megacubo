// to enable this option, go to Options > Security and uncheck the "Hide adult content" option.

var formatXXXURL = (url) => {
    if(url.indexOf('//') == -1){
        url = 'https://pt.pornhub.com/embed/'+url.split('=')[1]
    }
    return url
}

function fetchXXXSearchResults(q, cb){
    var callback = (videos) => {
        console.log('PN', videos)
        if(adultContentPolicy == 'allow'){
            search(entries => {
                if(Array.isArray(videos)){
                    for(var i=0; i<videos.length; i++){
                        //console.log(search_results.entries[i])
                        entries.push({
                            type: 'stream',
                            url: formatXXXURL(videos[i].url),
                            name: videos[i].title + ' | XXX',
                            logo: videos[i].thumb,
                            label: videos[i].duration
                        })
                    }
                }
                cb(entries)
            }, 'all', q, true, false, entries => {
                return entries.filter(entry => {
                    return entry.isSafe === false
                }).slice(0)
            }, true)
        } else {
            cb([Menu.emptyEntry(Lang.ADULT_CONTENT_BLOCKED, 'fa-user-lock')])
        }
    }
    callback([])
    /*
    var Searcher = new (require('pornsearch'))(q)
    Searcher.videos().then(callback).catch(() => {
        callback([])
    })
    */
}

function getXXXEntries(data, type){
    var entries = sharedGroupsAsEntries('adult', type, (entries) => {
        return entries.filter(entry => {
            return entry.isSafe === false
        }).slice(0)
    })
    return [
        {
            name: Lang.BEEN_WATCHED, 
            logo: 'fa-users', 
            labeler: parseLabelCount, 
            type: 'group',
            class: 'entry-nosub',
            renderer: () => { 
                return [
                    Menu.loadingEntry()
                ]
            },
            callback: (data) => {
                let path = assumePath(data.name, Menu.path)
                getXXXWatchingEntries((entries) => {
                    if(!entries.length){
                        entries = [Menu.emptyEntry()]
                    }
                    Menu.asyncResult(path, entries)
                }) 
            }, 
            entries: []
        },
        {
            name: Lang.SEARCH,
            type: 'group',
            logo: 'fa-search',
            renderer: () => {
                return [
                    Menu.loadingEntry()
                ]
            },
            callback: () => {
                goSearch(null, 'adult-content')
            }
        }
    ].concat(entries)
}

function getXXXWatchingEntries(_cb){
    getWatchingData((_options) => {
        var entries = []
        if(_options.length){
            var options = _options;
            options = options.filter((option) => {
                return !parentalControlAllow(option, true)
            })
            if(options.length && options[0].label.indexOf('ordm')==-1){
                var i = 0
                options = options.map((entry, k) => {
                    if(!entry.__parsed){
                        entry.label = (i + 1)+'&ordm; &middot; '+(entry.mediaType == 'audio' ? Lang.LISTENING : Lang.X_WATCHING).format(parseCounter(entry.label.split(' ')[0]))
                        i++;
                        entry.__parsed = true;
                    }   
                    return entry
                })
            }
            entries = options.slice(0, 96)
        }
        _cb(entries)
    })
}

const adCtName = 'XXX' // Lang.ADULT_CONTENT

addAction('preMenuInit', () => {
    let opt = {name: adCtName, homeId: 'adult-content', isSafe: false, logo: 'fa-fire', label: '', class: 'entry-nosub', type: 'group', renderer: (data) => {
        return getXXXEntries(null, 'all')
    }, entries: []}
    Menu.entries.splice(5, 0, opt)
})

addAction('appReady', () => {
    registerSearchEngine(adCtName, 'adult-content', fetchXXXSearchResults)
})

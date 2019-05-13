// to enable this option, go to Options > Security and uncheck the "Hide adult content" option.

var formatXXXURL = (url) => {
    return 'https://pt.pornhub.com/embed/'+url.split('=')[1];
}

function fetchXXXSearchResults(q, cb){
    var callback = (videos) => {
        console.log('PN', videos)
        fetchSharedListsSearchResults(entries => {
            if(jQuery.isArray(videos)){
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
                return entry.parentalControlSafe === false
            }).slice(0)
        })
    }
    var Searcher = new (require('pornsearch'))(q)
    Searcher.videos().then(callback).catch(() => {
        callback([])
    })
}

function getXXXEntries(data){
    var entries = sharedGroupsAsEntries('adult', 'all', (entries) => {
        return entries.filter(entry => {
            return entry.parentalControlSafe === false
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
                getXXXWatchingEntries((entries) => {
                    if(!entries.length){
                        entries = [Menu.emptyEntry()]
                    }
                    if(basename(Menu.path) == data.name){
                        Menu.loaded(true)
                        Menu.list(entries, Menu.path)
                    }
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
                        entry.label = (i + 1)+'&ordm; &middot; '+(entry.mediaType == 'radio' ? Lang.LISTENING : Lang.X_WATCHING).format(parseCounter(entry.label.split(' ')[0]))
                        i++;
                        entry.__parsed = true;
                    }                      
                    if(!entry.logo){
                        entry.logo = 'http://app.megacubo.net/logos/'+encodeURIComponent(entry.name)+'.png';
                    }
                    return entry;
                })
            }
            entries = options.slice(0, 96)
        }
        _cb(entries)
    })
}

addFilter('toolsEntries', (entries) => {
    entries.push({name: Lang.ADULT_CONTENT, homeId: 'adult-content', parentalControlSafe: false, logo: 'fa-fire', label: '', class: 'entry-nosub', type: 'group', renderer: getXXXEntries, entries: []})
    return entries
})

addAction('appReady', () => {
    registerSearchEngine(Lang.ADULT_CONTENT, 'adult-content', fetchXXXSearchResults)
})

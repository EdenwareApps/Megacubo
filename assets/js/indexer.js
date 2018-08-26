if(typeof(async)=='undefined'){
    async = require('async')
}

var mainWin = (window.opener && window.opener != global) ? window.opener : top;

function buildSharedListsSearchIndex(loadcb){
    var listRetrieveTimeout = 8;
    fetchSharedLists((urls) => {
        if(urls.length){
            var listsCountLimit = Config.get('search-range-size');
            if(typeof(listsCountLimit)!='number' || listsCountLimit >= 0){
                listsCountLimit = 18; // default
            }
            if(urls.length > listsCountLimit){
                urls = urls.slice(0, listsCountLimit)
            }
            var iterator = 0, completeIterator = 0, tasks = Array(urls.length).fill((asyncCallback) => {
                var url = urls[iterator];
                iterator++;
                completeIterator += 0.5;
                ListMan.parse(url, (entries) => {
                    completeIterator += 0.5;
                    asyncCallback();
                    mainWin.addEntriesToSearchIndex(entries, url)
                }, listRetrieveTimeout, true)            
            });
            async.parallelLimit(tasks, 18, (err, results) => {
                loadcb()
            })
        } else {
            mainWin.alert(mainWin.Lang.NO_LIST_PROVIDED.format(mainWin.Lang.SEARCH_RANGE))
        }
    })
}

buildSharedListsSearchIndex(() => {
    mainWin.console.log('Search index ready.');
    mainWin.doAction('search-index-ready');
    window.close()
})



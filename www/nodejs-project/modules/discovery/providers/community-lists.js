const pLimit = require('p-limit')

class CommunityLists {
    constructor() {
        global.uiReady(() => global.explorer.addFilter(this.hook.bind(this)))
    }
    async discovery(adder) {
        if(global.ALLOW_COMMUNITY_LISTS) {
            const timeoutMs = 30000
            const limit = pLimit(2)
            const parseUsersCount = s => parseInt(s.split(' ').shift().replace('.', ''))
            const solved = [], locs = await global.lang.getActiveCountries()
            await Promise.allSettled(locs.map((loc, i) => {
                return async () => {
                    const scoreLimit = 1 - (i * (1 / locs.length))
                    let maxUsersCount = -1, lists = await global.cloud.get('country-sources.'+ loc, false, timeoutMs).catch(console.error)
                    solved.push(loc)
                    lists = lists.map(list => {
                        const usersCount = parseUsersCount(list.label)
                        if(maxUsersCount == -1) {
                            maxUsersCount = usersCount
                        }
                        list.type = 'community'
                        list.health = scoreLimit * (usersCount / maxUsersCount)
                        return list
                    })
                    Array.isArray(lists) && adder(lists)
                }
            }).map(limit))
        }
        return [] // used 'adder'
    }
    showInfo(){
        global.explorer.dialog([
            {template: 'question', text: global.lang.COMMUNITY_LISTS, fa: 'fas fa-users'},
            {template: 'message', text: global.lang.IPTV_INFO +"\r\n"+ global.lang.TOS_CONTENT},
            {template: 'option', text: 'OK', id: 'ok', fa: 'fas fa-check-circle'},
            {template: 'option', text: global.lang.KNOW_MORE, id: 'know', fa: 'fas fa-info-circle'}
        ], 'ok').then(ret => {
            if(ret == 'know'){
                global.ui.emit('open-external-url', 'https://megacubo.net/tos')
            }
        }).catch(console.error)
    }
    async hook(entries, path){
        if(global.ALLOW_COMMUNITY_LISTS && path.split('/').pop() == global.lang.MY_LISTS) {
            entries.splice(2, 0, this.entry())
        }
        return entries
    }
    entry() {
        return {
            name: global.lang.COMMUNITY_LISTS, type: 'group', fa: 'fas fa-users', details: global.lang.LIST_SHARING,
            renderer: async () => {
                let options = [
                    {name: global.lang.ACCEPT_LISTS, type: 'check', details: global.lang.LIST_SHARING, action: (data, checked) => {
                        if(checked){
                            global.ui.emit('dialog', [
                                {template: 'question', text: global.lang.COMMUNITY_LISTS, fa: 'fas fa-users'},
                                {template: 'message', text: global.lang.ASK_COMMUNITY_LIST},
                                {template: 'option', id: 'back', fa: 'fas fa-times-circle', text: global.lang.BACK},
                                {template: 'option', id: 'agree', fa: 'fas fa-check-circle', text: global.lang.I_AGREE}
                            ], 'lists-manager', 'back', true)                
                        } else {
                            global.config.set('communitary-mode-lists-amount', 0)
                            global.explorer.refreshNow() // epg options path
                        }
                    }, checked: () => {
                        return global.config.get('communitary-mode-lists-amount') > 0
                    }}
                ]
                if(global.config.get('communitary-mode-lists-amount') > 0){
                    options.push({name: global.lang.RECEIVED_LISTS, details: global.lang.SHARED_AND_LOADED, fa: 'fas fa-users', type: 'group', renderer: this.receivedListsEntries.bind(this)})
                    options.push({
                        name: global.lang.AMOUNT_OF_LISTS,
                        details: global.lang.AMOUNT_OF_LISTS_HINT,
                        type: 'slider', 
                        fa: 'fas fa-cog', 
                        mask: '{0} ' + global.lang.COMMUNITY_LISTS.toLowerCase(), 
                        value: () => {
                            return global.config.get('communitary-mode-lists-amount')
                        }, 
                        range: {start: 5, end: 72},
                        action: (data, value) => {
                            global.config.set('communitary-mode-lists-amount', value)
                        }
                    })
                    options.push({
                        name: global.lang.LEGAL_NOTICE,
                        fa: 'fas fa-info-circle',
                        type: 'action',
                        action: this.showInfoCommunity.bind(this)
                    })
                }
                return options
            }
        }
    }
}

module.exports = CommunityLists

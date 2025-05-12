import lang from "../../lang/lang.js";
import pLimit from "p-limit";
import cloud from "../../cloud/cloud.js";
import { EventEmitter } from 'node:events';
import { insertEntry, kfmt, listNameFromURL } from "../../utils/utils.js";
import config from "../../config/config.js"
import renderer from '../../bridge/bridge.js'
import menu from '../../menu/menu.js'

class CommunityLists extends EventEmitter {
    constructor(master) {
        super()
        this.master = master
        this.type = 'community'
        this.id = 'community-lists'
        renderer.ready(() => menu.addFilter(this.hook.bind(this)));
    }
    async discovery(adder) {
        if (paths.ALLOW_COMMUNITY_LISTS) {
            const limit = pLimit(2)
            const parseUsersCount = s => parseInt(s.split(' ').shift().replace('.', ''));
            const solved = [], locs = await lang.getActiveCountries();
            await Promise.allSettled(locs.map((loc, i) => {
                return async () => {
                    const scoreLimit = 1 - (i * (1 / locs.length));
                    let maxUsersCount = -1, lists = await cloud.get('sources/' + loc).catch(err => console.error(err));
                    solved.push(loc)
                    if(Array.isArray(lists)) {
                        lists = lists.map(list => {
                            const usersCount = parseUsersCount(list.label);
                            if (maxUsersCount == -1) {
                                maxUsersCount = usersCount;
                            }
                            list.type = 'community';
                            list.health = scoreLimit * (usersCount / maxUsersCount);
                            return list;
                        })
                        adder(lists)
                    }
                }
            }).map(limit))
        }
        return []
    }
    showInfo() {
        menu.dialog([
            { template: 'question', text: lang.COMMUNITY_LISTS, fa: 'fas fa-users' },
            { template: 'message', text: lang.IPTV_INFO + "\r\n" + lang.TOS_CONTENT },
            { template: 'option', text: 'OK', id: 'ok', fa: 'fas fa-check-circle' },
            { template: 'option', text: lang.KNOW_MORE, id: 'know', fa: 'fas fa-info-circle' }
        ], 'ok').then(ret => {
            if (ret == 'know') {
                renderer.ui.emit('open-external-url', 'https://megacubo.net/tos');
            }
        }).catch(err => console.error(err));
    }
    async receivedListsEntries() {
        const info = await this.master.lists.info();
        let entries = Object.keys(info).filter(u => info[u].origin == 'community').sort((a, b) => {
            if ([a, b].some(a => typeof(info[a].score) == 'undefined'))
                return 0
            if (info[a].score == info[b].score)
                return 0
            return info[a].score > info[b].score ? -1 : 1
        }).map(url => {
            let data = this.master.details(url)
            if (!data) {
                console.error('LIST NOT FOUND ' + url)
                return;
            }
            // let health = this.master.averageHealth(data) || -1
            let name = data.name || listNameFromURL(url)
            let author = data.author || undefined
            let icon = data.icon || undefined
            let length = data.length || info[url].length || 0
            let details = []
            author && details.push(author)
            details.push(lang.RELEVANCE + ': ' + parseInt((info[url].score || 0) * 100) + '%')
            details.push('<i class="fas fa-play-circle" aria-label="hidden"></i> ' + kfmt(length, 1))
            details = details.join(' &middot; ')
            return {
                name, url, icon, details,
                fa: 'fas fa-satellite-dish',
                type: 'group',
                class: 'skip-testing',
                renderer: this.master.lists.manager.renderList.bind(this.master.lists.manager)
            };
        }).filter(l => l)
        if (!entries.length) {
            if (!this.master.lists.loaded()) {
                entries = [this.master.lists.manager.updatingListsEntry()];
            } else if(Object.keys(this.master.lists.lists).length) {
                entries = [
                    { name: lang.EMPTY, fa: 'fas fa-info-circle', type: 'action', class: 'entry-empty' }
                ]
            } else {
                entries = [this.master.lists.manager.noListsRetryEntry()];
            }
        }
        return entries;
    }
    async hook(entries, path) {
        if (paths.ALLOW_COMMUNITY_LISTS && path.split('/').pop() == lang.MY_LISTS) {
            insertEntry(this.entry(), entries, [], [lang.ADD_LIST, lang.PUBLIC_LISTS]);
        }
        return entries;
    }
    entry() {
        return {
            name: lang.COMMUNITY_LISTS, type: 'group', fa: 'fas fa-users', details: lang.LIST_SHARING,
            renderer: async () => {
                let options = [
                    { name: lang.ACCEPT_LISTS, type: 'check', details: lang.LIST_SHARING, action: (data, checked) => {
                            if (checked) {
                                renderer.ui.emit('dialog', [
                                    { template: 'question', text: lang.COMMUNITY_LISTS, fa: 'fas fa-users' },
                                    { template: 'message', text: lang.ASK_COMMUNITY_LIST },
                                    { template: 'option', id: 'back', fa: 'fas fa-times-circle', text: lang.BACK },
                                    { template: 'option', id: 'agree', fa: 'fas fa-check-circle', text: lang.I_AGREE }
                                ], 'lists-manager', 'back', true)
                            } else {
                                config.set('communitary-mode-lists-amount', 0)
                                menu.refreshNow(true) // epg options path
                            }
                        }, checked: () => {
                            return config.get('communitary-mode-lists-amount') > 0
                        } }
                ]
                if (config.get('communitary-mode-lists-amount') > 0) {
                    options.push({
                        name: lang.RECEIVED_LISTS,
                        details: lang.SHARED_AND_LOADED,
                        fa: 'fas fa-users',
                        type: 'group',
                        renderer: this.receivedListsEntries.bind(this)
                    })
                    options.push({
                        name: lang.AMOUNT_OF_LISTS,
                        'dialog-details': lang.AMOUNT_OF_LISTS_HINT,
                        type: 'slider',
                        fa: 'fas fa-cog',
                        mask: '{0} ' + lang.COMMUNITY_LISTS.toLowerCase(),
                        value: () => {
                            return config.get('communitary-mode-lists-amount');
                        },
                        range: { start: 5, end: 72 },
                        action: (data, value) => {
                            config.set('communitary-mode-lists-amount', value);
                        }
                    })
                    options.push({
                        name: lang.LEGAL_NOTICE,
                        fa: 'fas fa-info-circle',
                        type: 'action',
                        action: this.showInfo.bind(this)
                    })
                }
                return options
            }
        };
    }
}
export default CommunityLists;

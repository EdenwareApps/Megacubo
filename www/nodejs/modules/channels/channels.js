import History from '../history/history.js'
import Download from '../download/download.js'
import osd from '../osd/osd.js'
import menu from '../menu/menu.js'
import lang from '../lang/lang.js'
import storage from '../storage/storage.js'
import { EventEmitter } from 'node:events'
import mega from '../mega/mega.js'
import Trending from '../trending/trending.js'
import Bookmarks from '../bookmarks/bookmarks.js'
import fs from 'fs'
import downloads from '../downloads/downloads.js'
import icons from '../icon-server/icon-server.js'
import config from '../config/config.js'
import renderer from '../bridge/bridge.js'
import paths from '../paths/paths.js'
import { clone, insertEntry, moment, ts2clock } from '../utils/utils.js'
import Search from '../search/search.js'
import { parse } from '../serialize/serialize.js'
import { ChannelsList } from './channel-list.js'
import ready from '../ready/ready.js'

class ChannelsData extends EventEmitter {
    constructor() {
        super();
        this.emptyEntry = {
            name: lang.EMPTY,
            type: 'action',
            fa: 'fas fa-info-circle',
            class: 'entry-empty'
        }
        this.radioTerms = ['radio', 'fm', 'am']
        this.ready = ready()
        renderer.ready(async () => {
            this.load().catch(err => console.error(err))
            config.on('change', async (keys, data) => {
                if (['parental-control', 'parental-control-terms', 'lists'].some(k => keys.includes(k))) {
                    await this.load(true);
                }
            })
            global.lists.on('list-loaded', () => this.load().catch(err => console.error(err)))
            global.lists.on('satisfied', () => this.load().catch(err => console.error(err)))
        })
    }
    async load(refresh) {
        const hasOwnLists = config.get('lists').length
        const publicMode = config.get('public-lists') && !global.lists.loaded(true) // no list available on index beyound public lists
        const countries = await lang.getActiveCountries()
        const parentalControlActive = ['remove', 'block'].includes(config.get('parental-control'))
        let type = config.get('channel-grid'), typeChanged
        if (!type || (type == 'lists' && !hasOwnLists) || (type == 'xxx' && parentalControlActive)) {
            type = hasOwnLists ? 'lists' : (publicMode ? 'public' : 'app')
        }
        if (!this.channelList ||
            this.channelList.type != type ||
            JSON.stringify(this.channelList.countries) != JSON.stringify(countries)) {
            typeChanged = true
            this.channelList && this.channelList.destroy()
            this.channelList = new ChannelsList(type, countries)
        }
        const changed = await this.channelList.load(refresh)
        this.loaded = true
        this.emit('loaded', changed)
        this.ready.done()
        typeChanged && await this.trending.update().catch(err => console.error(err));
        (typeChanged || changed) && renderer.ready(() => menu.updateHomeFilters())
    }
}
class ChannelsEPG extends ChannelsData {
    constructor() {
        super();
        this.epgStatusTimer = false;
        this.epgIcon = 'fas fa-th';
        this.clockIcon = '<i class="fas fa-clock"></i> ';
        renderer.ready(() => {
            const aboutInsertEPGTitle = async (data) => {
                if (global.streamer.active.mediaType != 'live') {
                    throw 'local file';
                }
                if (!this.isChannel(global.streamer.active.data.originalName || global.streamer.active.data.name)) {
                    throw 'not a channel';
                }
                const ret = await this.epgChannelLiveNowAndNext(global.streamer.active.data);
                let ks = Object.keys(ret);
                return ks.map((k, i) => {
                    if (i == 0) {
                        return { template: 'question', text: ret[k] };
                    } else {
                        return { template: 'message', text: k + ': ' + ret[k] };
                    }
                });
            }
            global.streamer.aboutRegisterEntry('epg', aboutInsertEPGTitle, null, 1)
            global.streamer.aboutRegisterEntry('epg', aboutInsertEPGTitle, null, 1, true)
            global.streamer.aboutRegisterEntry('epg-more', () => {
                if (global.streamer.active.mediaType == 'live') {
                    return { template: 'option', text: lang.EPG, id: 'epg-more', fa: this.epgIcon };
                }
            }, async data => {
                const name = data.originalName || data.name;
                const category = this.getChannelCategory(name)
                if (!global.lists?.epg?.loaded) {
                    menu.displayErr(lang.EPG_DISABLED)
                } else if (category) {
                    let err;
                    await this.epgChannelLiveNow(data).catch(e => {
                        err = e
                        menu.displayErr(lang.CHANNEL_EPG_NOT_FOUND + ' *')
                    });
                    if (!err) {
                        const entries = await this.epgChannelEntries({ name }, null, true)
                        menu.render(entries, lang.EPG, {
                            icon: 'fas fa-plus', 
                            backTo: '/'
                        })
                        renderer.ui.emit('menu-playing')
                    }
                } else {
                    menu.displayErr(lang.CHANNEL_EPG_NOT_FOUND);
                }
            }, null, true)
        });
    }
    clock(data, includeEnd) {
        let t = this.clockIcon + ts2clock(data.start)
        if (includeEnd) {
            t += ' - ' + ts2clock(data.end)
        }
        return t
    }
    epgSearchEntry() {
        return {
            name: lang.NEW_SEARCH,
            type: 'input',
            fa: 'fas fa-search',
            details: lang.EPG,
            action: (e, value) => {
                if (value) {
                    this.epgSearch(value).then(entries => {
                        let path = menu.path.split('/').filter(s => s != lang.SEARCH).join('/');
                        entries.unshift(this.epgSearchEntry())
                        menu.render(entries, path + '/' + lang.SEARCH, {
                            icon: 'fas fa-search', 
                            backTo: path
                        })
                        this.search.history.add(value)
                    }).catch(e => menu.displayErr(e))
                }
            },
            value: () => {
                return ''
            },
            placeholder: lang.SEARCH_PLACEHOLDER
        }
    }
    async epgSearch(terms, liveNow) {
        if (typeof(terms) == 'string') {
            terms = global.lists.tools.terms(terms)
        }
        const entries = []
        const epgData = await global.lists.epgSearch(terms, liveNow)
        Object.keys(epgData).forEach(ch => {
            let terms = global.lists.tools.terms(ch)
            entries.push(...this.epgDataToEntries(epgData[ch], ch, terms))
        })
        return entries.sort((a, b) => {
            return a.programme.start - b.programme.start
        })
    }
    epgDataToEntries(epgData, ch, terms) {
        const now = (Date.now() / 1000)
        const at = p => {
            if (p.start <= now && p.end >= now) {
                return lang.LIVE
            }
            return this.clock(p, true)
        }
        return (Array.isArray(epgData) ? epgData : Object.values(epgData)).filter(p => p.end > now).map(p => {
            const epgIcon = (p.icon && p.icon.includes('//')) ? p.icon : ''
            return {
                name: p.title,
                details: ch + ' | ' + at(p),
                type: 'action',
                fa: 'fas fa-play-circle',
                programme: { 
                    start: p.start, 
                    channel: ch, 
                    icon: epgIcon,
                    age: p.age || 0,
                    parental: p.parental || 'no',
                    rating: p.rating || '',
                    contentType: p.contentType || '',
                    title: p.title
                },
                action: this.epgProgramAction.bind(this, p.start, ch, p, terms, epgIcon)
            }
        })
    }
    epgPrepareSearch(e) {
        let ret = { name: e.originalName || e.name }, map = config.get('epg-map');
        if (map[ret.name]) {
            ret.searchName = map[ret.name];
        }
        ret.terms = this.entryTerms(e, true)
        ret.terms = this.expandTerms(ret.terms)
        return ret;
    }
    async epgChannel(e, limit) {        
        if (typeof(limit) != 'number')
            limit = 72;
        let data = this.epgPrepareSearch(e);
        return global.lists.epgChannelsList(data, limit);
    }
    async epgChannelEntries(e, limit, detached) {
        if (typeof(limit) != 'number') {
            limit = 72
        }
        let data = this.epgPrepareSearch(e)
        const epgData = await global.lists.epgChannelsList(data, limit)
        let centries = []
        if (epgData) {
            if (typeof(epgData[0]) != 'string') {
                centries = this.epgDataToEntries(epgData, data.name, data.terms)
            }
        }
        if (!centries.length) {
            centries.push(menu.emptyEntry(lang.NOT_FOUND))
        }
        centries.unshift(this.adjustEPGChannelEntry(e, detached))
        return centries
    }
    async epgChannelLiveNow(entry) {
        if (!global.lists?.epg?.loaded) throw 'epg not loaded';
        const channel = this.epgPrepareSearch(entry)
        const info = await global.lists.getLiveNowAndNext(channel, { limit: 2 })
        if (!info || !Array.isArray(info.programmes) || !info.programmes.length) {
            throw 'not found 2'
        }
        const nowTs = Date.now() / 1000
        const current = info.programmes.find(p => p && p.start <= nowTs && p.end > nowTs) || info.programmes[0]
        if (current && current.title) {
            return current.title
        }
        throw 'not found 2'
    }
    async epgChannelLiveNowAndNext(entry) {
        let ret = await this.epgChannelLiveNowAndNextInfo(entry);
        Object.keys(ret).forEach(k => ret[k] = ret[k].title);
        return ret;
    }
    async epgChannelLiveNowAndNextInfo(entry) {
        if (!global.lists?.epg?.loaded) throw 'epg not loaded'        
        const channel = this.epgPrepareSearch(entry)
        const info = await global.lists.getLiveNowAndNext(channel, { limit: 2 })
        if (!info || !Array.isArray(info.programmes) || !info.programmes.length) {
            throw 'not found 1'
        }
        const nowTs = Date.now() / 1000
        const current = info.programmes.find(p => p && p.start <= nowTs && p.end > nowTs) || info.programmes[0]
        if (!current || !current.title) {
            throw 'not found 2'
        }
        const ret = { now: current }
        const nextProgramme = info.programmes.find(p => p && p.start > nowTs)
        if (nextProgramme) {
            let start = moment(nextProgramme.start * 1000).fromNow()
            start = start.charAt(0).toUpperCase() + start.slice(1)
            ret[start] = nextProgramme
        } else {
            throw 'not found 3'
        }
        return ret
    }
    async epgChannelsLiveNow(entries) {
        let ret = {}
        if(!entries.length || !global.lists?.epg?.loaded) {
            return ret
        }  
        const chs = entries.map(e => this.epgPrepareSearch(e))
        const epgData = await global.lists.getLiveNowAndNext(chs, { limit: 2 })
        const nowTs = Date.now() / 1000
        for (const ch of chs) {
            const key = ch.name
            const info = epgData ? epgData[key] : null
            if (!info || !Array.isArray(info?.programmes)) {
                ret[key] = false
                continue
            }
            const current = info.programmes.find(p => p && p.start <= nowTs && p.end > nowTs) || info.programmes[0] || null
            ret[key] = current || false
        }
        return ret
    }
    async epgChannelsAddLiveNow(entries) {
        if (!global.lists?.epg?.loaded) return entries
        let err
        const allowedTypes = ['select', 'action']
        const cs = entries.filter(e => e.terms || allowedTypes.includes(e.type)).map(e => this.isChannel(e)).filter(e => e)
        const epg = await this.epgChannelsLiveNow(cs).catch(e => err = e)
        if (!err && epg) {
            entries.forEach((e, i) => {
                const name = e.isChannel ? e.isChannel.name : (e.originalName || e.name)
                if (typeof(epg[name]) != 'undefined' && epg[name].title) {
                    if (entries[i].details) {
                        if (!entries[i].details.includes(epg[name].title)) {
                            entries[i].details += ' &middot; ' + epg[name].title
                        }
                    } else {
                        entries[i].details = epg[name].title
                    }
                    entries[i].programme = epg[name]
                }
            })
        }
        return entries
    }
    adjustEPGChannelEntry(e, detached) {
        return {
            name: lang.SELECT,
            details: lang.CONFIGURE,
            fa: 'fas fa-cog',
            type: 'group',
            renderer: async () => {
                return this.adjustEPGChannelEntryRenderer(e, detached);
            }
        };
    }
    async adjustEPGChannelEntryRenderer(e, detached) {        
        const terms = this.entryTerms(e).filter(t => !t.startsWith('-'));
        const options = [], results = await global.lists.epgSearchChannel(terms, 99)
        Object.keys(results).forEach(name => {
            let keys = Object.keys(results[name]);
            if (!keys.length)
                return;
            let details = results[name][keys[0]].title;
            details += '&nbsp;<span style="opacity: var(--opacity-level-3);">&middot;</span> <i class="fas fa-th" aria-hidden="true"></i> '+ keys.length
            options.push({
                name,
                details,
                fa: 'fas fa-th-large',
                type: 'action',
                icon: results[name][keys[0]].icon,
                action: () => {
                    console.log('adjustEPGChannelEntryRenderer RESULT', e.name, name);
                    let map = config.get('epg-map') || {};
                    if (e.name != name) {
                        map[e.name] = name;
                    } else if (map[e.name]) {
                        delete map[e.name];
                    }
                    config.set('epg-map', map);
                    if (detached) {                        
                        global.streamer.aboutTrigger('epg-more').catch(err => console.error(err));
                    } else {
                        menu.back(null, true);
                    }
                }
            });
        });
        options.push({
            name: lang.NONE,
            details: lang.DISABLED,
            fa: 'fas fa-ban',
            type: 'action',
            action: () => {
                let map = config.get('epg-map') || {};
                map[e.name] = '-';
                config.set('epg-map', map);
                menu.back(null, true);
            }
        });
        return options;
    }
    epgProgramAction(start, ch, programme, terms, icon) {
        const now = (Date.now() / 1000);
        
        if (programme.end < now) { // missed
            let text = lang.START_DATE + ': ' + moment(start * 1000).format('L LT') + '<br />' + lang.ENDED + ': ' + moment(programme.end * 1000).format('L LT');
            if (programme.categories && programme.categories.length) {
                text += '<br />' + lang.CATEGORIES + ': ' + programme.categories.join(', ');
            }
            menu.dialog([
                { template: 'question', text: programme.title + ' &middot; ' + ch, fa: 'fas fa-calendar-alt' },
                { template: 'message', text },
                { template: 'option', id: 'ok', fa: 'fas fa-check-circle', text: 'OK' }
            ], 'ok').catch(err => console.error(err));
        } else if (start <= (now + 300)) { // if it will start in less than 5 min, open it anyway            
            let url = mega.build(ch, { terms });
            global.streamer.play({
                name: ch,
                type: 'stream',
                fa: 'fas fa-play-circle',
                icon,
                url,
                terms: { name: terms, group: [] }
            });
        } else {
            let text = lang.START_DATE + ': ' + moment(start * 1000).format('L LT');
            if (programme.categories && programme.categories.length) {
                text += '<br />' + lang.CATEGORIES + ': ' + programme.categories.join(', ');
            }
            menu.dialog([
                { template: 'question', text: programme.title + ' &middot; ' + ch, fa: 'fas fa-calendar-alt' },
                { template: 'message', text },
                { template: 'option', id: 'ok', fa: 'fas fa-check-circle', text: 'OK' }
            ], 'ok').catch(err => console.error(err));
        }
    }
}
class ChannelsEditing extends ChannelsEPG {
    constructor() {
        super();
    }
    shareChannelEntry(e) {
        return {
            name: lang.SHARE,
            type: 'action',
            fa: 'fas fa-share-alt',
            action: () => {
                renderer.ui.emit('share', paths.manifest.window.title, e.name, 'https://megacubo.tv/w/' + encodeURIComponent(e.name));
            }
        };
    }
    editChannelEntry(o, _category, atts) {
        let e = Object.assign({}, o), terms = this.entryTerms(o, true)
        Object.assign(e, { fa: 'fas fa-play-circle', type: 'group', details: lang.EDIT_CHANNEL });
        Object.assign(e, atts);
        e.renderer = async () => {
            const category = _category;
            let entries = [];
            if (config.get('show-logos')) {
                entries.push({
                    name: lang.SELECT_ICON,
                    details: o.name, type: 'group',
                    renderer: async () => {
                        let images = [];
                        const ms = await icons.search(terms).catch(err => console.error(err));
                        Array.isArray(ms) && images.push(...ms.map(m => m.icon));
                        let ret = images.map((image, i) => {
                            const e = {
                                name: String(i + 1) + String.fromCharCode(186),
                                type: 'action',
                                icon: image,
                                class: 'entry-icon-no-fallback',
                                fa: 'fa-mega',
                                iconFallback: 'fas fa-times-circle',
                                action: async () => {
                                    let err;
                                    const r = await icons.fetchURL(image);
                                    const ret = await icons.adjust(r.file, { shouldBeAlpha: false }).catch(e => menu.displayErr(e));
                                    const destFile = await icons.saveDefaultFile(terms, ret.file).catch(e => err = e);
                                    this.emit('edited', 'icon', e, destFile);
                                    if (err)
                                        throw err;
                                    console.log('icon changed', terms, destFile);
                                    menu.refreshNow();
                                    osd.show(lang.ICON_CHANGED, 'fas fa-check-circle', 'channels', 'normal');
                                }
                            };
                            return e;
                        });
                        ret.push({
                            name: lang.OPEN_URL, type: 'input', fa: 'fas fa-link', action: async (err, val) => {
                                console.log('from-url', terms, '');
                                const fetched = await icons.fetchURL(val);
                                const ret = await icons.adjust(fetched.file, { shouldBeAlpha: false });
                                const destFile = await icons.saveDefaultFile(terms, ret.file);
                                this.emit('edited', 'icon', e, destFile);
                                console.log('icon changed', terms, destFile);
                                menu.refreshNow();
                                osd.show(lang.ICON_CHANGED, 'fas fa-check-circle', 'channels', 'normal');
                            }
                        });
                        ret.push({
                            name: lang.NO_ICON, type: 'action', fa: 'fas fa-ban', action: async () => {
                                console.log('saveDefault', terms, '');
                                await icons.saveDefaultFile(terms, 'no-icon');
                                this.emit('edited', 'icon', e, null);
                                menu.refreshNow();
                                osd.show(lang.ICON_CHANGED, 'fas fa-check-circle', 'channels', 'normal');
                            }
                        });
                        return ret;
                    }
                });
            }
            if (category) {
                const name = o.originalName || o.name;
                entries.push(...[
                    { name: lang.RENAME, type: 'input', details: name, value: name, action: (data, val) => {
                            const category = _category;
                            const name = o.originalName || o.name;
                            console.warn('RENAME', name, 'TO', val, category);
                            if (val && val != name) {
                                let i = -1;
                                this.channelList.categories[category].some((n, j) => {
                                    if (n.substr(0, name.length) == name) {
                                        i = j;
                                        return true;
                                    }
                                });
                                if (i != -1) {
                                    let t = (o.terms || e.terms || terms);
                                    t = t && t.name ? t.name : (Array.isArray(t) ? t.join(' ') : name);
                                    this.channelList.categories[category][i] = this.channelList.compactName(val, t);
                                    this.emit('edited', 'rename', e.name, val, e);
                                    console.warn('RENAMED', this.channelList.categories[category][i], category, i);
                                    this.channelList.save().then(() => {
                                        const category = _category;
                                        console.warn('RENAMED*', this.channelList.categories[category][i], category, i);
                                        let destPath = menu.path.replace(name, val).replace('/' + lang.RENAME, '');
                                        console.log('opening', destPath);
                                        menu.refresh(true, destPath);
                                        osd.show(lang.CHANNEL_RENAMED, 'fas fa-check-circle', 'channels', 'normal');
                                    }).catch(err => console.error(err));
                                }
                            }
                        } },
                    { name: lang.SEARCH_TERMS, type: 'input', value: () => {
                            let t = (o.terms || e.terms || terms)
                            if(t && t.name) {
                                t = t.name    
                            }
                            t = Array.isArray(t) ? t.join(' ') : name
                            return t
                        }, action: async (entry, val) => {
                            const category = _category;
                            if (!category || category == '__proto__' || category == 'constructor' || category == 'prototype') {
                                return console.error('Invalid category name:', category);
                            }
                            if (!this.channelList.categories[category])
                                return console.error('Category not found:', category);
                            let i = -1;
                            this.channelList.categories[category].some((n, j) => {
                                if (n.substr(0, name.length) == name) {
                                    i = j
                                    return true
                                }
                            })
                            if (i != -1) {
                                this.channelList.channelsIndex = null;
                                this.channelList.categories[category][i] = this.channelList.compactName(name, val.replaceAll(',', ' '))
                                this.emit('edited', 'searchTerms', e, val)
                                e.terms = global.lists.tools.terms(val)
                                o.terms = e.terms
                                await this.channelList.save()
                                menu.refreshNow()
                            }
                        } },
                    { name: lang.REMOVE, fa: 'fas fa-trash', type: 'action', details: o.name, action: async () => {
                            const category = _category;
                            console.warn('REMOVE', name);
                            if (!this.channelList.categories[category]) {
                                menu.open(lang.LIVE).catch(e => menu.displayErr(e));
                                return;
                            }
                            this.channelList.categories[category] = this.channelList.categories[category].filter(c => {
                                return c.split(',')[0] != name;
                            });
                            await this.channelList.save();
                            menu.refresh(true, menu.dirname(menu.dirname(menu.path)));
                            osd.show(lang.CHANNEL_REMOVED, 'fas fa-check-circle', 'channels', 'normal');
                        } }
                ]);
            }
            return entries;
        };
        ['cnt', 'count', 'label', 'users'].forEach(k => {
            if (e[k])
                delete e[k];
        });
        return e;
    }
    getCategoryEntry() {
        return { name: lang.ADD_CATEGORY, fa: 'fas fa-plus-square', type: 'input', action: async (data, val) => {
                let categories = this.channelList.getCategories();
                if (val && !categories.map(c => c.name).includes(val)) {
                    console.warn('ADD', val);
                    this.channelList.categories[val] = [];
                    await this.channelList.save();
                    console.warn('saved', lang.LIVE + '/' + val + '/' + lang.EDIT_CATEGORY);
                    delete menu.pages[lang.LIVE];
                    menu.open(lang.LIVE + '/' + val + '/' + lang.EDIT_CATEGORY + '/' + lang.EDIT_CHANNELS).catch(e => menu.displayErr(e));
                }
            } };
    }
    editCategoriesEntry() {
        return {
            name: lang.EDIT_CHANNEL_LIST,
            type: 'group',
            fa: 'fas fa-tasks',
            renderer: async () => {
                this.disableWatchNowAuto = true;
                return this.channelList.getCategories(false).map(c => this.editCategoryEntry(c, true));
            }
        };
    }
    editCategoryEntry(cat, useCategoryName) {
        let category = Object.assign({}, cat);
        Object.assign(category, { fa: 'fas fa-tasks', path: undefined });
        if (useCategoryName !== true) {
            Object.assign(category, { name: lang.EDIT_CATEGORY, rawname: lang.EDIT_CATEGORY, type: 'select', details: category.name });
        }
        category.renderer = async (c, e) => {
            this.disableWatchNowAuto = true;
            let entries = [
                this.addChannelEntry(category, false),
                { name: lang.EDIT_CHANNELS, fa: 'fas fa-th', details: cat.name, type: 'group', renderer: () => {
                        return new Promise((resolve, reject) => {
                            let entries = c.entries.map(e => {
                                return this.editChannelEntry(e, cat.name, {});
                            });
                            entries.unshift(this.addChannelEntry(cat));
                            resolve(entries);
                        });
                    } },
                { name: lang.RENAME_CATEGORY, fa: 'fas fa-edit', type: 'input', details: cat.name, value: cat.name, action: async (e, val) => {
                        console.warn('RENAME', cat.name, 'TO', val);
                        if (val && val != cat.name && typeof(this.channelList.categories[val]) == 'undefined') {
                            let o = this.channelList.categories[cat.name];
                            delete this.channelList.categories[cat.name];
                            this.channelList.categories[val] = o;
                            await this.channelList.save();
                            let destPath = menu.path.replace(cat.name, val).replace('/' + lang.RENAME_CATEGORY, '');
                            menu.refresh(true, destPath);
                            osd.show(lang.CATEGORY_RENAMED, 'fas fa-check-circle', 'channels', 'normal');
                        }
                    } },
                { name: lang.REMOVE_CATEGORY, fa: 'fas fa-trash', type: 'action', details: cat.name, action: async () => {
                        delete this.channelList.categories[cat.name];
                        await this.channelList.save();
                        menu.open(lang.LIVE).catch(e => menu.displayErr(e));
                        osd.show(lang.CATEGORY_REMOVED, 'fas fa-check-circle', 'channels', 'normal');
                    } }
            ];
            console.warn('editcat entries', entries);
            return entries;
        };
        return category;
    }
    addChannelEntry(cat, inline) {
        return {
            name: lang.ADD_CHANNEL,
            details: cat.name,
            fa: 'fas fa-plus-square',
            type: 'input',
            placeholder: lang.CHANNEL_NAME,
            action: async (data, val) => {
                const catName = cat.name;
                this.disableWatchNowAuto = true;
                if (val && !Object.keys(this.channelList.categories).map(c => c.name).includes(val)) {
                    if (this.channelList.categories[catName] && !this.channelList.categories[catName].includes(val)) {
                        this.channelList.categories[catName].push(val);
                        await this.channelList.save();
                        let targetPath = menu.path;
                        if (inline !== true) {
                            targetPath = menu.dirname(targetPath);
                        }
                        menu.refreshNow();
                        osd.show(lang.CHANNEL_ADDED, 'fas fa-check-circle', 'channels', 'normal');
                    }
                }
            }
        };
    }
}
class ChannelsAutoWatchNow extends ChannelsEditing {
    constructor() {
        super();
        this.watchNowAuto = false;
        this.disableWatchNowAuto = false;
        renderer.ready(() => {
            menu.on('render', (_, path) => {
                if (path != this.watchNowAuto) {
                    this.watchNowAuto = false;
                }
            })
            global.streamer.on('stop-from-client', () => {
                this.watchNowAuto = false;
            })
        })
    }
    autoplay() {
        const watchNowAuto = config.get('watch-now-auto');
        if (watchNowAuto == 'always')
            return true;
        if (this.disableWatchNowAuto || watchNowAuto == 'never')
            return false;
        return (watchNowAuto == 'auto' && this.watchNowAuto);
    }
}
class ChannelsKids extends ChannelsAutoWatchNow {
    constructor() {
        super()
        renderer.ready(() => {            
            lang.ready().catch(err => console.error(err)).finally(() => {
                menu.addFilter(async (entries, path) => {
                    const term = lang.CATEGORY_KIDS; // lang can change in runtime, check the term here so
                    if (path.endsWith(term)) {
                        entries = entries.map(e => {
                            if (!(e.rawname || e.name).includes('[') && ((!e.type || e.type == 'stream') ||
                                (e.class && e.class.includes('entry-meta-stream')))) {
                                e.rawname = '[fun]' + e.name + '[|fun]';
                            }
                            return e;
                        });
                    } else if ([lang.LIVE, lang.CATEGORY_MOVIES_SERIES].includes(path)) {
                        entries = entries.map(e => {
                            if (!(e.rawname || e.name).includes('[') && e.name == term) {
                                e.rawname = '[fun]' + e.name + '[|fun]';
                            }
                            return e;
                        });
                    }
                    return entries;
                });
            });
        });
    }
}
class Channels extends ChannelsKids {
    constructor() {
        super()
        this.trending = new Trending(this)
        this.history = new History(this)
        this.bookmarks = new Bookmarks(this)
        this.search = new Search(this)
    }
    async updateUserTasks(app) {
        if (process.platform != 'win32') return
        if (app) { // set from cache, Electron won't set after window is opened
            const tasks = await storage.get('user-tasks')
            if (tasks && Array.isArray(tasks) && tasks.length > 0) {
                try {
                    // Validate tasks before passing to setUserTasks
                    const validTasks = tasks.filter(task => {
                        return task && 
                               typeof task === 'object' &&
                               typeof task.arguments === 'string' &&
                               typeof task.title === 'string' &&
                               typeof task.description === 'string' &&
                               typeof task.program === 'string' &&
                               typeof task.iconPath === 'string' &&
                               typeof task.iconIndex === 'number'
                    })
                    
                    if (validTasks.length > 0 && !app.setUserTasks(validTasks)) {
                        throw new Error('Failed to set user tasks. ' + JSON.stringify(validTasks))
                    }
                } catch (err) {
                    console.error('Error setting user tasks:', err)
                }
            }
            return
        }
        const limit = 12
        const entries = []
        
        // Safely get bookmarks
        try {
            const bookmarks = this.bookmarks.get()
            if (Array.isArray(bookmarks)) {
                entries.push(...bookmarks.slice(0, limit))
            }
        } catch (err) {
            console.error('Error getting bookmarks:', err)
        }
        
        if (entries.length < limit) {
            // Safely get history
            try {
                const history = this.history.get()
                if (Array.isArray(history)) {
                    for (const entry of history) {
                        if (entry && entry.name && !entries.some(e => e && e.name == entry.name)) {
                            entries.push(entry);
                            if (entries.length == limit)
                                break;
                        }
                    }
                }
            } catch (err) {
                console.error('Error getting history:', err)
            }
            
            // Safely get trending entries
            if (entries.length < limit && this.trending && Array.isArray(this.trending.currentEntries)) {
                try {
                    for (const entry of this.trending.currentEntries) {
                        if (entry && entry.name && !entries.some(e => e && e.name == entry.name)) {
                            entries.push(entry);
                            if (entries.length == limit)
                                break;
                        }
                    }
                } catch (err) {
                    console.error('Error getting trending entries:', err)
                }
            }
        }
        
        const tasks = entries.map(entry => {
            // Validate entry data more thoroughly
            if (!entry || 
                typeof entry !== 'object' ||
                !entry.url || 
                typeof entry.url !== 'string' ||
                !entry.name || 
                typeof entry.name !== 'string') {
                return null;
            }
            
            // Ensure all required fields are properly formatted
            return {
                arguments: '"' + String(entry.url).replace(/"/g, '\\"') + '"',
                title: String(entry.name).substring(0, 100), // Limit title length
                description: String(entry.name).substring(0, 100), // Limit description length
                program: String(process.execPath),
                iconPath: String(process.execPath),
                iconIndex: 0
            }
        }).filter(task => task !== null); // Remove invalid tasks
        
        if (tasks.length > 0) {
            try {
                await storage.set('user-tasks', tasks, {
                    expiration: true,
                    permanent: true
                })
            } catch (err) {
                console.error('Error saving user tasks:', err)
            }
        }
    }
    async goChannelWebsite(name) {
        if (!name) {            
            if (global.streamer.active) {
                name = global.streamer.active.data.originalName || global.streamer.active.data.name
            } else {
                return false
            }
        }
        let url = 'https://www.google.com/search?btnI=1&lr=lang_{0}&q={1}'.format(lang.locale, encodeURIComponent('"' + name + '" site'));
        const body = String(await Download.get({ url }).catch(err => console.error(err)));
        const matches = body.match(new RegExp('href *= *["\']([^"\']*://[^"\']*)'));
        if (matches && matches[1]) {
            const domain = getDomain(matches[1])
            if (domain && domain !== 'google.com' && !domain.endsWith('.google.com')) {
                url = matches[1];
            }
        }
        renderer.ui.emit('open-external-url', url);
    }
    getAllChannels() {
        let list = [];
        this.channelList.getCategories().forEach(category => {
            category.entries.forEach(e => {
                list.push(e);
            });
        });
        return list;
    }
    getAllChannelsNames() {
        return this.getAllChannels().map(c => c.name);
    }
    getChannelCategory(name) {
        let ct, sure, cats = this.channelList.getCategories(true);
        Object.keys(cats).some(c => {
            let i = -1;
            cats[c].some((n, j) => {
                if (n == name) {
                    ct = c;
                    sure = true;
                } else if (n.substr(0, name.length) == name) {
                    ct = c;
                }
                return sure;
            });
        });
        return ct;
    }
    cmatch(needleTerms, stackTerms) {
        // partial=true will match "starts with" terms too
        // the difference from global.lists.tools.match() is that cmatch will check partials from stackTerms instead
        //console.log(needleTerms, stackTerms)
        
        // Ensure needleTerms is an array
        if (!Array.isArray(needleTerms)) {
            console.warn('cmatch: needleTerms is not an array:', needleTerms);
            return 0;
        }
        
        // Ensure stackTerms is an array
        if (!Array.isArray(stackTerms)) {
            console.warn('cmatch: stackTerms is not an array:', stackTerms);
            return 0;
        }
        
        if (needleTerms.includes('|')) {
            let needles = needleTerms.join(' ').split('|').map(s => s.trim()).filter(s => s).map(s => s.split(' '));
            let score = 0;
            needles.forEach(needle => {
                let s = this.cmatch(needle, stackTerms);
                if (s > score) {
                    score = s;
                }
            });
            return score;
        }
        if (needleTerms.length && stackTerms.length) {
            let score = 0, sTerms = [], nTerms = [];
            let excludeMatch = needleTerms.some(t => {
                if (t.startsWith('-')) {
                    if (stackTerms.includes(t.substr(1))) {
                        return true;
                    }
                } else {
                    nTerms.push(t);
                }
            }) || stackTerms.some(t => {
                if (t.startsWith('-')) {
                    if (needleTerms.includes(t.substr(1))) {
                        return true;
                    }
                } else {
                    sTerms.push(t);
                }
            });
            if (excludeMatch || !sTerms.length || !nTerms.length) {
                return 0;
            }
            nTerms.forEach(term => {
                let len = term.length;
                sTerms.some(strm => {
                    //console.log(term, strm)
                    if (len == strm.length) {
                        if (strm == term) {
                            score++;
                            return true;
                        }
                    } else if (term.length > strm.length && strm == term.substr(0, strm.length)) {
                        score++;
                        return true;
                    }
                });
            });
            if (score) {
                if (score == sTerms.length) { // all search terms are present
                    if (score == nTerms.length) { // terms are equal
                        return 3;
                    } else {
                        return 2;
                    }
                } else if (sTerms.length >= 3 && score == (sTerms.length - 1)) {
                    return 1;
                }
            }
        }
        return 0;
    }
    isChannel(terms) {        
        if(!this.channelList || !terms) return
        if(terms.isChannel) return terms.isChannel

        let tms, tmsKey, chs = this.channelList.channelsIndex || {};
        if (Array.isArray(terms)) {
            tms = terms;
            tmsKey = tms.join(' ')
            if (this.channelList.isChannelCache[tmsKey])
                return this.channelList.isChannelCache[tmsKey];
        } else {
            tms = typeof(terms) == 'string' ? global.lists.tools.terms(terms) : this.entryTerms(terms, true)
            tmsKey = tms.join(' ')
            if (this.channelList.isChannelCache[tmsKey])
                return this.channelList.isChannelCache[tmsKey]; // before terms()
            if (typeof(chs[terms]) != 'undefined') {
                tms = chs[terms]
            }
        }
        let chosen, chosenScore = -1;
        Object.keys(chs).forEach(name => {
            let score = global.lists.tools.match(chs[name], tms, false);
            if (score) {
                if (score > chosenScore) {
                    chosen = name;
                    chosenScore = score;
                }
            }
        });
        if (chosenScore > 1) {
            if (typeof(this.channelList.isChannelCache[chosen]) == 'undefined') {
                let alts = {}, excludes = [], chTerms = clone(chs[chosen]?.name || chs[chosen]);
                Object.keys(chs).forEach(name => {
                    if (name == chosen)
                        return;
                    let score = global.lists.tools.match(chTerms, chs[name], false);
                    if (score) {
                        alts[name] = chs[name];
                    }
                });
                const skipChrs = ['-', '|'];
                Object.keys(alts).forEach(n => {
                    excludes.push(...alts[n].filter(t => {
                        return !skipChrs.includes(t.charAt(0)) && !chTerms.includes(t);
                    }));
                });
                excludes = excludes.unique();
                const seemsRadio = chTerms.some(c => this.radioTerms.includes(c));
                chTerms = chTerms.join(' ').split(' | ').map(s => s.split(' ')).filter(s => s).map(t => {
                    t.push(...excludes.map(s => '-' + s));
                    if (!seemsRadio) {
                        this.radioTerms.forEach(rterm => {
                            if (!t.some(cterm => cterm.substr(0, rterm.length) == rterm)) { // this radio term can mess with our search (specially AM)
                                t.push('-' + rterm);
                            }
                        });
                    }
                    return t;
                }).map(s => s.join(' ')).join(' | ').split(' ');
                this.channelList.isChannelCache[chosen] = { name: chosen, terms: chTerms, alts, excludes };
            }
            if (tmsKey != chosen) {
                this.channelList.isChannelCache[tmsKey] = this.channelList.isChannelCache[chosen]
            }
            if(typeof(terms) == 'object' && !Array.isArray(terms)) {
                terms.isChannel = this.channelList.isChannelCache[chosen]
            }
            return this.channelList.isChannelCache[chosen]
        }
    }
    expandTerms(terms) {
        if (typeof(terms) == 'string') {
            terms = global.lists.tools.terms(terms)
        }
        let ch = this.isChannel(terms)
        if (ch) {
            return ch.terms;
        }
        return terms;
    }
    async get(terms) {        
        if (typeof(terms) == 'string') {
            terms = global.lists.tools.terms(terms);
        }
        console.warn('channels.get', terms);
        let entries = await global.lists.search(terms, {
            safe: !global.lists.parentalControl.lazyAuth(),
            type: 'live',
            limit: 1024
        })
        await this.trending.order(entries).then(es => entries = es).catch(err => console.error(err));
        return entries;
    }
    async searchChannels(terms, partial) {
        if (typeof (terms) == 'string') {
            terms = global.lists.tools.terms(terms)
        }

        if (!Array.isArray(terms)) {
            console.warn('searchChannels: terms is not an array after conversion:', terms)
            terms = []
        }

        const entries = []
        const already = {}
        const matchAll = !terms.length || (terms.length == 1 && terms[0] == '*')

        if (!this.channelList || !this.channelList.channelsIndex || typeof this.channelList.channelsIndex !== 'object') {
            console.warn('searchChannels: channelsIndex is not available')
            return []
        }

        Object.keys(this.channelList.channelsIndex).sort().forEach(name => {
            if (typeof (already[name]) === 'undefined') {
                let channelTerms = this.channelList.channelsIndex[name]
                if (!Array.isArray(channelTerms)) {
                    console.warn('searchChannels: channelTerms for', name, 'is not an array:', channelTerms)
                    channelTerms = []
                }
                const score = matchAll ? 1 : this.cmatch(channelTerms, terms, partial)
                if (score) {
                    already[name] = null
                    entries.push({
                        name,
                        terms: { name: this.channelList.channelsIndex[name] }
                    })
                }
            }
        })
        console.log(clone(entries))

        let epgEntries = []
        try {
            const epgResults = await this.epgSearch(terms, true)
            epgEntries = epgResults.map(e => {
                const ch = this.isChannel(e.programme.channel)
                if (ch && typeof (already[ch.name]) === 'undefined') {
                    already[ch.name] = null
                    if (e.details) {
                        e.details = e.details.replace(e.programme.channel, ch.name)
                    }
                    e.programme.channel = ch.name
                    return e
                }
            }).filter(e => !!e)
        } catch (err) {
            console.error(err)
        }

        return entries.concat(epgEntries)
    }
    entryTerms(e, expand) {
        let terms
        if (typeof(e.nameTerms) != 'undefined' && Array.isArray(e.nameTerms) && e.nameTerms.length) {
            terms = e.nameTerms
        } else if (typeof(e.terms) != 'undefined' && Array.isArray(e.terms) && e.terms.length) { // channel entry
            terms = e.terms
        } else if (e.originalName) {
            terms = global.lists.tools.terms(e.originalName)
        } else {
            terms = global.lists.tools.terms(e.programme ? e.programme.channel : e.name);
        }
        if(expand && !e.expanded) {
            terms = this.expandTerms(terms)
            e.expanded = true
        }
        if(!e.nameTerms) {
            e.nameTerms = terms
        }
        return terms
    }
    async toMetaEntryRenderer(e, _category, epgNow) {
        let category, channelName = e.originalName || (e.programme ? e.programme.channel : (e.originalName || e.name));
        if (_category === false) {
            category = false;
        } else if (_category && typeof(_category) == 'string') {
            category = _category;
        } else if (_category && typeof(_category) == 'object') {
            category = _category.name;
        } else {
            let c = this.getChannelCategory(e.originalName || e.name);
            if (c) {
                category = c;
            } else {
                category = false;
            }
        }
        let terms = this.entryTerms(e, true), streamsEntry, epgEntry, entries = [], moreOptions = [], url = e.url;       
        let name = channelName
        if(!url || !url.match(new RegExp('mediaType=(video|audio|all)'))) {
            const ch = this.isChannel(name);
            if (ch) {
                channelName = name = ch.name;
                terms = ch.terms;
            }
            e.url = url = mega.build(name, { terms });
        }
        const autoplay = this.autoplay(), streams = await this.get(terms);
        streams.forEach((e, i) => {
            if (!streams[i].group) {
                streams[i].group = category;
            }
        });
        if (autoplay) {
            if (streams.length) {                
                global.streamer.play(e, streams);
                return -1;
            } else {
                throw lang.NONE_STREAM_FOUND;
            }
        } else {            
            if (streams.length) {
                let call = global.lists.mi.isRadio(channelName + ' ' + category) ? lang.LISTEN_NOW : lang.WATCH_NOW;
                entries.push({
                    name: call,
                    type: 'action',
                    fa: 'fas fa-play-circle faclr-green',
                    url,
                    group: category,
                    action: data => {                        
                        data.name = e.name;
                        global.streamer.play(data, streams);
                        this.watchNowAuto = menu.path;
                    }
                })
                streamsEntry = {
                    name: lang.STREAMS + ' (' + streams.length + ')',
                    type: 'group',
                    renderer: async () => streams
                }
                epgEntry = {
                    name: lang.EPG,
                    type: 'group',
                    fa: this.epgIcon,
                    details: (epgNow && epgNow != category) ? epgNow : '',
                    renderer: this.epgChannelEntries.bind(this, e)
                }
            } else {
                const loaded = global.lists.loaded(true)
                const name = loaded ? lang.NONE_STREAM_FOUND : lang.NO_LISTS_ADDED;
                entries.push(Object.assign(this.emptyEntry, {
                    name,
                    fa: 'fas fa-exclamation-triangle faclr-red'
                }));
                if (global.lists.activeLists.my.length) {
                    global.lists.manager.checkListExpiral(global.lists.activeLists.my.map(source => ({ source }))).catch(err => console.error(err));
                }
            }
        }
        if (entries.length) {
            let bookmarkable = { name: channelName, type: 'stream', label: e.group || '', url };
            if (this.bookmarks.has(bookmarkable)) {
                entries.push({
                    type: 'action',
                    fa: 'fas fa-star-half',
                    name: lang.REMOVE_FROM.format(lang.BOOKMARKS),
                    action: () => {
                        this.bookmarks.remove(bookmarkable);
                        menu.refreshNow();
                        osd.show(lang.BOOKMARK_REMOVED.format(bookmarkable.name), 'fas fa-star-half', 'bookmarks', 'normal');
                    }
                });
            } else {
                entries.push({
                    type: 'action',
                    fa: 'fas fa-star',
                    name: lang.ADD_TO.format(lang.BOOKMARKS),
                    action: () => {
                        this.bookmarks.add(bookmarkable);
                        menu.refreshNow();
                        osd.show(lang.BOOKMARK_ADDED.format(bookmarkable.name), 'fas fa-star', 'bookmarks', 'normal');
                    }
                });
            }
        }
        if (epgEntry) {
            entries.push(epgEntry);
        }
        if (streamsEntry) {
            moreOptions.push(this.shareChannelEntry(e));
            moreOptions.push(streamsEntry);
        }
        if (!config.get('channel-grid') && config.get('allow-edit-channel-list')) {
            const editEntry = this.editChannelEntry(e, category, { name: category ? lang.EDIT_CHANNEL : lang.EDIT, details: undefined, class: 'no-icon', fa: 'fas fa-edit', users: undefined, usersPercentage: undefined, path: undefined, url: undefined });
            moreOptions.push(editEntry);
        }
        moreOptions.push({
            type: 'action',
            fa: 'fas fa-globe',
            name: lang.CHANNEL_WEBSITE,
            action: () => {
                this.goChannelWebsite(channelName).catch(e => menu.displayErr(e));
            }
        });
        entries.push({ name: lang.MORE_OPTIONS, type: 'select', fa: 'fas fa-ellipsis-v', entries: moreOptions });
        return entries.map(e => {
            if (e.renderer || e.entries) {
                let originalRenderer = e.renderer || e.entries;
                e.renderer = data => {
                    if (data.name != lang.WATCH_NOW) {
                        this.disableWatchNowAuto = true; // learn that the user is interested in other functions instead of watchNow directly
                    }
                    if (Array.isArray(originalRenderer)) {
                        return new Promise(resolve => resolve(originalRenderer));
                    } else {
                        return originalRenderer(data);
                    }
                };
            }
            if (e.action) {
                let originalAction = e.action;
                e.action = data => {
                    if (data.name != lang.WATCH_NOW) {
                        this.disableWatchNowAuto = true; // learn that the user is interested in other functions instead of watchNow directly
                    }
                    return originalAction(data);
                };
            }
            return e;
        });
    }
    toMetaEntry(e, category, details) {
        let meta = Object.assign({}, e), terms = this.entryTerms(e, true)
        if (typeof(meta.url) == 'undefined') {
            let name = e.name
            if (e.programme && e.programme.channel) {
                name = e.programme.channel
            }
            const ch = this.isChannel(name)
            if (ch && ch.name) {
                name = ch.name
                terms = ch.terms
            }
            meta.url = mega.build(name, { terms })
        }
        if (!meta.originalName) {
            meta.originalName = meta.name
        }
        if (mega.isMega(meta.url)) {
            let atts = Object.assign({}, mega.parse(meta.url));
            Object.assign(atts, meta);
            if (['all', 'video'].includes(atts.mediaType)) {
                Object.assign(meta, {
                    type: 'group',
                    class: 'entry-meta-stream',
                    fa: 'fas fa-play-circle',
                    renderer: async () => {
                        let tms = atts.terms && Array.isArray(atts.terms) ? atts.terms : terms(atts.name);
                        let es = await global.lists.search(tms, {
                            type: atts.mediaType,
                            group: false,
                            safe: !global.lists.parentalControl.lazyAuth(),
                            limit: 1024
                        });
                        return es;
                    }
                });
            } else {
                Object.assign(meta, {
                    type: 'select',
                    class: 'entry-meta-stream',
                    fa: 'fas fa-play-circle',
                    renderer: () => this.toMetaEntryRenderer(atts, category, details)
                });
            }
        }
        if (details) {
            meta.details = details
        }
        if (meta.path) {
            delete meta.path
        }
        return meta
    }
    async keywords() {
        let err, keywords = [], badChrs = ['|', '-']
        if(this.channelList) {
            const data = await this.channelList.getAppRecommendedCategories().catch(e => err = e)
            if (!err) {
                keywords.push(...Object.values(data).flat().map(n => this.channelList.expandName(n).terms).flat())
            }
            keywords = keywords.unique().filter(w => !badChrs.includes(w.charAt(0)))
        }
        return keywords
    }
    async setGridType(type) {
        const busy = menu.setBusy(lang.LIVE +'/' + lang.CHOOSE_CHANNEL_GRID)
        osd.show(lang.PROCESSING, 'fa-mega busy-x', 'channel-grid', 'persistent');
        config.set('channel-grid', type);
        let err;
        await this.load(true).catch(e => err = e);
        if (err) {
            busy.release()
            return osd.show(err, 'fas fa-exclamation-triangle faclr-red', 'channel-grid', 'normal')
        }
        this.emit('channel-grid-updated')
        const position = menu.path.indexOf(lang.EPG)
        const target = (position != -1) ? menu.path.substring(0, position + lang.EPG.length) : lang.LIVE
        await menu.open(target).catch(e => menu.displayErr(e))
        busy.release()
        osd.show('OK', 'fas fa-check-circle faclr-green', 'channel-grid', 'normal')
    }
    async entries() {
        if (!global.lists.loaded()) {
            return [global.lists.manager.updatingListsEntry()];
        }
        if(!this.channelList) {
            throw new Error('Channel list not loaded')
        }
        let list
        const publicMode = config.get('public-lists') && !(paths.ALLOW_ADDING_LISTS && global.lists.loaded(true)); // no list available on index beyound public lists
        const type = publicMode ? 'public' : config.get('channel-grid');
        const editable = !type && config.get('allow-edit-channel-list');
        const categories = await this.channelList.getCategories();
        if (publicMode) {
            list = []
            for (const category of Object.keys(categories)) {
                let chs = categories[category].entries.map(e => this.isChannel(e.name)).filter(e => !!e);
                const ret = await global.lists.has(chs, { partial: false });
                let entries = categories[category].entries.filter(e => ret[e.name]);
                entries = entries.map(e => this.toMetaEntry(e, categories[category]));
                list.push(...entries);
            }
            list = global.lists.tools.sort(list);
        } else {
            list = categories.map(category => {
                category.renderer = async (c, e) => {
                    const start = Date.now();
                    console.log('category.renderer', category.name, Date.now() - start);
                    let chs = category.entries.map(e => this.isChannel(e.name)).filter(e => !!e);
                    
                    // Add timeout to prevent hanging on slow lists.has() calls
                    let ret = {};
                    try {
                        const timeoutPromise = new Promise((_, reject) => 
                            setTimeout(() => reject(new Error(`lists.has timeout for category ${category.name}`)), 30000)
                        );
                        ret = await Promise.race([
                            global.lists.has(chs, { partial: false }),
                            timeoutPromise
                        ]);
                    } catch (err) {
                        const isTimeout = err.message && err.message.includes('timeout');
                        const errorMsg = isTimeout 
                            ? `Timeout checking availability of channels in category "${category.name}". The operation took more than 30 seconds.`
                            : `Error checking availability of channels in category "${category.name}": ${err.message}`;
                        
                        console.warn(`category.renderer timeout/error for ${category.name}:`, err.message);
                        
                        // Show informative error message to user
                        global.menu.displayErr(errorMsg);
                        
                        // Return empty result on timeout/error to prevent hanging
                        ret = {};
                    }
                    
                    console.log('global.lists.has', category.name, Date.now() - start);
                    let entries = category.entries.filter(e => ret[e.name]);
                    console.log('category.entries.filter', category.name, Date.now() - start);
                    entries = entries.map(e => this.toMetaEntry(e, category));
                    console.log('toMetaEntry', category.name, Date.now() - start);
                    entries = this.sortCategoryEntries(entries);
                    console.log('sortCategoryEntries', category.name, Date.now() - start);
                    editable && entries.push(this.editCategoryEntry(c));
                    console.log('editCategoryEntry', category.name, Date.now() - start);
                    return entries;
                };
                return category;
            });
            list = global.lists.tools.sort(list);
            list.push(this.allCategoriesEntry());
        }
        editable && !publicMode && list.push(this.getCategoryEntry());
        publicMode || list.unshift(this.chooseChannelGridOption());
        publicMode && paths.ALLOW_ADDING_LISTS && list.unshift(global.lists.manager.noListsEntry());
        return list;
    }
    allCategoriesEntry() {
        return {
            name: lang.ALL_CHANNELS,
            type: 'group',
            renderer: async () => {                
                let entries = [], already = {};
                for (const category of this.channelList.getCategories()) {
                    category.entries.map(e => this.isChannel(e.name)).filter(e => {
                        if (!e || already[e.name])
                            return;
                        return already[e.name] = true;
                    }).forEach(e => {
                        const entry = this.toMetaEntry(e, category);
                        entry.details = category.name;
                        entries.push(entry);
                    });
                }
                entries = global.lists.tools.sort(entries);
                return entries;
            }
        };
    }
    chooseChannelGridOption(epgFocused) {
        return {
            name: lang.CHOOSE_CHANNEL_GRID,
            type: 'select',
            fa: 'fas fa-th',
            renderer: async () => {
                const def = config.get('channel-grid'), opts = [
                    { name: lang.AUTO + ' (' + lang.RECOMMENDED + ')', type: 'action', selected: !def, action: () => {
                            this.setGridType('').catch(err => console.error(err));
                        } },
                    { name: lang.DEFAULT, type: 'action', selected: def == 'app', action: () => {
                            this.setGridType('app').catch(err => console.error(err));
                        } },
                    { name: lang.EPG, type: 'action', selected: def == 'epg', action: () => {
                            this.setGridType('epg').catch(err => console.error(err));
                        } },
                    { name: lang.PUBLIC_LISTS, type: 'action', selected: def == 'public', action: () => {
                            this.setGridType('public').catch(err => console.error(err));
                        } }
                ];
                if (epgFocused !== true) {
                    if (config.get('lists').length) {
                        opts.push({
                            name: lang.MY_LISTS, type: 'action',
                            selected: def == 'lists',
                            action: () => {
                                this.setGridType('lists').catch(err => console.error(err));
                            }
                        });
                    }
                    opts.push(this.exportImportOption());
                }
                if (config.get('parental-control') != 'remove' && global.lists.parentalControl.lazyAuth()) {
                    opts.splice(opts.length - 2, 0, { name: lang.ADULT_CONTENT, type: 'action', selected: def == 'xxx', action: () => {
                        this.setGridType('xxx').catch(err => console.error(err))
                    }})
                }
                return opts;
            }
        };
    }
    sortCategoryEntries(entries) {        
        entries = global.lists.tools.sort(entries);
        const policy = config.get('channels-list-smart-sorting')
        const adjust = e => {
            if(e.programme && e.programme.title) {
                if(!e.originalName) {
                    e.originalName = e.name
                }
                e.details = e.name
                e.name = e.programme.title
            }
            return e
        }
        /*
        0 = Focus on EPG data.
        1 = Focus on channels, without EPG images.
        2 = Focus on channels, with EPG images.
        */
        switch (policy) {
            case 1:
                break;
                entries = entries.map(e => {
                    delete e.programme;
                    return e;
                });
            case 2:
                break;
            default: // 0
                let noEPG = []
                entries = entries.filter(e => {
                    if (!e.programme) {
                        noEPG.push(e);
                        return false;
                    }
                    return true;
                });
                entries = global.lists.tools.sort(entries.map(adjust))
                entries.push(...noEPG);
                break;
        }
        return entries;
    }
    importFile(data) {
        console.log('Categories file', data);
        try {
            data = parse(data);
            if (typeof(data) == 'object') {
                this.channelList.setCategories(data);
                osd.show('OK', 'fas fa-check-circle faclr-green', 'options', 'normal');
            } else {
                throw new Error('Not a JSON file.');
            }
        }
        catch (e) {
            menu.displayErr('Invalid file', e);
        }
    }
    exportImportOption() {
        return {
            name: lang.EXPORT_IMPORT,
            type: 'group',
            fa: 'fas fa-file-import',
            entries: [
                {
                    name: lang.EXPORT,
                    type: 'action',
                    fa: 'fas fa-file-export',
                    action: async () => {
                        let err
                        const filename = 'categories.json', file = downloads.folder + '/' + filename
                        const json = JSON.stringify(this.channelList.getCategories(true), null, 3)
                        if(json) {
                            await fs.promises.writeFile(file, json, { encoding: 'utf-8' }).catch(e => err = e)
                            if (err) return menu.displayErr(err)
                            downloads.serve(file, true, false).catch(e => menu.displayErr(e))
                        } else {
                            menu.displayErr('No data to export')
                        }
                    }
                },
                {
                    name: lang.IMPORT,
                    type: 'action',
                    fa: 'fas fa-file-import',
                    action: async () => {
                        config.set('channel-grid', '');                        
                        const file = await menu.chooseFile('application/json');
                        this.importFile(await fs.promises.readFile(file));
                    }
                },
                {
                    name: lang.RESET,
                    type: 'action',
                    fa: 'fas fa-undo-alt',
                    action: async () => {
                        osd.show(lang.PROCESSING, 'fa-mega busy-x', 'options', 'persistent');
                        await this.channelList.reset();
                        await this.load();
                        osd.show('OK', 'fas fa-check-circle faclr-green', 'options', 'normal');
                    }
                }
            ]
        };
    }
    options() {
        return new Promise((resolve, reject) => {            
            let entries = [];
            if (!config.get('channel-grid') && config.get('allow-edit-channel-list')) {
                entries.push(this.editCategoriesEntry());
            }
            entries.push(this.exportImportOption());
            paths.ALLOW_ADDING_LISTS && entries.push(global.lists.manager.listsEntry(true));
            entries.push(...[
                {
                    name: lang.ALLOW_EDIT_CHANNEL_LIST,
                    type: 'check',
                    action: (e, checked) => {
                        config.set('allow-edit-channel-list', checked);
                        menu.refreshNow();
                    },
                    checked: () => {
                        return config.get('allow-edit-channel-list');
                    }
                },
                {
                    name: lang.ONLY_KNOWN_CHANNELS_IN_X.format(lang.TRENDING),
                    type: 'check',
                    action: (e, checked) => {
                        config.set('only-known-channels-in-trending', checked);
                        this.trending.update().catch(err => console.error(err));
                    },
                    checked: () => {
                        return config.get('only-known-channels-in-trending');
                    }
                },
                {
                    name: lang.SHOW_POPULAR_SEARCHES.format(lang.TRENDING),
                    type: 'check',
                    action: (e, checked) => {
                        config.set('popular-searches-in-trending', checked);
                        this.trending.update().catch(err => console.error(err));
                    },
                    checked: () => {
                        return config.get('popular-searches-in-trending');
                    }
                },
                {
                    name: lang.CHANNEL_LIST_SORTING,
                    type: 'select',
                    fa: 'fas fa-sort-alpha-down',
                    renderer: () => {
                        return new Promise((resolve, reject) => {
                            let def = config.get('channels-list-smart-sorting'), opts = [
                                { name: lang.FOCUS_ON_TV_SHOWS, type: 'action', selected: (def == 0), action: () => {
                                        config.set('channels-list-smart-sorting', 0);
                                    } },
                                { name: lang.FOCUS_ON_CHANNELS_WITH_TV_SHOW_IMAGES, type: 'action', selected: (def == 1), action: () => {
                                        config.set('channels-list-smart-sorting', 1);
                                    } },
                                { name: lang.FOCUS_ON_CHANNELS, type: 'action', selected: (def == 2), action: () => {
                                        config.set('channels-list-smart-sorting', 2);
                                    } }
                            ];
                            resolve(opts);
                        });
                    }
                },
                {
                    name: lang.CHOOSE_WATCH_NOW_AUTOMATICALLY.format(lang.WATCH_NOW),
                    type: 'select',
                    fa: 'fas fa-step-forward',
                    renderer: () => {
                        return new Promise(resolve => {
                            let def = config.get('watch-now-auto'), opts = [
                                { name: lang.AUTO, type: 'action', selected: (def == 'auto'), action: data => {
                                        config.set('watch-now-auto', 'auto');
                                    } },
                                { name: lang.ALWAYS, type: 'action', selected: (def == 'always'), action: data => {
                                        config.set('watch-now-auto', 'always');
                                    } },
                                { name: lang.NEVER, type: 'action', selected: (def == 'never'), action: data => {
                                        config.set('watch-now-auto', 'never');
                                    } }
                            ];
                            resolve(opts);
                        });
                    }
                }
            ]);
            resolve(entries);
        });
    }
    async groupsRenderer(type, opts = {}) {
        // Performance optimization: Early return for loading state
        if (!global.lists.loaded()) {
            return [global.lists.manager.updatingListsEntry()];
        }

        const isSeries = type == 'series';
        const acpolicy = config.get('parental-control');

        // Performance optimization: Async group loading
        let groups = await global.lists.groups(type ? [type] : ['series', 'vod'], opts.myListsOnly);
        
        if (!groups.length && !global.lists.loaded(true)) {
            if (paths.ALLOW_ADDING_LISTS) {
                return [global.lists.manager.noListsEntry()];
            }
            return [];
        }

        // Performance optimization: Apply parental filter early to reduce processing
        groups = this.applyParentalFilter(groups, acpolicy);
        
        // Performance optimization: Async group processing with batching
        const groupToEntry = (group) => {
            const name = group.name;
            
            // FIXED: Prevent recursive concatenation in details field
            let details = '';
            if (group.group && group.group !== name) {
                // Split the group path and filter out the current name to avoid recursion
                const pathParts = group.group.split('/');
                const filteredParts = pathParts.filter(n => n && n !== name);
                
                // Remove duplicate consecutive parts to prevent recursive concatenation
                const uniqueParts = [];
                let lastPart = '';
                for (const part of filteredParts) {
                    if (part !== lastPart) {
                        uniqueParts.push(part);
                        lastPart = part;
                    }
                }
                
                details = uniqueParts.join(' &middot; ');
            }
            
            return {
                name,
                details,
                type: 'group',
                icon: isSeries ? group.icon : undefined,
                safe: true,
                class: isSeries ? 'entry-cover' : undefined,
                fa: isSeries ? 'fas fa-play-circle' : undefined,
                renderer: async () => {
                    // Performance optimization: Lazy loading with error handling
                    return this.renderGroupEntries(group, acpolicy, isSeries);
                }
            };
        };

        // Performance optimization: Process groups in batches to avoid blocking
        const processGroupsBatch = async (groupsBatch) => {
            const batchSize = 10; // Process 10 groups at a time
            const results = [];
            
            for (let i = 0; i < groupsBatch.length; i += batchSize) {
                const batch = groupsBatch.slice(i, i + batchSize);
                const batchPromises = batch.map(group => 
                    Promise.resolve(groupToEntry(group)).catch(err => {
                        console.error('Error processing group:', group.name, err);
                        return null;
                    })
                );
                
                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults.filter(result => result !== null));
                
                // Performance optimization: Yield control to prevent blocking
                if (i + batchSize < groupsBatch.length) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
            
            return results;
        };

        // Performance optimization: Process all groups asynchronously
        let pentries = await processGroupsBatch(groups);

        // Performance optimization: Conditional deepify with error handling
        if (opts.deepify !== false) {
            try {
                const deepEntries = await global.lists.tools.deepify(pentries).catch(err => {
                    console.error('Deepify error:', err);
                    return pentries; // Fallback to original entries
                });
                if (Array.isArray(deepEntries)) {
                    pentries = deepEntries;
                }
            } catch (err) {
                console.error('Deepify processing error:', err);
            }
        }

        return pentries;
    }

    // Performance optimization: Extracted parental filter function
    applyParentalFilter(entries, acpolicy) {
        if (acpolicy == 'block') {
            return global.lists.parentalControl.filter(entries);
        } else if (acpolicy == 'remove') {
            return global.lists.parentalControl.filter(entries);
        } else if (acpolicy == 'only') {
            return global.lists.parentalControl.only(entries);
        }
        return entries;
    }

    // Performance optimization: Extracted group rendering function with async processing
    async renderGroupEntries(group, acpolicy, isSeries) {
        try {
            let entries = await global.lists.group(group).catch(e => {
                console.error('Error loading group entries:', e);
                menu.displayErr(e);
                return [];
            });

            if (!Array.isArray(entries) || entries.length === 0) {
                return [];
            }

            console.warn('entries before chunking', entries.length);
            
            // Performance optimization: Process entries in smaller chunks
            const CHUNK_SIZE = 20;
            let processedEntries = [];

            for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
                const chunk = entries.slice(i, i + CHUNK_SIZE);
                
                // Performance optimization: Process chunk asynchronously
                const processedChunk = await this.processEntriesChunk(chunk, group, isSeries);
                processedEntries.push(...processedChunk);
                
                // Performance optimization: Yield control between chunks
                if (i + CHUNK_SIZE < entries.length) {
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }

            console.warn('entries after chunking', processedEntries.length);

            // Performance optimization: Apply filters and sorting
            processedEntries = this.applyParentalFilter(processedEntries, acpolicy);
            processedEntries = processedEntries.sortByProp('name');

            console.warn('entries after filtering and sorting', processedEntries.length);

            // Performance optimization: Conditional deepify
            try {
                const deepEntries = await global.lists.tools.deepify(processedEntries, { source: group.url }).catch(err => {
                    console.error('Deepify error in renderGroupEntries:', err);
                    return processedEntries;
                });
                if (Array.isArray(deepEntries)) {
                    console.warn('entries after deepify', deepEntries.length, deepEntries);
                    processedEntries = deepEntries.length === 1 ? deepEntries[0].entries : deepEntries;
                }
            } catch (err) {
                console.error('Deepify processing error in renderGroupEntries:', err);
            }

            return processedEntries;
        } catch (err) {
            console.error('Error in renderGroupEntries:', err);
            return [];
        }
    }

    // Performance optimization: Process entries chunk with error handling
    async processEntriesChunk(chunk, group, isSeries) {
        const results = [];
        
        for (const entry of chunk) {
            try {
                let processedEntry = entry;
                
                // Performance optimization: Handle nested entries efficiently
                if (entry.entries) {
                    processedEntry = entry.entries;
                } else if (typeof(entry.renderer) == 'function') {
                    processedEntry = await entry.renderer(entry);
                } else if (typeof(entry.renderer) == 'string') {
                    processedEntry = await storage.get(entry.renderer);
                }
                
                if (Array.isArray(processedEntry)) {
                    results.push(...processedEntry);
                } else if (processedEntry) {
                    results.push(processedEntry);
                }
            } catch (err) {
                console.error('Error processing entry:', entry.name, err);
                // Continue processing other entries
            }
        }
        
        return results;
    }
    async hook(entries, path) {
        if (!path) {
            const liveEntry = { name: lang.LIVE, side: true, fa: 'fas fa-tv', details: '<i class="fas fa-th"></i>&nbsp; ' + lang.ALL_CHANNELS, type: 'group', renderer: this.entries.bind(this) }
            const searchEntry = { name: lang.SEARCH, side: true, fa: 'fas fa-search', type: 'action', action: () => {
                process.nextTick(() => renderer.ui.emit('omni-show'))
            }};
            insertEntry(liveEntry, entries, [lang.MY_LISTS, lang.TOOLS, lang.SEARCH]);
            insertEntry(searchEntry, entries, [lang.MY_LISTS, lang.TOOLS], [lang.TRENDING, lang.LIVE, lang.CATEGORY_MOVIES_SERIES]);
            if (paths.ALLOW_ADDING_LISTS) {
                const moviesEntry = {
                    name: lang.CATEGORY_MOVIES_SERIES,
                    side: true, fa: 'fas fa-th', details: '', type: 'group',
                    renderer: () => this.groupsRenderer('')
                };
                insertEntry(moviesEntry, entries, [lang.OPTIONS, lang.TOOLS, lang.SEARCH], [lang.LIVE]);
            }
        }
        return entries;
    }
}

export default (global.channels || (global.channels = new Channels()))

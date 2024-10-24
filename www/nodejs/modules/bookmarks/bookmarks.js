import { insertEntry, ucWords } from '../utils/utils.js'
import Download from '../download/download.js'
import osd from '../osd/osd.js'
import menu from '../menu/menu.js'
import lang from '../lang/lang.js'
import EntriesGroup from '../entries-group/entries-group.js'
import listsTools from '../lists/tools.js'
import mega from '../mega/mega.js'
import fs from 'fs'
import * as iconv from 'iconv-lite'
import { exec } from 'child_process'
import icons from '../icon-server/icon-server.js'
import jimp from '../jimp-worker/main.js'
import createShortcut from 'create-desktop-shortcuts'
import config from '../config/config.js'
import renderer from '../bridge/bridge.js'
import paths from '../paths/paths.js'

class Bookmarks extends EntriesGroup {
    constructor(channels) {
        super('bookmarks', channels)
        this.storeInConfig = true;
        this.currentBookmarkAddingByName = {
            name: '',
            live: true,
            icon: ''
        };
        renderer.ready(() => {
            renderer.ui.on('toggle-fav', () => {
                if (this.current()) {
                    this.toggle();
                } else {
                    menu.open(lang.BOOKMARKS).catch(e => menu.displayErr(e));
                }
            })
            global.streamer.aboutRegisterEntry('fav', data => {
                if (!data.isLocal) {
                    if (this.has(this.simplify(data))) {
                        return { template: 'option', fa: 'fas fa-star-half', text: lang.REMOVE_FROM.format(lang.BOOKMARKS), id: 'fav' };
                    } else {
                        return { template: 'option', fa: 'fas fa-star', text: lang.ADD_TO.format(lang.BOOKMARKS), id: 'fav' };
                    }
                }
            }, this.toggle.bind(this), 3)
        })
    }
    streamFilter(e) {
        return e.url && (!e.type || e.type == 'stream')
    }
    groupFilter(e) {
        return e.type && e.type == 'group'
    }
    async hook(entries, path) {
        if (!path) {
            const bmEntry = { name: lang.BOOKMARKS, fa: 'fas fa-star', side: true, type: 'group', renderer: this.entries.bind(this) };
            if (this.data.length)
                bmEntry.details = this.data.map(e => e.name).unique().slice(0, 3).join(', ') +'...'
            insertEntry(bmEntry, entries, [lang.OPTIONS, lang.ABOUT], [lang.OPEN_URL, lang.CATEGORY_MOVIES_SERIES, lang.LIVE]);
            return entries
        }
        let isBookmarkable = path.startsWith(lang.CATEGORY_MOVIES_SERIES) || path.startsWith(lang.SEARCH) || path.startsWith(lang.LIVE + '/' + lang.MORE) || path.startsWith(lang.BOOKMARKS);
        if (!isBookmarkable && path.startsWith(lang.MY_LISTS) && !entries.some(this.groupFilter)) {
            isBookmarkable = true;
        }
        if (isBookmarkable && entries.some(this.streamFilter)) {
            let name = path.split('/').pop(), ges = entries.filter(e => e.url);
            if (ges.length) {
                let gs = ges.map(e => e.groupName).unique();
                if (gs.length == 1 && gs[0]) {
                    name = gs[0];
                }
            }
            ges = null;
            let bookmarker, bookmarkable = { name, type: 'group', entries: entries.filter(this.streamFilter) };
            if (this.has(bookmarkable)) {
                bookmarker = {
                    type: 'action',
                    fa: 'fas fa-star-half',
                    name: lang.REMOVE_FROM.format(lang.BOOKMARKS),
                    action: () => {
                        this.remove(bookmarkable);
                        menu.refreshNow();
                        osd.show(lang.BOOKMARK_REMOVED.format(bookmarkable.name), 'fas fa-star-half', 'bookmarks', 'normal');
                    }
                };
            } else if (!path.includes(lang.BOOKMARKS)) {
                bookmarker = {
                    type: 'action',
                    fa: 'fas fa-star',
                    name: lang.ADD_TO.format(lang.BOOKMARKS),
                    action: () => {
                        this.add(bookmarkable);
                        menu.refreshNow();
                        osd.show(lang.BOOKMARK_ADDED.format(bookmarkable.name), 'fas fa-star', 'bookmarks', 'normal');
                    }
                };
            }
            if (bookmarker)
                entries.unshift(bookmarker);
        }
        return entries;
    }
    toggle() {
        let data = this.current();
        if (data) {
            if (this.has(data)) {
                this.remove(data);
                osd.show(lang.BOOKMARK_REMOVED.format(data.name), 'fas fa-star-half', 'bookmarks', 'normal');
            } else {
                this.add(data);
                osd.show(lang.BOOKMARK_ADDED.format(data.name), 'fas fa-star', 'bookmarks', 'normal');
            }
            menu.refreshNow();
        }
    }
    current() {        
        if (global.streamer.active) {
            return this.simplify(global.streamer.active.data);
        } else {
            let streams = menu.currentEntries.filter(e => e.url);
            if (streams.length) {
                return this.simplify(streams[0]);
            }
        }
    }
    simplify(e) {
        if (e.type == 'group') {
            return this.cleanAtts(e);
        }
        return {
            name: e.originalName || e.name,
            type: 'stream', details: e.group || '',
            icon: e.originalIcon || e.icon || '',
            terms: { 'name': this.channels.entryTerms(e, true) },
            url: e.originalUrl || e.url
        }
    }
    search(terms) {
        return new Promise((resolve, reject) => {
            if (typeof(terms) == 'string') {
                terms = listsTools.terms(terms);
            }
            this.get().forEach(e => {
            });
        });
    }
    async entries() {        
        let es = [], current;
        if (streamer && global.streamer.active) {
            current = global.streamer.active.data
        }
        if (!current) {
            let cs = this.channels.history.get().filter(c => {
                return !this.has(c)
            });
            if (cs.length) {
                current = cs.shift()
            }
        }
        if (current && !this.has(current)) {
            es.push({
                name: lang.ADD + ': ' + current.name,
                fa: 'fas fa-star', icon: current.icon, type: 'action',
                action: () => {
                    this.add(current)
                    menu.refreshNow()
                }
            })
        }
        es.push({ name: lang.ADD_BY_NAME, fa: 'fas fa-star', type: 'group', renderer: this.addByNameEntries.bind(this) });
        const epgAddLiveNowMap = {};
        let gentries = this.get().map((e, i) => {
            const isMega = e.url && mega.isMega(e.url);
            e.fa = 'fas fa-star';
            e.details = '<i class="fas fa-star"></i> ' + e.bookmarkId;
            if (isMega) {
                let atts = mega.parse(e.url);
                if (atts.mediaType == 'live') {
                    return (epgAddLiveNowMap[i] = this.channels.toMetaEntry(e, false));
                } else {                    
                    let terms = atts.terms && Array.isArray(atts.terms) ? atts.terms : listsTools.terms(atts.name);
                    e.url = mega.build(ucWords(terms.join(' ')), { terms, mediaType: 'video' });
                    e = this.channels.toMetaEntry(e);
                }
            } else if (e.type != 'group') {
                e.type = 'stream';
            }
            return e;
        }).sortByProp('bookmarkId')
        let err;
        const entries = await this.channels.epgChannelsAddLiveNow(Object.values(epgAddLiveNowMap), false).catch(e => err = e);
        if (!err) {
            const ks = Object.keys(epgAddLiveNowMap);
            entries.forEach((e, i) => {
                gentries[ks[i]] = e;
            });
        }
        es.push(...gentries);
        if (gentries.length) {
            let centries = []
            if (!paths.android && config.get('bookmarks-desktop-icons')) {
                centries.push({ name: lang.BOOKMARK_ICONS_SYNC, fa: 'fas fa-sync-alt', type: 'action', action: () => this.desktopIconsSync().catch(console.error) });
            }
            centries.push(...[
                { name: lang.SET_SHORTCUT_NUMBERS, fa: 'fas fa-list-ol', type: 'group', renderer: this.shortcutNumberEntries.bind(this) },
                { name: lang.BOOKMARK_CREATE_DESKTOP_ICONS, type: 'check', action: (_, value) => {
                        config.set('bookmarks-desktop-icons', value)
                    },
                    checked: () => {
                        return config.get('bookmarks-desktop-icons')
                    }
                },
                { name: lang.REMOVE, fa: 'fas fa-trash', type: 'group', renderer: this.removalEntries.bind(this) }
            ])
            es.push({
                name: lang.CONFIGURE,
                fa: 'fas fa-cog',
                type: 'group',
                entries: centries
            })
        }
        return es
    }
    async shortcutNumberEntries() {
        const entries = []
        this.get().forEach(e => {
            if (e.name) {
                entries.push({
                    name: e.name,
                    details: lang.SHORTCUT_NUMBER +': '+ e.bookmarkId,
                    fa: 'fas fa-star',
                    type: 'action',
                    action: async () => {
                        let n = await global.menu.prompt({
                            question: lang.SHORTCUT_NUMBER,
                            placeholder: e.bookmarkId,
                            defaultValue: e.bookmarkId,
                            fa: 'fas fa-list-ol'
                        })
                        if(n) {
                            n = parseInt(n)
                            if(!isNaN(n) && n >= 0 && n != e.bookmarkId) {
                                this.data = this.data.map(t => {
                                    if(t.bookmarkId == e.bookmarkId && e.name == t.name) {
                                        t.bookmarkId = n
                                    }
                                    return t
                                })
                                this.save()
                                global.menu.refreshNow()
                            }
                        }
                    }
                });
            }
        });
        return entries;
    }
    async addByNameEntries() {
        return [
            { name: lang.CHANNEL_OR_CONTENT_NAME, type: 'input', value: this.currentBookmarkAddingByName.name, action: (data, value) => {
                    this.currentBookmarkAddingByName.name = value;
                } },
            { name: lang.ADVANCED, type: 'select', fa: 'fas fa-cog', entries: [
                    { name: lang.STREAM_URL, type: 'input', value: this.currentBookmarkAddingByName.url, details: lang.LEAVE_EMPTY, placeholder: lang.LEAVE_EMPTY, action: (data, value) => {
                            this.currentBookmarkAddingByName.url = value;
                        } },
                    { name: lang.ICON_URL, type: 'input', value: this.currentBookmarkAddingByName.icon, details: lang.LEAVE_EMPTY, placeholder: lang.LEAVE_EMPTY, action: (data, value) => {
                            this.currentBookmarkAddingByName.icon = value;
                        } }
                ] },
            { name: lang.LIVE, type: 'check', checked: () => {
                    return this.currentBookmarkAddingByName.live;
                }, action: (e, value) => {
                    this.currentBookmarkAddingByName.live = value;
                } },
            { name: lang.SAVE, fa: 'fas fa-check-circle', type: 'group', renderer: this.addByNameEntries2.bind(this) }
        ];
    }
    async addByNameEntries2() {
        if (!this.currentBookmarkAddingByName.name) {
            setTimeout(() => {
                menu.back(2);
            }, 50)
            return []
        }
        let err, results = await global.lists.search(this.currentBookmarkAddingByName.name, {
            partial: true,
            group: !this.currentBookmarkAddingByName.live,
            safe: !global.lists.parentalControl.lazyAuth(),
            limit: 1024
        })
        if(err) {
            this.addByNameEntries3({ value: this.currentBookmarkAddingByName.icon }, 1)
            return []
        }
        if (!this.currentBookmarkAddingByName.url || !this.currentBookmarkAddingByName.url.includes('/')) {
            let mediaType = 'all', entries = [];
            if (this.currentBookmarkAddingByName.live) {
                mediaType = 'live';
            } else {
                mediaType = 'video';
            }
            this.currentBookmarkAddingByName.url = mega.build(this.currentBookmarkAddingByName.name, { mediaType });
        }
        if (config.get('show-logos') && (!this.currentBookmarkAddingByName.icon || !this.currentBookmarkAddingByName.icon.includes('/'))) {
            let entries = []
            Array.from(new Set(results.map(entry => { return entry.icon; }))).slice(0, 96).forEach((logoUrl, i) => {
                entries.push({
                    name: lang.SELECT_ICON +' #'+ (i + 1),
                    fa: 'fa-mega spin-x-alt',
                    icon: logoUrl,
                    url: logoUrl,
                    value: logoUrl,
                    type: 'action',
                    iconFallback: 'fas fa-exclamation-triangle',
                    action: this.addByNameEntries3.bind(this)
                });
            });
            if (entries.length) {
                entries.push({
                    name: lang.NO_ICON,
                    type: 'action',
                    fa: 'fas fa-ban',
                    url: '',
                    action: () => {
                        this.addByNameEntries3({ value: '' });
                    }
                });
                return entries
            } else {
                this.addByNameEntries3({ value: this.currentBookmarkAddingByName.icon }, 1);
            }
        }
        return []            
    }
    addByNameEntries3(e, n) {
        let backLvl = typeof(n) == 'number' ? n : 2;
        this.currentBookmarkAddingByName.icon = e.value;
        this.add({
            name: this.currentBookmarkAddingByName.name,
            icon: this.currentBookmarkAddingByName.icon,
            url: this.currentBookmarkAddingByName.url
        });
        this.currentBookmarkAddingByName = {
            name: '',
            live: true,
            icon: ''
        };
        menu.back(backLvl);
    }
    prepare(_entries) {
        var knownBMIDs = [], entries = _entries.slice(0);
        entries.forEach((bm, i) => {
            if (typeof(bm.bookmarkId) == 'string') {
                bm.bookmarkId = parseInt(bm.bookmarkId);
            }
            if (typeof(bm.bookmarkId) != 'undefined') {
                knownBMIDs.push(bm.bookmarkId);
            }
        });
        entries.forEach((bm, i) => {
            if (typeof(bm.bookmarkId) == 'undefined') {
                var j = 1;
                while (knownBMIDs.includes(j)) {
                    j++;
                }
                knownBMIDs.push(j);
                entries[i].bookmarkId = j;
            }
        });
        return entries.slice(0).sortByProp('bookmarkId');
    }
    async desktopIconsSync() {
        osd.show(lang.PROCESSING, 'fas fa-circle-notch fa-spin', 'bookmarks-desktop-icons', 'persistent');
        for (const e of this.get()) {
            await this.createDesktopShortcut(e).catch(console.error);
        }
        osd.show('OK', 'fas fa-check-circle faclr-green', 'bookmarks-desktop-icons', 'normal');
    }
    getWindowsDesktop() {
        return new Promise((resolve, reject) => {
            const command = 'REG QUERY "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders" /v Desktop';
            const child = exec(command, { encoding: 'buffer' }, (error, stdout, stderr) => {
                if (error) {
                    return reject('Error querying registry:' + error);
                }
                const output = iconv.decode(stdout, 'cp850'); // 'cp850' is the default command prompt encoding
                const outputLines = output.split('\n');
                const desktopDirLine = outputLines.find(line => line.includes('REG_SZ'));
                if (!desktopDirLine)
                    return reject('Folder not found');
                const desktopDir = desktopDirLine.match(new RegExp('REG_SZ +(.*)'));
                const desktopPath = desktopDir ? desktopDir[1] : null;
                if (!desktopPath)
                    return reject('Folder not found');
                if (!fs.existsSync(desktopPath))
                    return reject('Folder not exists: ' + desktopPath);
                resolve(desktopPath);
            });
            child.stdout.setEncoding('binary');
            child.stderr.setEncoding('binary');
        });
    }
    async createDesktopShortcut(entry) {
        if (paths.android || !config.get('bookmarks-desktop-icons'))
            return;
        let outputPath, icon = paths.cwd + '/default_icon.png';
        if (process.platform == 'win32') {
            const folder = await this.getWindowsDesktop().catch(console.error);
            if (typeof(folder) == 'string') {
                outputPath = folder;
            }
            icon = paths.cwd + '/default_icon.ico';
        }
        let err, noEPGEntry = entry;
        if (noEPGEntry.programme)
            delete noEPGEntry.programme;
        const nicon = await icons.get(noEPGEntry).catch(e => err = e);
        if (!err) {
            if (!nicon.file) {                
                const file = await Download.file({ url: nicon.url });
                const stat = await fs.promises.stat(file).catch(e => err = e);
                if (!err && stat.size >= 512) {
                    nicon.file = file;
                }
            }
            if (nicon.file) {
                const file = await jimp.iconize(nicon.file).catch(e => err = e);
                if (!err) {
                    icon = file;
                    const cachedFile = await icons.saveDefaultIcon(global.channels.entryTerms(entry, true), file, true).catch(e => err = e);
                    if (!err && cachedFile) {
                        icon = cachedFile;
                    }
                }
            }
        }
        const values = {
            name: entry.name,
            filePath: process.execPath,
            arguments: '"' + entry.url + '"',
            icon,
            outputPath
        };
        const options = {
            windows: values,
            linux: values,
            osx: values
        };
        createShortcut(options);
    }
    add(entry) {
        super.add(entry);
        this.createDesktopShortcut(entry).catch(console.error);
        this.channels.updateUserTasks().catch(console.error);
    }
}
export default Bookmarks;

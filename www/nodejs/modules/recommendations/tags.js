import { EventEmitter } from 'node:events'
import PQueue from 'p-queue'
import fs from 'fs'
import listsTools from '../lists/tools.js'
import gravitationalGroups from './gravitational-groups.json' with { type: 'json' }

export class Tags extends EventEmitter{
    constructor() {
        super()
        this.caching = {programmes: {}, trending: {}}
        this.defaultTagsCount = 256
        this.queue = new PQueue({concurrency: 1})
        global.channels.history.epg.on('change', () => this.historyUpdated(true))
        global.channels.trending.on('update', () => this.trendingUpdated(true))
        global.channels.on('loaded', () => this.reset())
    }
    async reset() {
        if(this.queue.size) {
            return this.queue.onIdle()
        }
        return this.queue.add(async () => {
            await this.historyUpdated(false)
            await this.trendingUpdated(true)
        })
    }
    prepare(data, limit) {
        const maxWords = 3
        return Object.fromEntries(
            Object.entries(data)
                .filter(([key, value]) => key.split(' ').length <= maxWords)
                .sort(([, valueA], [, valueB]) => valueB - valueA) 
                .slice(0, limit)
        )
    }    
    async historyUpdated(emit) {
        let data0 = {}, data = {}
        const historyData = global.channels.history.epg.data.slice(-6);

        historyData.forEach(row => {
            const name = row.originalName || row.name;
            const category = global.channels.getChannelCategory(name);
            if (category) {
                data[category] = (data[category] || 0) + row.watched.time;
            }

            const cs = row.watched?.categories || [];
            if (category && !cs.includes(category)) {
                cs.push(category);
            }
            if (row.groupName && !cs.includes(row.groupName)) {
                cs.push(row.groupName);
            }            
            if(row?.watched?.name) {
                const terms = listsTools.terms(row.watched.name, true, false)
                cs.push(...terms.filter(t => t.length > 2))
            }
            cs.forEach(cat => {
                if (cat) {
                    const lc = cat.toLowerCase();
                    data0[lc] = (data0[lc] || 0) + (row.watched ? row.watched.time : 180);
                }
            });
        });

        data = this.equalize(data)
        data0 = this.equalize(data0)        
        for (const k in data) {
            data0[k] = Math.max(data0[k] || 0, data[k]);
        }

        this.caching.programmes = await this.expand(data0);
        emit && this.emit('updated');
    }
    async trendingUpdated(emit) {
        let trendingPromise = true;
        if (!global.channels.trending.currentRawEntries) {
            trendingPromise = global.channels.trending.getRawEntries();
        }
        let searchPromise = this.searchSuggestionEntries || global.channels.search.searchSuggestionEntries().then(data => this.searchSuggestionEntries = data);
        await Promise.allSettled([trendingPromise, searchPromise]).catch(err => console.error(err));

        const map = {};
        const addToMap = (terms, value) => {
            terms.forEach(t => {
                if (t.startsWith('-')) return;
                map[t] = (map[t] || 0) + value;
            });
        };

        if (Array.isArray(global.channels.trending.currentRawEntries)) {
            global.channels.trending.currentRawEntries.forEach(e => addToMap(global.channels.entryTerms(e), e.users));
        }

        if (Array.isArray(this.searchSuggestionEntries)) {
            this.searchSuggestionEntries.forEach(e => addToMap([e.search_term], e.cnt));
        }

        this.caching.trending = await this.expand(this.equalize(map));
        emit && this.emit('updated');
    }
    equalize(tags) {
        const max = Math.max(...Object.values(tags))
        return Object.fromEntries(
            Object.entries(tags).sort(([, valueA], [, valueB]) => valueB - valueA).map(([key, value]) => [key, value / max])
        )
    }
    async expand(tags) {
        let err, additionalTags = {}            
        const limit = this.defaultTagsCount
        const additionalLimit = limit - Object.keys(tags).length
        if (additionalLimit > 0) {
            try {
                // try first using Trias module from epg worker, preferred for better results
                const relatedCategories = await global.lists.epg.expandTags(tags, {as: 'objects', amount: additionalLimit})
                if (!err && relatedCategories) {
                    relatedCategories.forEach(t => {
                        t.category = t.category.toLowerCase()
                        if(tags[t.category]) {
                            return
                        }
                        if(typeof(additionalTags[t.category]) == 'undefined') {
                            additionalTags[t.category] = 0
                        }
                        additionalTags[t.category] += t.score / 2 // divide by 2 to pump up the direct tags
                    })
                    additionalTags = this.prepare(additionalTags, additionalLimit)
                    Object.assign(tags, additionalTags)
                }
            } catch(e) {
                console.error(e)
            }
        }
        return tags
    }
    async get(limit) {
        if(typeof(limit) != 'number') {
            limit = this.defaultTagsCount
        }
        const programmeTags = this.prepare(this.caching.programmes, limit)
        if (Object.keys(programmeTags).length < limit) {
            Object.assign(programmeTags, this.caching.trending)
        }
        return this.prepare(programmeTags, limit)
    }
}
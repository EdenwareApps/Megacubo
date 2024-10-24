import fs from "fs";
import ListIndexUtils from "./list-index-utils.js";
import { Database } from "jexidb"

class ListIndex extends ListIndexUtils {
    constructor(file, url) {
        super();
        this.url = url
        this.file = file
    }
    fail(err) {
        this.hasFailed = err;
        if (this.listenerCount('error')) {
            this.emit('error', err);
        }
        this.emit('end');
    }
    async entries(map) {
        await this.ready()
        await this.db.ready()
        if(!map) map = Array.from({length: this.db.length}, (_, i) => i)
        return await this.db.query(map)
    }
    async getMap(map) {
        await this.ready()
        const entries = []
        for await (const e of this.db.walk(map)) {
            if(e && e.name) {
                entries.push({
                    group: e.group,
                    name: e.name,
                    _: e._
                })
            }
        }
        if (entries.length) {
            entries[0].source = this.url
        }
        return entries
    }
    async expandMap(structure) {
        const map = [], tbl = {}, ntypes = ['string', 'number']
        for (let i in structure) {
            const t = typeof(structure[i]._)
            if (ntypes.includes(t) && !structure[i].url) {
                if (t != 'number') {
                    structure[i]._ = parseInt(structure[i]._)
                }
                tbl[structure[i]._] = i
                map.push(structure[i]._)
            }
        }
        if (map.length) {
            map.sort()
            await this.ready()
            const xs = await this.entries(map)
            for (let x = 0; x < xs.length; x++) {
                let i = tbl[xs[x]._];
                Object.assign(structure[i], xs[x]);
                structure[i]._ = xs[x]._ = undefined;
            }
        }
        return structure;
    }
    async start() {
        let err
        const stat = await fs.promises.stat(this.file).catch(e => err = e)
        if (stat && stat.size) {
            if(!this.db) {
                this.db = new Database(this.file, {
                    index: {
                        length: 0,
                        uniqueStreamsLength: 0,
                        terms: {},
                        groups: {},
                        meta: {},
                        gids: {}
                    },
                    v8: false,
                    compressIndex: false
                })
            }
            const ret = await this.db.init()
            this.isReady = true
            this.emit('ready')
            return ret
        } else {
            throw 'file not found or empty ' + this.file + ' ' + err
        }
    }
    async ready() {
        if(this.isReady) return
        await new Promise(resolve => {
            const clear = () => {
                this.removeListener('ready', resolveListener)
                this.removeListener('destroy', rejectListener)
            }
            const resolveListener = () => {
                clear()
                resolve()
            }
            const rejectListener = () => {
                clear()
                reject('destroyed')
            }
            this.once('ready', resolveListener)
            this.once('destroy', rejectListener)            
        })
    }
    destroy() {
        if (!this.destroyed) {
            this.destroyed = true
            this.emit('destroy')
            this.removeAllListeners()
            this.db && this.db.destroy()
            this._log = []
        }
    }
    get index() {
        return (this.db && !this.db.destroyed) ? this.db.index : {}
    }
    get length() {
        return (this.db && !this.db.destroyed) ? this.db.length : 0
    }
}
export default ListIndex;

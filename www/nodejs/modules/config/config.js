import { EventEmitter } from 'events';
import fs from "fs";
import path from "path";
import defaults from './defaults.json' assert { type: 'json' }
import paths from '../paths/paths.js'
import { deepClone, parseJSON } from "../utils/utils.js";

class Config extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(20);
        this.debug = false;
        this.loaded = false;
        this.file = paths.data +'/config.json';
        this.defaults = defaults;
        this.data = Object.assign({}, this.defaults); // keep defaults object for reference
        for (var key in this.data) {
            let def = typeof (this.defaults[key]);
            if (def != 'undefined' && def != typeof (this.data[key])) {
                console.error('Invalid value for', key, this.data[key], 'is not of type ' + def);
                this.data[key] = this.defaults[key];
            }
        }
        this.load();
    }
    reset() {
        fs.unlink(this.file, () => {});
        this.data = Object.assign({}, this.defaults);
    }
    load(txt) {
        if (!this.loaded) {
            if (txt || fs.existsSync(this.file)) {
                this.loaded = true;
                let data = typeof (txt) == 'string' ? txt : fs.readFileSync(this.file, 'utf8');
                if (data) {
                    if (Buffer.isBuffer(data)) { // is buffer
                        data = String(data);
                    }
                    if (this.debug) {
                        console.log('DATA', data);
                    }
                    if (typeof (data) == 'string' && data.length > 2) {
                        data = data.replace(new RegExp("\n", "g"), '');
                        //data = stripBOM(data.replace(new RegExp("([\r\n\t]| +)", "g"), "")); // with \n the array returns empty (?!)
                        data = parseJSON(data)
                        if (typeof (data) == 'object' && data) {
                            this.data = Object.assign({}, this.defaults);
                            this.data = Object.assign(this.data, data);
                        }
                    }
                }
            }
        }
    }
    extend(data) {
        this.defaults = Object.assign(data, this.defaults);
        this.data = Object.assign(data, this.data);
        if (this.debug) {
            console.log('CONFIG EXTENDED', this.defaults, this.data);
        }
    }
    reload(txt) {
        let oldData;
        if (this.loaded) {
            oldData = Object.assign({}, this.data);
        }
        this.loaded = false;
        this.load(txt);
        if (oldData) {
            let changed = [];
            Object.keys(oldData).forEach(k => {
                if (!this.equal(oldData[k], this.data[k])) {
                    changed.push(k);
                }
            });
            if (changed.length) {
                this.emit('change', changed, this.data);
            }
        }
    }
    equal(a, b) {
        if (a instanceof Object && b instanceof Object) {
            if (JSON.stringify(a) != JSON.stringify(b)) {
                return false;
            }
        } else if (a != b) {
            return false;
        }
        return true;
    }
    keys() {
        return Object.keys(this.defaults).concat(Object.keys(this.data)).sort().unique();
    }
    all() {
        this.load();
        var data = {};
        this.keys().forEach(key => {
            data[key] = typeof (this.data[key]) != 'undefined' ? this.data[key] : this.defaults[key];
        });
        return data;
    }
    get(key) {
        this.load();
        //console.log('DATAb', JSON.stringify(data))
        var t = typeof (this.data[key]);
        if (t == 'undefined') {
            this.data[key] = this.defaults[key];
            t = typeof (this.defaults[key]);
        }
        if (t == 'undefined') {
            return null;
        } else if (t == 'object') { // avoid referencing
            return deepClone(this.data[key]);
        }
        return this.data[key];
    }
    set(key, val) {
        this.load();
        // avoid referencing on val
        let nval;
        if (typeof (val) == 'object') {
            nval = deepClone(val);
        } else {
            nval = val;
        }
        const equals = this.equal(this.data[key], nval);
        if (!equals) {
            this.data[key] = nval;
            this.save();
            this.emit('change', [key], this.data);
        }
    }
    setMulti(atts) {
        this.load();
        let changed = [];
        Object.keys(atts).forEach(k => {
            let d = typeof (this.data[k]);
            if ((d == 'undefined' || d == typeof (atts[k])) && !this.equal(this.data[k], atts[k])) {
                this.data[k] = atts[k];
                changed.push(k);
            }
        });
        if (changed.length) {
            this.save();
            this.emit('change', changed, this.data);
        }
    }
    save() {
        const userConfig = {}        
        Object.keys(this.data).forEach(k => {
            if (!this.equal(this.data[k], this.defaults[k])) {
                userConfig[k] = this.data[k];
            }
        });
        if (!fs.existsSync(path.dirname(this.file))) {
            fs.mkdirSync(path.dirname(this.file), {
                recursive: true
            });
        }
        if (this.debug) {
            console.log('SAVE', userConfig);
        }
        try { // Error: EPERM: operation not permitted, open '[...]/config.json'
            if (fs.existsSync(this.file)) {
                fs.truncateSync(this.file, 0);
            }
            try {
                const jso = JSON.stringify(Object.assign({}, userConfig), null, 3);
                fs.writeFileSync(this.file, jso, 'utf8');
            }
            catch (e) {
                console.error(e);
            }
        }
        catch (e) {
            console.error(e);
        }
    }
}

export default new Config()

import { moveFile } from "../utils/utils.js";
import paths from "../paths/paths.js";
import os from "os";
import fs from "fs";
import FormData from "form-data";
import http from "http";
import cloud from "../cloud/cloud.js";

class Crashlog {
    constructor() {
        const { data: folder } = paths;
        this.crashFile = folder + '/crash.txt'; // unreported crashes
        this.crashLogFile = folder + '/crashlog.txt'; // reported crashes
    }
    replaceCircular(val, cache) {
        cache = cache || new WeakSet();
        if (val && typeof (val) == 'object') {
            if (cache.has(val))
                return '[Circular]';
            cache.add(val);
            var obj = (Array.isArray(val) ? [] : {});
            for (var idx in val) {
                obj[idx] = this.replaceCircular(val[idx], cache);
            }
            if (val['stack']) {
                obj['stack'] = this.replaceCircular(val['stack']);
            }
            cache.delete(val);
            return obj;
        }
        return val;
    }
    save(...args) {
        let revision = '10000'
        if(paths.manifest.megacubo && paths.manifest.megacubo.revision) {
            revision = paths.manifest.megacubo.revision
        }
        fs.appendFileSync(this.crashFile, this.stringify(Array.from(args)).replaceAll("\\n", "\n") + "\r\n" + JSON.stringify({
            version: paths.manifest ? paths.manifest.version : '',
            platform: process.platform, 
            release: os.release(), arch: os.arch(), revision,
            date: (new Date()).toString(),
            lang: typeof (lang) != 'undefined' && lang ? lang.locale : ''
        }) + "\r\n\r\n");
    }
    stringify(data) {
        return JSON.stringify(this.replaceCircular(data), (key, value) => {
            if (value instanceof Error) {
                var error = {};
                Object.getOwnPropertyNames(value).forEach(function (propName) {
                    error[propName] = value[propName];
                });
                return error;
            }
            return value;
        }, 3);
    }
    async read() {        
        let content = '';
        for (let file of [this.crashFile, this.crashLogFile]) {
            let text = await fs.promises.readFile(file).catch(console.error);
            if (text) { // filter "undefined"
                content += text;
            }
        }
        return content;
    }
    post(content) {
        return new Promise((resolve, reject) => {
            const form = new FormData();
            form.append('log', String(content));
            const { server } = cloud;
            const options = {
                method: 'post',
                host: server.split('/').pop(),
                path: '/report/index.php',
                headers: form.getHeaders()
            };
            let resolved, req = http.request(options, res => {
                res.setEncoding('utf8');
                let data = '';
                res.on('data', (d) => {
                    data += d;
                });
                res.once('end', () => {
                    if (data.indexOf('OK') != -1) {                        
                        fs.stat(this.crashLogFile, (err, stat) => {
                            if (stat && stat.file) {
                                fs.appendFile(this.crashLogFile, content, () => {
                                    fs.unlink(this.crashFile, () => {});
                                });
                            } else {
                                moveFile(this.crashFile, this.crashLogFile).catch(console.error)
                            }
                        });
                        if (!resolved) {
                            resolved = true;
                            resolve(true);
                        }
                    } else {
                        if (!resolved) {
                            resolved = true;
                            reject('Invalid crash logging response');
                        }
                    }
                });
            });
            req.on('error', (e) => {
                console.error('Houve um erro', e);
                if (!resolved) {
                    resolved = true;
                    reject(e);
                }
            });
            form.pipe(req);
            req.end();
        });
    }
    async send() {        
        const stat = await fs.promises.stat(this.crashFile).catch(() => {})
        if (stat && stat.size) {
            const content = await fs.promises.readFile(this.crashFile)
            await this.post(content)
        }
    }
}
export default new Crashlog();

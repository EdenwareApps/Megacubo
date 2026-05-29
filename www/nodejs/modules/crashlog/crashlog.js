import { moveFile } from "../utils/utils.js";
import paths from "../paths/paths.js";
import os from "os";
import fs from "fs";
import https from "https";
import http from "http";
import cloud from "../cloud/cloud.js";
import { stringify } from "../serialize/serialize.js";

class Crashlog {
    constructor() {
        const { data: folder } = paths;
        this.crashFile = folder + '/crash.txt'; // unreported crashes
        this.crashLogFile = folder + '/crashlog.txt'; // reported crashes
    }
    save(...args) {
        let revision = '10000'
        if(paths.manifest.megacubo && paths.manifest.megacubo.revision) {
            revision = paths.manifest.megacubo.revision
        }
        fs.appendFileSync(this.crashFile, stringify(Array.from(args)).replaceAll("\\n", "\n") + "\r\n" + stringify({
            version: paths.manifest ? paths.manifest.version : '',
            platform: process.platform, 
            release: os.release(), arch: os.arch(), revision,
            date: (new Date()).toString(),
            lang: typeof(lang) != 'undefined' && lang ? lang.locale : ''
        }) + "\r\n\r\n");
    }
    async read() {        
        let content = '';
        for (let file of [this.crashFile, this.crashLogFile]) {
            let text = await fs.promises.readFile(file).catch(err => console.error(err));
            if (text) { // filter "undefined"
                content += text;
            }
        }
        return content;
    }
    post(content) {
        return new Promise((resolve, reject) => {
            const serverUrl = cloud.server && cloud.server.toString().trim()
                ? cloud.server
                : 'https://stats.megacubo.net'
            const url = new URL(serverUrl.startsWith('http') ? serverUrl : `https://${serverUrl}`)
            const body = JSON.stringify({ log: String(content) })
            const reportPath = `${url.pathname.replace(/\/$/, '')}/report`
            const protocol = url.protocol === 'https:' ? https : http

            const options = {
                method: 'POST',
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: reportPath,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                }
            }

            let resolved = false
            const req = protocol.request(options, res => {
                res.setEncoding('utf8');
                let data = '';
                res.on('data', (d) => {
                    data += d;
                });
                res.once('end', () => {
                    if (data.includes('OK')) {
                        fs.stat(this.crashLogFile, (err, stat) => {
                            if (stat && stat.file) {
                                fs.appendFile(this.crashLogFile, content, () => {
                                    fs.unlink(this.crashFile, () => {})
                                })
                            } else {
                                moveFile(this.crashFile, this.crashLogFile).catch(err => console.error(err))
                            }
                        })
                        if (!resolved) {
                            resolved = true
                            resolve(true)
                        }
                    } else {
                        if (!resolved) {
                            resolved = true
                            reject('Invalid crash logging response')
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
            req.write(body)
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

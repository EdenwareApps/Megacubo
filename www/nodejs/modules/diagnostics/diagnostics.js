import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { deepClone, kbfmt } from '../utils/utils.js';
import { default as cds } from 'check-disk-space';
import osd from '../osd/osd.js'
import menu from '../menu/menu.js'
import lang from '../lang/lang.js';
import lists from '../lists/lists.js';
import crashlog from '../crashlog/crashlog.js';
import fs from 'fs';
import downloads from '../downloads/downloads.js';
import options from '../options/options.js';
import config from '../config/config.js'
import paths from '../paths/paths.js'
import { ready } from '../bridge/bridge.js'

class Diagnostics extends EventEmitter {
    constructor() {
        super();
        const { temp } = paths;
        this.folder = temp;
        this.minDiskSpaceRequired = 512 * (1024 * 1024); // 512MB
        this.minFreeMemoryRequired = 350 * (1024 * 1024); // 350MB
        this.lowDiskSpaceWarnInterval = 5 * 50; // 5min
        ready(() => this.checkDiskUI().catch(console.error))
    }
    async report() {
        const version = paths.manifest.version;
        const diskSpace = await this.checkDisk();
        const freeMem = kbfmt(await this.checkMemory());
        const configs = deepClone(config.data);
        const listsInfo = lists.info(true);
        const myLists = configs.lists.map(a => a[1]);
        const listsRequesting = lists.requesting;
        const tuning = global.streamer.tuning ? global.streamer.tuning.logText(false) : ''
        const processedLists = lists.processedLists.keys()
        const loaded = lists.loaded(true)
        const channelListType = global.channels.channelList ? global.channels.channelList.type : 'no channelList loaded'
        const processing = lists.loader.processes.filter(p => p.started() && !p.done()).map(p => {
            return {
                url: p.url,
                priority: p.priority
            };
        })
        let err, crashlogContent = await crashlog.read().catch(e => err = e)
        const crashLog = crashlogContent || err || 'Empty'
        const updaterResults = lists.loader.results, privateLists = [];
        ['lists', 'parental-control-terms', 'parental-control-pw', 'premium-license'].forEach(k => delete configs[k]);
        Object.keys(listsInfo).forEach(url => {
            listsInfo[url].owned = myLists.includes(url);
            if (listsInfo[url].private) {
                privateLists.push(url)
            }
        });
        if (diskSpace && diskSpace.size) {
            diskSpace.free = kbfmt(diskSpace.free)
            diskSpace.size = kbfmt(diskSpace.size)
        }
        let report = { version, diskSpace, freeMem, configs, channelListType, loaded, listsInfo, listsRequesting, updaterResults, processedLists, processing, tuning, crashLog };
        report = JSON.stringify(report, null, 3);
        privateLists.forEach(url => {
            report = report.replace(url, 'http://***')
        });
        return report
    }
    async saveReport() {
        const file = downloads.folder + '/megacubo-report.txt';
        const report = await this.report();
        await fs.promises.writeFile(file, report, { encoding: 'utf8' });
        downloads.serve(file, true, false).catch(e => menu.displayErr(e));
        renderer.get().emit('clipboard-write', report);
        console.error('REPORT => ' + report);
    }
    async checkDisk() {
        return cds(this.folder); // {diskPath: 'C:', free: 12345678, size: 98756432}
    }
    checkDiskOSD() {
        this.checkDisk().then(data => {
            let fine = data.free >= this.minDiskSpaceRequired;
            if (!fine) {
                osd.show(lang.LOW_DISK_SPACE_AVAILABLE.format(kbfmt(data.free)), 'fas fa-exclamation-triangle faclr-red', 'diag', 'long');
            }
        }).catch(console.error);
    }
    async checkDiskUI(force) {
        let data = await this.checkDisk()
        let fine = data.free >= this.minDiskSpaceRequired
        if (!fine || force) {
            menu.dialog([
                { template: 'question', text: paths.manifest.window.title, fa: 'fas fa-exclamation-triangle faclr-red' },
                { template: 'message', text: lang.LOW_DISK_SPACE_AVAILABLE.format(kbfmt(data.free)) },
                { template: 'option', text: lang.CLEAR_CACHE, id: 'clear' },
                { template: 'option', text: 'OK', id: 'ok' }
            ], 'ok').then(ret => {
                if (ret == 'clear') {
                    options.requestClearCache();
                }
            }).catch(console.error); // dont wait
            // {diskPath: 'C:', free: 12345678, size: 98756432}
        }
        return fine;
    }
    checkMemory() {
        return new Promise((resolve, reject) => {
            if (process.platform == 'win32') {
                exec('wmic OS get FreePhysicalMemory', (err, stdout) => {
                    if (err) {
                        return reject('checkMemory err:' + String(err));
                    }
                    let data = stdout.split("\n");
                    if (data.length > 1) {
                        resolve(parseInt(data[1].trim()) * 1024);
                    } else {
                        reject('checkMemory err: bad data, ' + String(data));
                    }
                });
            } else {
                exec('free -b', (err, stdout) => {
                    if (err) {
                        return reject('checkMemory err:' + String(err));
                    }
                    let data = stdout.match(new RegExp('Mem: +[0-9]+ +[0-9]+ +([0-9]+)'));
                    if (data && data.length > 1) {
                        resolve(parseInt(data[1].trim()));
                    } else {
                        reject('checkMemory err: bad data, ' + String(data));
                    }
                });
            }
        });
    }
    async checkMemoryUI(force) {
        let freeBytes = await this.checkMemory();
        let fine = freeBytes >= this.minFreeMemoryRequired;
        if (!fine || force) {
            menu.dialog([
                { template: 'question', text: paths.manifest.window.title, fa: 'fas fa-exclamation-triangle faclr-red' },
                { template: 'message', text: lang.LOW_MEMORY_AVAILABLE.format(kbfmt(freeBytes)) },
                { template: 'option', text: 'OK', id: 'ok' }
            ], 'ok').catch(console.error); // dont wait
            // {diskPath: 'C:', free: 12345678, size: 98756432}
        }
        return fine;
    }
}
export default new Diagnostics();

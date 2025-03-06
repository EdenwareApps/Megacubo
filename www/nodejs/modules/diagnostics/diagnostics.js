import { EventEmitter } from 'events';
import { exec } from 'node:child_process';
import { clone, kbfmt } from '../utils/utils.js';
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
        let report = ''
        osd.show(lang.PROCESSING, 'fa-mega spin-x-alt', 'diag', 'persistent')
        try {
            const version = paths.manifest.version;
            const diskSpace = await this.checkDisk();
            const freeMem = kbfmt(await this.checkMemory());
            const configs = clone(config.data);
            const listsInfo = lists.info(true);
            const myLists = configs.lists.map(a => a[1]);
            const listsRequesting = Object.assign({}, lists.requesting);
            const tuning = global.streamer.tuning ? global.streamer.tuning.logText(false) : ''
            const processedLists = [...lists.processedLists.keys()]
            const loaded = lists.loaded(true)
            const channelListType = global.channels.channelList ? global.channels.channelList.type : 'no channelList loaded'
            const channelListKey = global.channels.channelList ? global.channels.channelList.key : ''
            const processing = lists.loader.processes.filter(p => p.started() && !p.done()).map(p => {
                return {
                    url: p.url,
                    priority: p.priority
                }
            })

            let perr, publicCategories = await global.channels.channelList.getPublicListsCategories().catch(e => perr = e)
            if (perr) publicCategories = 'Error: ' + String(perr)

            let err, crashlogContent = await crashlog.read().catch(e => err = e)        
            let revision = '10000'
            if(paths.manifest.megacubo && paths.manifest.megacubo.revision) {
                revision = paths.manifest.megacubo.revision
            }
            const crashLog = crashlogContent || err || 'Empty'
            const updaterResults = lists.loader.results, privateLists = [];
            for(const k in listsRequesting) {
                listsRequesting[k] = String(listsRequesting[k])
            };
            ['lists', 'parental-control-terms', 'parental-control-pw', 'premium-license'].forEach(k => delete configs[k]);
            for (const url in listsInfo) {
                listsInfo[url].owned = myLists.includes(url);
                if (listsInfo[url].private) {
                    privateLists.push(url)
                }
            }
            if (diskSpace && diskSpace.size) {
                diskSpace.free = kbfmt(diskSpace.free)
                diskSpace.size = kbfmt(diskSpace.size)
            }
            const timeoutMs = 10000, communitySources = {}, locs = await lang.getActiveCountries()
            await Promise.allSettled(locs.map(loc => {
                return (async () => {
                    let err, lists = await cloud.get('sources/'+ loc, {timeoutMs}).catch(e => err = e)
                    communitySources[loc] = err ? String(err) : lists.map(l => l.url)
                })()
            }))

            report = {
                version, revision, diskSpace, freeMem, configs, channelListKey, channelListType,
                channels: global.channels.channelList.channelsIndex, categories: global.channels.channelList.categories, loaded, 
                communitySources, listsInfo, listsRequesting, updaterResults, processedLists, processing, tuning, crashLog,
                publicCategories
            }
            report = JSON.stringify(report, null, 3)
            privateLists.forEach(url => {
                report = report.replace(url, 'http://***')
            })
        } catch(e) {
            console.error('report err:', e)
            report = 'Error generating report: ' + String(e)
        }
        osd.hide('diag')
        return report
    }
    async saveReport() {
        const file = downloads.folder + '/megacubo-report.txt';
        const report = await this.report();
        await fs.promises.writeFile(file, report, { encoding: 'utf8' });
        downloads.serve(file, true, false).catch(e => menu.displayErr(e));
        report && await renderer.ui.clipboard(report)
        console.error('REPORT => ' + report)
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
                exec('powershell.exe -Command "Get-CimInstance -ClassName Win32_OperatingSystem | Select-Object -ExpandProperty FreePhysicalMemory"', (err, stdout) => {
                    if (err) {
                        return reject('checkMemory err:' + String(err))
                    }
                    let data = stdout.trim()
                    if (data) {
                        resolve(parseInt(data))
                    } else {
                        reject('checkMemory err: bad data, ' + String(data))
                    }
                })
            } else if (process.platform === 'darwin') {
                exec('vm_stat', (err, stdout) => {
                    if (err) {
                        return reject('checkMemory err:' + String(err))
                    }
                    const freePages = stdout.match(new RegExp('Pages free:\s+([0-9]+)'))
                    if (freePages && freePages.length > 1) {
                        const pageSize = 4096
                        resolve(parseInt(freePages[1]) * pageSize)
                    } else {
                        reject('checkMemory err: bad data, ' + String(stdout))
                    }
                })
            } else {
                exec('free -b', (err, stdout) => {
                    if (err) {
                        return reject('checkMemory err:' + String(err))
                    }
                    let data = stdout.match(new RegExp('Mem: +[0-9]+ +[0-9]+ +([0-9]+)'))
                    if (data && data.length > 1) {
                        resolve(parseInt(data[1].trim()))
                    } else {
                        reject('checkMemory err: bad data, ' + String(data))
                    }
                })
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

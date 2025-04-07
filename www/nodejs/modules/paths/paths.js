import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import envPaths from "env-paths";
import { getDirname, getFilename } from 'cross-dirname'
import { workerData } from 'worker_threads'
import { createRequire } from 'node:module';
import mainPackageJson from '../../package.json' assert { type: 'json' };

const paths = {}
paths.inWorker = workerData && Object.keys(workerData).length
if(paths.inWorker) {
    Object.assign(paths, workerData.paths)
    paths.inWorker = true
} else {
    if (process.platform == 'android') {
        const require = createRequire(getFilename())
        paths.android = require('bridge')
    } else {
        paths.android = false
    }
    const forwardSlashes = path => path.replace(new RegExp('\\\\', 'g'), '/');
    let cd = typeof(__dirname) == 'undefined' ? getDirname() : __dirname
    cd = cd.replace(new RegExp('\\\\', 'g'), '/')
    if(cd.endsWith('app') || cd.endsWith('nodejs')) {
        paths.cwd = cd // is rollup bundle
    } else if(cd.endsWith('paths')) {
        paths.cwd = path.join(cd, '../../')
    } else if(cd.endsWith('dist')) {
        paths.cwd = path.join(cd, '../')
    } else {
        paths.cwd = cd
    }
    paths.cwd = paths.cwd.replace(new RegExp('\\\\', 'g'), '/');
    paths.manifest = JSON.parse(JSON.stringify(mainPackageJson))
    const existingFiles = fs.readdirSync(paths.cwd);
    if (paths.android && paths.android.getDataPath) {
        const data = paths.android.getDataPath();
        const temp = data.includes('files') ? data.replace('files', 'cache') : tmpdir()
        Object.assign(paths, { data, temp });
    } else {
        if (existingFiles.includes('.portable')) {
            Object.assign(paths, { data: paths.cwd + '/.portable/Data', temp: paths.cwd + '/.portable/temp' });
        } else {
            Object.assign(paths, envPaths(paths.manifest.window.title, { suffix: '' }));
        }
    }
    Object.keys(paths).forEach(type => {
        if (typeof(paths[type]) != 'string')
            return
        paths[type] = forwardSlashes(paths[type])
        if (paths[type].endsWith('/')) {
            paths[type] = paths[type].substr(0, paths[type].length - 1)
        }
        fs.promises.mkdir(paths[type], { recursive: true }).catch(e => console.warn(e))
    })
    paths.ALLOW_ADDING_LISTS = existingFiles.includes('ALLOW_ADDING_LISTS.md')
    paths.ALLOW_COMMUNITY_LISTS = paths.ALLOW_ADDING_LISTS && existingFiles.includes('ALLOW_COMMUNITY.md')
}

export default paths
export const temp = paths.temp
export const inWorker = paths.inWorker


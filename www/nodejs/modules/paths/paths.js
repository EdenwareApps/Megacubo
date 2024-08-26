import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import envPaths from "env-paths";
import { getDirname, getFilename } from 'cross-dirname'
import { workerData } from 'worker_threads'
import { createRequire } from 'module';

const paths = {}
paths.inWorker = workerData && Object.keys(workerData).length
if(paths.inWorker) {
    Object.assign(paths, workerData.paths)
} else {
    if (process.platform == 'android') {
        const require = createRequire(getFilename())
        paths.android = require('bridge')
    } else {
        paths.android = false
    }
    const forwardSlashes = path => path.replace(new RegExp('\\\\', 'g'), '/');
    const checkDirWritePermissionSync = dir => {
        let fine;
        const file = dir + '/temp.txt';
        try {
            fs.writeFileSync(file, '0');
            fine = true;
            fs.unlinkSync(file);
        }
        catch (e) {
            console.error(e);
        }
        return fine;
    };
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
    paths.manifest = JSON.parse(String(fs.readFileSync(paths.cwd + '/package.json')))
    if (paths.android && paths.android.getDataPath) {
        const data = paths.android.getDataPath();
        const temp = data.indexOf('files') != -1 ? data.replace('files', 'cache') : tmpdir()
        Object.assign(paths, { data, temp });
    } else {
        if (fs.existsSync(paths.cwd + '/.portable') && checkDirWritePermissionSync(paths.cwd + '/.portable')) {
            Object.assign(paths, { data: paths.cwd + '/.portable/Data', temp: paths.cwd + '/.portable/temp' });
        } else {
            Object.assign(paths, envPaths(paths.manifest.window.title, { suffix: '' }));
        }
    }
    Object.keys(paths).forEach(type => {
        if (typeof (paths[type]) != 'string')
            return
        paths[type] = forwardSlashes(paths[type])
        if (paths[type].endsWith('/')) {
            paths[type] = paths[type].substr(0, paths[type].length - 1)
        }
        console.log('DEFAULT PATH ' + type + '=' + paths[type] + ' ' + paths.inWorker + ' :: ' + !!paths.android);
        if (!fs.existsSync(paths[type])) {
            try {
                fs.mkdirSync(paths[type], { recursive: true })
            } catch (e) {}
        }
    })
    paths.ALLOW_ADDING_LISTS = fs.existsSync(paths.cwd + '/ALLOW_ADDING_LISTS.md')
    paths.ALLOW_COMMUNITY_LISTS = paths.ALLOW_ADDING_LISTS && fs.existsSync(paths.cwd + '/ALLOW_COMMUNITY.md')
}

export default paths
export const temp = paths.temp

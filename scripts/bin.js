#!/usr/bin/env node
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mainBundlePath = path.join(__dirname, '../www/nodejs/dist/main.js');

// Check if bundle exists, if not, build it
if (!fs.existsSync(mainBundlePath)) {
    console.log('Bundle not found. Running build...');
    try {
        const buildProcess = spawn('npm', ['run', 'prepare'], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
        await new Promise((resolve, reject) => {
            buildProcess.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Build failed with code ${code}`));
                }
            });
            buildProcess.on('error', reject);
        });
        console.log('Build completed.');
    } catch (error) {
        console.error('Failed to build bundle:', error.message);
        process.exit(1);
    }
}

// consider NODE_ENV
const buildMode = readBuildModeFromBundle(mainBundlePath);
const debug = buildMode === 'development';

console.log(`Starting Megacubo in ${buildMode} mode...`);

function readBuildModeFromBundle(bundlePath) {
    try {
        const content = fs.readFileSync(bundlePath, 'utf8');
        const match = content.match(/__MEGACUBO_BUILD_MODE__\s*=\s*["'](production|development)["']/);
        return match ? match[1] : null;
    } catch (_) {
        return null;
    }
}

async function findElectronExecutable() {
    const relativePaths = [
        '../node_modules/electron/dist/electron',
        '../electron/dist/electron'
    ];
    for (const relativePath of relativePaths) {
        const fullPath = path.resolve(__dirname, relativePath);
        const executable = process.platform === 'win32' ? `${fullPath}.exe` : fullPath;
        try {
            await fs.promises.access(executable, fs.constants.F_OK);
            return executable;
        } catch (error) { }
    }
    // Check environment variable
    const environmentPath = process.env.ELECTRON_PATH;
    if (environmentPath) {
        try {
            await fs.promises.access(environmentPath, fs.constants.F_OK);
            return environmentPath;
        }
        catch (error) { }
    }
    // Check global NPM installation directory
    const npmGlobalPrefix = process.env.npm_global_prefix;
    if (npmGlobalPrefix) {
        const globalExecutable = path.resolve(npmGlobalPrefix, 'electron/electron');
        const globalExecutableWithExtension = process.platform === 'win32' ? `${globalExecutable}.exe` : globalExecutable;
        try {
            await fs.promises.access(globalExecutableWithExtension, fs.constants.F_OK);
            return globalExecutableWithExtension;
        }
        catch (error) { }
    }
    // Default return if not found
    return null;
}
findElectronExecutable().then(electronPath => {
    if (electronPath) {
        const params = []
        const buildMode = readBuildModeFromBundle(mainBundlePath);
        if(debug) {
            params.push(...[
                '--inspect',
                '--no-sandbox',
                '--enable-logging=stderr',
                '--trace-warnings',
                '--remote-debugging-port=9222'
            ])
        }
        const passedParamsOffset = process.argv.findLastIndex(arg => arg.includes('node') || arg.includes('megacubo')) + 1
        params.push(mainBundlePath);
        if(passedParamsOffset && passedParamsOffset < process.argv.length) {
            params.push('--')
            params.push(...process.argv.slice(passedParamsOffset))
        }
        const opts = debug ? {} : {
            detached: true,
            stdio: 'ignore',
        };
        // Give main process more heap to reduce OOM (env is inherited by Electron)
        const env = { ...process.env }
        if (!env.NODE_OPTIONS || !env.NODE_OPTIONS.includes('max-old-space-size')) {
            env.NODE_OPTIONS = (env.NODE_OPTIONS || '').trim()
                ? `${env.NODE_OPTIONS} --max-old-space-size=2048`
                : '--max-old-space-size=2048'
        }
        if (buildMode) {
            env.MEGACUBO_BUILD_MODE = buildMode;
            if (debug) {
                console.log(`Build mode: ${buildMode}`);
            }
        }
        opts.env = env
        const child = spawn(electronPath, params, opts);
        if(debug) {                
            child.stdout.on('data', (data) => {
                if (process.stdout.writable) {
                    process.stdout.write(data);
                } else {
                    console.error('Stdout is not ready for writing.\n', data);
                }
            });
            child.stderr.on('data', (data) => {
                if (process.stderr.writable) {
                    process.stderr.write(data);
                } else {
                    console.error('Stderr is not ready for writing.\n', data);
                }
            });
            child.on('error', (error) => {
                console.error(error);
            });
            child.once('close', (code) => {
                console.log('exitcode: ' + code);
                process.exit(code);
            });
            return;
        } else {
            child.unref();
        }
    } else {
        console.error('Electron executable not found. Run \'npm i\' on Megacubo folder to install it.');
    }
    process.exit(0);
}).catch(err => console.error(err));

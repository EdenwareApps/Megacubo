#!/usr/bin/env node
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const debug = process.argv.includes('debug') || process.argv.includes('--inspect');

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
        if(debug) {
            params.push(...[
                '--inspect',
                '--enable-logging=stderr',
                '--trace-warnings',
                '--remote-debugging-port=9222'
            ])
        }
        const passedParamsOffset = process.argv.findLastIndex(arg => arg.includes('node') || arg.includes('megacubo')) + 1
        params.push(path.join(__dirname, '../www/nodejs/dist/main.js'));
        if(passedParamsOffset && passedParamsOffset < process.argv.length) {
            params.push('--')
            params.push(...process.argv.slice(passedParamsOffset))
        }
        const opts = debug ? {} : {
            detached: true,
            stdio: 'ignore',
        };
        const child = spawn(electronPath, params, opts);
        if(debug) {                
            child.stdout.on('data', (data) => {
                if (process.stdout.writable) {
                    process.stdout.write(data);
                } else {
                    console.error('Stdout não está pronto para escrita.\n', data);
                }
            });
            child.stderr.on('data', (data) => {
                if (process.stderr.writable) {
                    process.stderr.write(data);
                } else {
                    console.error('Stderr não está pronto para escrita.\n', data);
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

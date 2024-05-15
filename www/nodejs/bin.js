#!/usr/bin/env node
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
async function findElectronExecutable() {
    const relativePaths = [
        'node_modules/electron/dist/electron',
        'www/nodejs-project/node_modules/electron/dist/electron'
    ];
    for (const relativePath of relativePaths) {
        const fullPath = path.resolve(__dirname, relativePath);
        const executable = process.platform === 'win32' ? `${fullPath}.exe` : fullPath;
        try {
            await fs.promises.access(executable, fs.constants.F_OK);
            return executable;
        }
        catch (error) {}
    }
    // Check environment variable
    const environmentPath = process.env.ELECTRON_PATH;
    if (environmentPath) {
        try {
            await fs.promises.access(environmentPath, fs.constants.F_OK);
            return environmentPath;
        }
        catch (error) {
            // File not found
        }
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
        catch (error) {
            // File not found
        }
    }
    // Default return if not found
    return null;
}
findElectronExecutable().then(electronPath => {
    if (electronPath) {
        const child = spawn(electronPath, [path.join(__dirname, 'main.js')], {
            detached: true,
            stdio: 'ignore',
        });
        child.unref();
    } else {
        console.error('Electron executable not found. Use \'npm i electron@9.1.2\' to install it.');
    }
    process.exit(0);
}).catch(console.error);

#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'fs';
import os from 'os';
import https from 'https';

// Cores para output
const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkNodeVersion() {
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);

    log(`✓ Node.js version: ${nodeVersion}`, 'blue');

    if (majorVersion < 22) {
        log(`✗ Node.js 22+ required. Current: ${nodeVersion}`, 'red');
        log(`  Run: nvm use 22.12.0 (if using nvm)`, 'yellow');
        return false;
    }

    log(`✓ Node.js version compatible`, 'green');
    return true;
}

function checkNpm() {
    try {
        const npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
        log(`✓ NPM version: ${npmVersion}`, 'blue');
        return true;
    } catch (error) {
        log('✗ NPM not found', 'red');
        return false;
    }
}

function checkGit() {
    try {
        const gitVersion = execSync('git --version', { encoding: 'utf8' }).trim();
        log(`✓ Git version: ${gitVersion}`, 'blue');
        return true;
    } catch (error) {
        log('✗ Git not found', 'red');
        return false;
    }
}

function checkDiskSpace() {
    try {
        const stats = fs.statSync('.');
        const freeSpace = os.freemem() / (1024 * 1024 * 1024); // GB

        if (freeSpace < 2) {
            log(`✗ Low disk space: ${freeSpace.toFixed(1)}GB free`, 'red');
            log('  Need at least 2GB free space', 'yellow');
            return false;
        }

        log(`✓ Disk space: ${freeSpace.toFixed(1)}GB free`, 'blue');
        return true;
    } catch (error) {
        log('⚠ Could not check disk space', 'yellow');
        return true;
    }
}

function checkNetwork() {
    return new Promise((resolve) => {
        let resolved = false;
        log('Testing network connectivity...', 'blue');

        const req = https.get('https://registry.npmjs.org/', { timeout: 5000 }, (res) => {
            if (resolved) return;
            log('✓ Network connectivity OK', 'green');
            resolved = true;
            resolve(true);
        });

        req.on('error', () => {
            if (resolved) return;
            log('✗ Network connectivity failed', 'red');
            log('  Check your internet connection', 'yellow');
            resolved = true;
            resolve(false);
        });

        req.on('timeout', () => {
            if (resolved) return;
            log('✗ Network timeout', 'red');
            resolved = true;
            resolve(false);
        });
    });
}

async function main() {
    log('🔍 Checking Megacubo development requirements...\n', 'blue');

    let allGood = true;

    // Basic checks
    allGood &= checkNodeVersion();
    allGood &= checkNpm();
    allGood &= checkGit();
    allGood &= checkDiskSpace();

    // Network check
    const networkOk = await checkNetwork();
    allGood &= networkOk;

    console.log('\n' + '='.repeat(50));

    if (allGood) {
        log('✅ All requirements satisfied!', 'green');
        log('\nYou can now run: npm install', 'blue');
        process.exit(0);
    } else {
        log('❌ Some requirements not met. Please fix the issues above.', 'red');
        log('\nFor help, check docs/developing.md', 'yellow');
        process.exit(1);
    }
}

main().catch(error => {
    log(`Error checking requirements: ${error.message}`, 'red');
    process.exit(1);
});
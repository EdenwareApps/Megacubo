import { EventEmitter } from "events";
import paths from "../paths/paths.js";
import Limiter from "../limiter/limiter.js";
import onexit from "node-cleanup";
import fs from "fs";
import zlib from "zlib";
import path from "path";
import config from "../config/config.js"
import { moveFile, rmdir } from '../utils/utils.js'
import { parse } from '../serialize/serialize.js'

// Storage index version for compatibility checking
const STORAGE_INDEX_VERSION = 2;
import crypto from 'crypto'

// Class to manage profile authentication
class ProfileAuth {
    constructor() {
        this.authKeys = new Map(); // profileId -> encryptionKey
        this.openProfiles = new Set(); // profiles without encryption
    }

    // Set encryption key for a profile
    setAuth(profileId, key) {
        if (!key) {
            // Open profile - without encryption
            this.openProfiles.add(profileId);
            this.authKeys.delete(profileId);
        } else {
            this.openProfiles.delete(profileId);
            this.authKeys.set(profileId, key);
        }
    }

    // Get encryption key for a profile
    getAuth(profileId) {
        return this.authKeys.get(profileId);
    }

    // Check if profile is open (no encryption)
    isOpen(profileId) {
        return this.openProfiles.has(profileId);
    }

    // Remove authentication from a profile
    clearAuth(profileId) {
        this.authKeys.delete(profileId);
        this.openProfiles.delete(profileId);
    }
}

class StorageTools extends EventEmitter {
    constructor(opts) {
        super()
        const { data } = paths;
        this.opts = {
            main: false,
            debug: false,
            minIdleTime: 300,
            folder: data + '/storage',
            maxExpiration: 100 * (365 * (24 * 3600)),
            maxDiskUsage: config.get('in-disk-caching-size') * (1024 * 1024)
        };
        opts && Object.assign(this.opts, opts);
        this.indexFile = 'storage-index.json';
        this.locked = {};
        this.index = {};
        this.knownExtensions = ['offsets.jdb', 'idx.jdb', 'dat', 'jdb', 'idx', 'tmp', 'updating'] // do not include 'json', those are handled by upgrade()

        // Ensure storage folder exists synchronously in main process (avoids ENOENT on first write when packaged)
        if (this.opts.main && this.opts.folder) {
            try {
                fs.mkdirSync(this.opts.folder, { recursive: true });
            } catch (e) {
                console.warn('Storage: could not create folder', this.opts.folder, e.message);
            }
        }

        // Add write queue system for better concurrency control
        this.writeQueue = new Map(); // key -> queue of write operations
        this.writeQueueLocks = new Map(); // key -> lock for queue operations
        
        this.load();
        if (!this.opts.main)
            return;
        this.lastSaveTime = (Date.now() / 1000)
        // Increase save interval to reduce file handle usage
        this.saveLimiter = new Limiter(() => this._performSave(), { intervalMs: 10000, initialDelay: 2000, async: true }) // increased from 5000 to 10000
        this.alignLimiter = new Limiter(() => this.align(), { intervalMs: 10000, async: true }) // increased from 5000 to 10000
        // Add consistency checker for main process (runs every 5 minutes)
        this.consistencyLimiter = new Limiter(() => this.checkConsistency(), { intervalMs: 300000, initialDelay: 60000, async: true })
        this.consistencyIntervalId = null; // Track the interval ID
        
        process.nextTick(() => {
            onexit(() => this.saveSync());
            // Don't start automatic consistency checking here - let it be started explicitly
        });
    }

    // Return a safe path for the expiration sidecar corresponding to a data/index file
    expiresPath(file) {
        if (!file || typeof file !== 'string') return file + '.expires.json';
        for (const ext of this.knownExtensions) {
            const suffix = '.' + ext;
            if (file.endsWith(suffix)) {
                return file.slice(0, -suffix.length) + '.expires.json';
            }
        }
        const idx = file.lastIndexOf('.');
        if (idx !== -1) return file.slice(0, idx) + '.expires.json';
        return file + '.expires.json';
    }
    
    // Start automatic maintenance (consistency checking every 5 minutes)
    startAutoMaintenance() {
        if (!this.opts.main || this.consistencyIntervalId) return; // Only main process, and don't start if already running
        
        this.consistencyIntervalId = setInterval(() => {
            this.consistencyLimiter.call();
        }, 300000); // 5 minutes
        
        console.log('Storage: Automatic maintenance started (consistency check every 5 minutes)');
    }
    
    // Stop automatic maintenance
    stopAutoMaintenance() {
        if (this.consistencyIntervalId) {
            clearInterval(this.consistencyIntervalId);
            this.consistencyIntervalId = null;
            console.log('Storage: Automatic maintenance stopped');
        }
    }
    async cleanup() {
        const now = (Date.now() / 1000)
        const files = await fs.promises.readdir(this.opts.folder).catch(() => {})
        if (Array.isArray(files) && files.length) {
            let upgraded
            for (const file of files) {
                if (file == this.indexFile)
                    continue
                const ext = file.split('.').pop()
                const key = this.unresolve(file)
                if (this.heldKeys.has(key)) {
                    continue
                }
                if (this.knownExtensions.includes(ext)) {
                    // Check if file is expired or not in index and older than 1 hour
                    const ffile = this.opts.folder + '/' + file
                    const stat = await fs.promises.stat(ffile).catch(() => {})
                    if (stat && typeof(stat.size) == 'number') {
                        const mtime = stat.mtimeMs / 1000;
                        const oneHour = 3600; // 1 hour in seconds
                        
                        // Check if file is older than 1 hour
                        if ((now - mtime) > oneHour) {
                            // Skip if currently locked (being written)
                            if (this.locked[key]) {
                                console.log(`Cleanup: Skipping locked key ${key}`);
                                continue;
                            }
                            
                            // Check if file is in index and not expired
                            let indexEntry = this.index[key];
                            
                            // Try auto-heal if not in index
                            if (!indexEntry) {
                                const healed = await this.tryAutoHealKey(key).catch(() => false);
                                if (healed) {
                                    indexEntry = this.index[key];
                                }
                            }
                            
                            if (!indexEntry || (indexEntry.expiration && now > indexEntry.expiration)) {
                                // File is not in index (even after auto-heal) or has expired - delete it
                                await fs.promises.unlink(ffile).catch(() => {})
                                // Also delete expiration sidecar if exists
                                const expFile = this.expiresPath(ffile);
                                await fs.promises.unlink(expFile).catch(() => {})
                            }
                        }
                    }
                } else if (ext == 'commit') { // delete zombie commits
                    const ffile = this.opts.folder + '/' + file
                    const stat = await fs.promises.stat(ffile).catch(() => {})
                    if (stat && typeof(stat.size) == 'number') {
                        const mtime = stat.mtimeMs / 1000;
                        // Increase minimum idle time for commit files to 10 minutes (600s) to avoid race conditions
                        const minCommitIdleTime = Math.max(this.opts.minIdleTime, 600)
                        if ((now - mtime) > minCommitIdleTime) {
                            fs.promises.unlink(ffile).catch(() => {})
                        }
                    }
                } else if (ext == 'json') { // upgrade files and index
                    upgraded = true
                    await this.upgrade(file)
                } else {
                    await fs.promises.unlink(this.opts.folder +'/'+ file).catch(() => {}) // unexpected file format
                }
            }
        }
    }
    async clear(force) {        
        for (const k of Object.keys(this.index)) {
            if (force || !this.index[k].permanent) {
                if (this.heldKeys.has(k)) {
                    continue
                }
                await fs.promises.unlink(this.resolve(k)).catch(() => {})
                delete this.index[k]
            }
        }
        await this.save()
    }
    async compress(data) {
        return new Promise((resolve, reject) => {
            zlib.gzip(data, (err, result) => {
                if (err)
                    return reject(err)
                resolve(result)
            });
        });
    }
    async decompress(data) {
        return new Promise((resolve, reject) => {
            if (!data.length) return reject(new Error('Data is empty'));
            try {
                zlib.gunzip(data, (err, result) => {
                    if (err)
                        return reject(err)
                    resolve(result)
                })
            } catch (err) {
                reject(err)
            }
        })
    }
    async upgrade(ofile) {
        let reason = 'unknown'        
        const file = ofile.endsWith('.expires.json') ? ofile.replace('.expires.json', '.json') : ofile;
        const efile = file.replace('.json', '.expires.json');
        const tfile = file.replace('.json', '.dat');
        const key = this.unresolve(tfile);
        const tstat = await fs.promises.stat(this.opts.folder + '/' + tfile).catch(() => {});
        
        // If .dat file already exists, try to use expiration from .expires.json for auto-heal
        if (tstat && typeof(tstat) == 'object') {
            // .dat exists, try to read expiration from .expires.json and update index
            if (ofile.endsWith('.expires.json')) {
                let expiration = parseInt(await fs.promises.readFile(this.opts.folder + '/' + efile).catch(() => {}));
                if (!isNaN(expiration) && expiration > 0) {
                    // Use auto-heal to update index with expiration
                    const healed = await this.tryAutoHealKey(key).catch(() => false);
                    if (healed) {
                        await fs.promises.unlink(this.opts.folder + '/' + efile).catch(() => {});
                        return; // Successfully healed
                    }
                }
            }
            // .dat already exists, skip upgrade and clean up old files
            await fs.promises.unlink(this.opts.folder + '/' + file).catch(() => {});
            await fs.promises.unlink(this.opts.folder + '/' + efile).catch(() => {});
            return; // Skip upgrade, .dat already exists
        }
        
        // Check if .json file exists
        const jsonStat = await fs.promises.stat(this.opts.folder + '/' + file).catch(() => null);
        if (!jsonStat) {
            // .json doesn't exist - check if .expires.json is orphaned
            if (ofile.endsWith('.expires.json')) {
                // Orphaned .expires.json - just delete it silently
                await fs.promises.unlink(this.opts.folder + '/' + efile).catch(() => {});
                return;
            }
            reason = 'source file not found';
            await fs.promises.unlink(this.opts.folder + '/' + file).catch(() => {});
            await fs.promises.unlink(this.opts.folder + '/' + efile).catch(() => {});
            return;
        }
        
        // At this point: .dat doesn't exist (checked above), .json exists (checked above)
        // Proceed with migration from .json to .dat
        let expiration = parseInt(await fs.promises.readFile(this.opts.folder + '/' + efile).catch(() => {}));
        
        // If no expiration found, use default (will be calculated by set())
        const hasExpiration = !isNaN(expiration) && expiration > 0;
        
        let err;
        let content = await fs.promises.readFile(this.opts.folder + '/' + file).catch(e => err = e);
        if (!err && content) {
            const movedToConfigKeys = ['bookmarks', 'history', 'epg-history'];
            let raw = true;
            try {
                let parsed = JSON.parse(content);
                content = parsed;
                raw = false;
            }
            catch (e) {}
            if (movedToConfigKeys.includes(key)) {
                config.set(key, content);
                // For config keys, delete old files since they're moved to config
                await fs.promises.unlink(this.opts.folder + '/' + file).catch(() => {});
                await fs.promises.unlink(this.opts.folder + '/' + efile).catch(() => {});
            } else {
                // Migrate .json → .dat, keeping expiration sidecar
                const setOpts = hasExpiration ? { expiration, raw } : { raw };
                await this.set(key, content, setOpts);
                
                // Verify new .expires.json was created before deleting old one
                const newExpFile = this.expiresPath(tfile);
                const newExpExists = await fs.promises.stat(this.opts.folder + '/' + newExpFile).catch(() => null);
                
                // Delete old .json file
                await fs.promises.unlink(this.opts.folder + '/' + file).catch(() => {});
                
                // Only delete old .expires.json if it existed and new one was created successfully
                if (hasExpiration && newExpExists) {
                    await fs.promises.unlink(this.opts.folder + '/' + efile).catch(() => {});
                } else if (hasExpiration && !newExpExists) {
                    // If new .expires.json wasn't created but old one existed, keep old one as backup
                    console.warn(`⚠️ Upgrade: New .expires.json not created for ${key}, keeping old one as backup`);
                }
                // If old .expires.json didn't exist, nothing to delete
            }
            console.error('+++++++ UPGRADED ' + tfile);
            return; // upgraded
        } else {
            reason = 'no content or error: ' + (err?.message || String(err));
        }
        
        // If we get here, upgrade failed
        await fs.promises.unlink(this.opts.folder + '/' + file).catch(() => {});
        await fs.promises.unlink(this.opts.folder + '/' + efile).catch(() => {});
        // Only log error if it's a real upgrade attempt (not orphaned file)
        if (!ofile.endsWith('.expires.json') || jsonStat) {
            console.error('+++++++ NOT UPGRADED ' + ofile + ' :: ' + reason);
        }
    }
    size() {
        let usage = 0;
        Object.keys(this.index).forEach(k => {
            if (typeof(this.index[k].size) == 'number') {
                usage += this.index[k].size;
            }
        });
        return usage;
    }
    
    async recalculateSizes() {
        const promises = Object.keys(this.index).map(async k => {
            const entry = this.index[k];
            
            // If entry.file is set, verify it exists and has correct extension
            if (entry && entry.file) {
                try {
                    const stat = await fs.promises.stat(entry.file).catch(() => null);
                    if (!stat) {
                        // File doesn't exist, remove from index
                        delete this.index[k];
                        return;
                    }
                    // Update size and time
                    entry.size = stat.size;
                    entry.time = Date.now() / 1000;
                    return;
                } catch (e) {
                    // Ignore
                }
            }
            
            // Try to find the actual file by checking known extensions
            let file = null;
            let stat = null;
            
            // First try the resolve method (for files with entry.file set)
            try {
                file = this.resolve(k);
                stat = await fs.promises.stat(file).catch(() => null);
            } catch (e) {
                // Ignore
            }
            
            // If not found, try different extensions
            if (!stat) {
                for (const ext of this.knownExtensions) {
                    try {
                        file = this.resolve(k, ext);
                        stat = await fs.promises.stat(file).catch(() => null);
                        if (stat) break;
                    } catch (e) {
                        // Ignore
                    }
                }
            }
            
            if (stat && typeof(stat.size) == 'number') {
                // Update the index with the actual file size
                entry.size = stat.size;
                entry.time = Date.now() / 1000; // Update time to ensure merge prefers memory
                // Also update entry.file if not set
                if (!entry.file) {
                    entry.file = file;
                }
            } else {
                // File doesn't exist, remove from index
                delete this.index[k];
            }
        });
        await Promise.all(promises);
        await this.save(); // Save the updated index
    }

    // Add consistency check method
    async checkConsistency() {
        if (!this.opts.main) return; // Only main process should check consistency
        
        const now = Date.now() / 1000;
        let inconsistencies = 0;
        
        for (const [key, entry] of Object.entries(this.index)) {
            // Check if file exists for index entry - try all known extensions
            let file = null;
            let stat = null;
            
            // First try default resolve (usually .dat)
            try {
                file = this.resolve(key);
                stat = await fs.promises.stat(file).catch(() => null);
            } catch (e) {
                // Ignore
            }
            
            // If not found, try different extensions
            if (!stat) {
                for (const ext of this.knownExtensions) {
                    try {
                        file = this.resolve(key, ext);
                        stat = await fs.promises.stat(file).catch(() => null);
                        if (stat) break;
                    } catch (e) {
                        // Ignore
                    }
                }
            }
            
            if (!stat) {
                // File missing - delete from index regardless of lock status
                // If it was locked, the lock is stale since file doesn't exist
                console.warn(`Storage consistency: File missing for index entry ${key}`);
                delete this.index[key];
                this.emit('delete', key);
                inconsistencies++;
            } else {
                // Always ensure size is set correctly, even for locked files
                if (typeof(entry.size) !== 'number' || entry.size !== stat.size) {
                    if (typeof(entry.size) === 'number' && entry.size !== stat.size) {
                        console.warn(`Storage consistency: Size mismatch for ${key} (index: ${entry.size}, file: ${stat.size})`);
                    }
                    entry.size = stat.size;
                    inconsistencies++;
                }
            }
        }
        
        // Check for orphaned files not in index
        try {
            const files = await fs.promises.readdir(this.opts.folder);
            for (const file of files) {
                if (file === this.indexFile) continue;
                const ext = file.split('.').pop();
                if (this.knownExtensions.includes(ext)) {
                    const key = this.unresolve(file);
                    if (!this.index[key]) {
                        console.warn(`Storage consistency: Orphaned file ${file} not in index`);
                        const filePath = this.opts.folder + '/' + file;
                        if (ext === 'jdb') {
                            console.log(`Storage consistency: Registering orphaned database file ${file}`);
                            await this.touchFile(filePath, { permanent: true });
                            console.log(`Storage consistency: Registered ${key} in index`);
                        } else if (ext === 'idx') {
                            console.log(`Storage consistency: Registering orphaned file ${file}`);
                            const baseKey = this.unresolve(file.replace(/\.idx$/, ''));
                            const baseExp = this.expiration(baseKey);
                            const atts = baseExp ? { expiration: baseExp } : { ttl: 600 };
                            await this.touchFile(filePath, atts);
                            console.log(`Storage consistency: Registered ${key} in index`);
                        } else if (ext === 'tmp' || ext === 'updating') {
                            console.log(`Storage consistency: Registering orphaned file ${file}`);
                            await this.touchFile(filePath, { ttl: 600 });
                            console.log(`Storage consistency: Registered ${key} in index`);
                        } else {
                            // Remove other orphaned files
                            await fs.promises.unlink(filePath).catch(() => {});
                            console.log(`Storage consistency: Removed orphaned file ${file}`);
                        }
                        inconsistencies++;
                    }
                }
            }
        } catch (e) {
            console.warn('Storage consistency: Error checking orphaned files:', e.message);
        }
        
        if (inconsistencies > 0) {
            console.log(`Storage consistency: Fixed ${inconsistencies} inconsistencies`);
            // Recalculate sizes to ensure accuracy after registering orphaned files
            await this.recalculateSizes();
            // Trigger save via limiter (don't wait for it to complete immediately)
            await this.save();
        }
        
        return inconsistencies;
    }

    // Diagnostic method to compare index size with actual folder size (read-only)
    async diagnoseStorage() {
        let realSize = 0;
        let fileCount = 0;
        let indexFileCount = Object.keys(this.index).length;
        let orphanedFiles = [];
        let extensionStats = {};
        let largestFiles = [];
        let indexFileSize = 0;
        
        try {
            const files = await fs.promises.readdir(this.opts.folder);
            for (const file of files) {
                const filePath = path.join(this.opts.folder, file);
                const stat = await fs.promises.stat(filePath).catch(() => null);
                if (stat && stat.isFile()) {
                    // Exclude the index file from realSize calculation
                    if (file === this.indexFile) {
                        indexFileSize = stat.size;
                        continue;
                    }
                    
                    realSize += stat.size;
                    fileCount++;
                    
                    // Track extension stats
                    const ext = file.split('.').pop() || 'no-ext';
                    if (!extensionStats[ext]) {
                        extensionStats[ext] = { count: 0, size: 0 };
                    }
                    extensionStats[ext].count++;
                    extensionStats[ext].size += stat.size;
                    
                    // Track largest files
                    largestFiles.push({ name: file, size: stat.size });
                    
                    // Check if file is orphaned (not in index)
                    const extCheck = file.split('.').pop();
                    if (this.knownExtensions.includes(extCheck)) {
                        const key = this.unresolve(file);
                        if (!this.index[key]) {
                            orphanedFiles.push({ name: file, size: stat.size });
                        }
                    }
                }
            }
            
            // Sort largest files
            largestFiles.sort((a, b) => b.size - a.size);
            largestFiles = largestFiles.slice(0, 10); // Top 10
            
            // Sort orphaned files by size
            orphanedFiles.sort((a, b) => b.size - a.size);
            
        } catch (e) {
            console.warn('Diagnose storage: Error reading folder:', e.message);
            return { error: e.message };
        }
        
        const indexSize = this.size();
        const difference = realSize - indexSize;
        
        return {
            indexSize,
            realSize,
            difference,
            fileCount,
            indexFileCount,
            indexFileSize,
            orphanedFiles,
            extensionStats,
            largestFiles,
            folder: this.opts.folder
        };
    }
    
    // Comprehensive storage analysis and optional auto-fix
    async analyzeAndFixStorage(opts = {}) {
        const { autoFix = false, verbose = true } = opts;
        
        if (verbose) {
            console.log('=== COMPLETE STORAGE ANALYSIS ===');
        }
        
        // Get current diagnosis
        const diagnosis = await this.diagnoseStorage();
        if (diagnosis.error) {
            return diagnosis;
        }
        
        if (verbose) {
            console.log(`Index size: ${(diagnosis.indexSize / 1024 / 1024).toFixed(2)} MB`);
            console.log(`Real folder size: ${(diagnosis.realSize / 1024 / 1024).toFixed(2)} MB`);
            console.log(`Difference: ${(diagnosis.difference / 1024 / 1024).toFixed(2)} MB`);
            console.log(`Orphaned files: ${diagnosis.orphanedFiles.length}`);
            console.log(`Index entries: ${diagnosis.indexFileCount}`);
        }
        
        let fixesApplied = 0;
        
        if (autoFix) {
            if (verbose) {
                console.log('\n=== APPLYING AUTOMATIC FIXES ===');
            }
            
            // Run consistency check to fix issues
            const consistencyResult = await this.checkConsistency();
            fixesApplied = consistencyResult || 0;
            
            if (verbose) {
                console.log(`Inconsistencies fixed: ${fixesApplied}`);
            }
            
            // Get updated diagnosis after fixes
            const updatedDiagnosis = await this.diagnoseStorage();
            if (verbose) {
                console.log('\n=== AFTER FIXES ===');
                console.log(`Index size: ${(updatedDiagnosis.indexSize / 1024 / 1024).toFixed(2)} MB`);
                console.log(`Real folder size: ${(updatedDiagnosis.realSize / 1024 / 1024).toFixed(2)} MB`);
                console.log(`Difference: ${((updatedDiagnosis.realSize - updatedDiagnosis.indexSize) / 1024 / 1024).toFixed(2)} MB`);
                console.log(`Remaining orphaned files: ${updatedDiagnosis.orphanedFiles.length}`);
            }
            
            return {
                ...updatedDiagnosis,
                fixesApplied,
                originalDiagnosis: diagnosis
            };
        }
        
        return {
            ...diagnosis,
            fixesApplied: 0
        };
    }
}

class StorageHolding extends StorageTools {
    constructor(opts) {
        super(opts);
        this.holds = []
        this.heldKeys = new Set()
    }
    hold(key) {
        const hold = {
            key,
            release: () => {
                this.holds = this.holds.filter(h => h.key !== key)
                this.holds.some(h => h.key === key) || this.heldKeys.delete(key)
                this.touch(key, false)
            }
        }
        this.holds.push(hold)
        this.heldKeys.add(key)
        return hold
    }
}

class StorageIndex extends StorageHolding {
    constructor(opts) {
        super(opts);
    }
    load() {
        try {
            const indexPath = this.opts.folder +'/'+ this.indexFile
            if (fs.existsSync(indexPath)) {
                const content = fs.readFileSync(indexPath, 'utf8')
                if (content && content.trim()) {
                    try {
                        const diskIndex = JSON.parse(content)
                        
                        // Check version compatibility
                        if (diskIndex._version && diskIndex._version !== STORAGE_INDEX_VERSION) {
                            console.warn(`Storage index version mismatch (disk: ${diskIndex._version}, current: ${STORAGE_INDEX_VERSION}), resetting index`);
                            // Create backup of old version
                            const backupPath = indexPath + '.v' + diskIndex._version + '.' + Date.now();
                            fs.copyFileSync(indexPath, backupPath);
                            this.index = {};
                            // Trigger save via limiter
                            this.save();
                            return;
                        }
                        
                        // Remove version from index data
                        delete diskIndex._version;
                        
                        // Merge with existing in-memory index if any
                        if (Object.keys(this.index || {}).length > 0) {
                            this.index = this.mergeIndexes(this.index, diskIndex)
                        } else {
                            this.index = diskIndex
                        }
                    } catch (parseError) {
                        console.error('Storage index JSON parse error, creating backup and resetting:', parseError.message)
                        // Create backup of corrupted file
                        const backupPath = indexPath + '.corrupted.' + Date.now()
                        fs.copyFileSync(indexPath, backupPath)
                        // Reset to empty index
                        this.index = {}
                        // Trigger save via limiter
                        this.save()
                    }
                } else {
                    this.index = {}
                }
            } else {
                this.index = {}
            }
            
            // Setup watchFile for index reload in all processes
            this.setupIndexWatch()
        } catch (err) {
            console.error('Storage load error:', err)
            this.index = {}
        }
    }
    
    setupIndexWatch() {
        if (this._indexWatchSetup) return; // Already setup
        this._indexWatchSetup = true;
        
        const indexPath = this.opts.folder +'/'+ this.indexFile;
        
        const watchAndReload = async () => {
            let reloadTimer = null;
            const debounceMs = 500;
            
            const reloadIndex = async () => {
                try {
                    const content = await fs.promises.readFile(indexPath, 'utf8').catch(() => '{}');
                    if (!content || !content.trim()) return;
                    
                    const diskIndex = JSON.parse(content);
                    
                    // Merge with current in-memory index (don't blindly replace)
                    const mergedIndex = this.mergeIndexes(this.index, diskIndex);
                    
                    // Update in-memory index
                    this.index = mergedIndex;
                    
                    // Update timestamps to prevent immediate save after reload
                    this.lastSaveTime = (Date.now() / 1000);
                    this.lastAlignTime = this.lastSaveTime;
                    
                } catch (err) {
                    // Ignore reload errors silently
                }
            };
            
            fs.watchFile(indexPath, { interval: 1000 }, () => {
                clearTimeout(reloadTimer);
                reloadTimer = setTimeout(reloadIndex, debounceMs);
            });
        };
        
        // Try to setup watch immediately if file exists
        if (fs.existsSync(indexPath)) {
            watchAndReload();
        } else {
            // Poll for file creation, then setup watch
            const checkInterval = setInterval(() => {
                if (fs.existsSync(indexPath)) {
                    clearInterval(checkInterval);
                    watchAndReload();
                }
            }, 2000);
            
            // Stop polling after 60 seconds
            setTimeout(() => clearInterval(checkInterval), 60000);
        }
        
        // Store indexPath for cleanup in dispose
        this._watchedIndexPath = indexPath;
    }
    mtime(key) {
        if(key) {
            const file = this.resolve(key)
            return (
                async () => {
                    const stat = await fs.promises.stat(file).catch(() => false)
                    if (stat && typeof(stat.size) == 'number') {
                        const mtime = stat.mtimeMs / 1000
                        if(this.index[key]) {
                            if(!this.index[key].time || this.index[key].time < mtime) {
                                this.index[key].time = mtime
                            }
                        } else {
                            return mtime
                        }
                    }                
                    return this.index[key] ? this.index[key].time : 0
                }
            )().catch(err => console.error(err))
        } else {
            const lastTouchTime = Math.max(...Object.keys(this.index).map(key => this.index[key].time)) || 0
            return Math.max(lastTouchTime, this.lastAlignTime || 0)
        }
    }
    mergeIndexes(memoryIndex, diskIndex) {
        const merged = { ...memoryIndex };
        
        // Merge disk index into memory index
        for (const [key, diskEntry] of Object.entries(diskIndex)) {
            const memEntry = merged[key];
            
            if (!memEntry) {
                // Only in disk: add to merged (unless deleted without file)
                if (diskEntry.delete === true) {
                    const file = this.resolve(key);
                    const hasFile = fs.existsSync(file);
                    if (!hasFile) {
                        continue; // Don't add deleted entries without files
                    }
                }
                merged[key] = { ...diskEntry };
            } else {
                // In both: merge intelligently
                // Prefer entry with higher time (more recent)
                const memTime = memEntry.time || 0;
                const diskTime = diskEntry.time || 0;
                
                if (diskTime > memTime) {
                    // Disk is newer, but check if memory has newer expiration
                    const memExp = memEntry.expiration || 0;
                    const diskExp = diskEntry.expiration || 0;
                    
                    if (memExp > diskExp) {
                        // Memory has newer expiration, merge both
                        merged[key] = {
                            ...diskEntry,
                            expiration: memExp
                        };
                    } else {
                        // Disk is fully newer
                        merged[key] = { ...diskEntry };
                    }
                } else {
                    // Memory is newer or equal, keep memory but check expiration
                    const memExp = memEntry.expiration || 0;
                    const diskExp = diskEntry.expiration || 0;
                    if (diskExp > memExp) {
                        merged[key] = {
                            ...memEntry,
                            expiration: diskExp
                        };
                    } else {
                        // Keep memory as-is
                        merged[key] = memEntry;
                    }
                }
            }
        }
        
        return merged;
    }

    async save(options = {}) {
        if (!this.opts.main) return // Only main process should save index
        
        // Use saveLimiter by default, unless skipLimiter is set
        if (options.skipLimiter) {
            return this._performSave()
        } else {
            return this.saveLimiter.call()
        }
    }

    async _performSave() {
        if (!this.opts.main) return // Only main process should save index
        if (this.mtime() < this.lastSaveTime)
            return
        // Ensure directory exists
        await fs.promises.mkdir(this.opts.folder, { recursive: true }).catch(() => {})
        
        // Read current index from disk and merge with memory
        const indexPath = this.opts.folder +'/'+ this.indexFile;
        let diskIndex = {};
        try {
            if (fs.existsSync(indexPath)) {
                const content = await fs.promises.readFile(indexPath, 'utf8').catch(() => '{}');
                if (content && content.trim()) {
                    diskIndex = JSON.parse(content);
                }
            }
        } catch (err) {
            // Ignore errors reading disk index, use memory only
            console.warn('Storage: Could not read disk index for merge:', err.message);
        }
        
        // Merge indexes before saving
        const mergedIndex = this.mergeIndexes(this.index, diskIndex);
        
        // Add version to index before saving
        const indexWithVersion = { ...mergedIndex, _version: STORAGE_INDEX_VERSION };
        
        // Use a more predictable filename to reduce file handle usage
        const tmp = this.opts.folder +'/'+ 'temp_' + Date.now() + '_' + process.pid + '_' + Math.floor(Math.random()*1000000) + '.commit'
        this.lastSaveTime = (Date.now() / 1000)
        try {
            await fs.promises.writeFile(tmp, JSON.stringify(indexWithVersion), 'utf8')
            
            // Verify temp file exists before moving
            await fs.promises.access(tmp)
            
            await moveFile(tmp, indexPath);
            
            // Update in-memory index to reflect merged state (without version)
            this.index = mergedIndex;
        } catch (err) {
            // Clean up temp file on error (check if it exists first)
            try {
                await fs.promises.access(tmp)
                await fs.promises.unlink(tmp)
            } catch (cleanupErr) {
                // Temp file doesn't exist or can't be deleted, ignore
            }
            console.error('Storage save error:', err)
        }
    }

    saveSync(options = {}) {
        if (!this.opts.main) return // Only main process should save index
        
        // For sync operations, skipLimiter is always used (since limiter is async)
        // This is called during process shutdown or error handling
        return this._performSaveSync()
    }

    _performSaveSync() {
        if (!this.opts.main) return // Only main process should save index
        if (this.mtime() < this.lastSaveTime)
            return
        this.lastSaveTime = (Date.now() / 1000)
        
        // Read current index from disk and merge with memory
        const indexPath = this.opts.folder +'/'+ this.indexFile;
        let diskIndex = {};
        try {
            if (fs.existsSync(indexPath)) {
                const content = fs.readFileSync(indexPath, 'utf8');
                if (content && content.trim()) {
                    diskIndex = JSON.parse(content);
                }
            }
        } catch (err) {
            // Ignore errors reading disk index, use memory only
        }
        
        // Merge indexes before saving
        const mergedIndex = this.mergeIndexes(this.index, diskIndex);
        
        // Add version to index before saving
        const indexWithVersion = { ...mergedIndex, _version: STORAGE_INDEX_VERSION };
        
        const tmp = this.opts.folder + '/' + parseInt(Math.random() * 100000) + '.commit'
        fs.writeFileSync(tmp, JSON.stringify(indexWithVersion), 'utf8')
        try {
            fs.unlinkSync(indexPath)
            fs.renameSync(tmp, indexPath)
            
            // Update in-memory index to reflect merged state
            this.index = mergedIndex;
        } catch (e) {
            fs.unlinkSync(tmp)
        }
    }
    async align() {
        let left = this.opts.maxDiskUsage;
        const now = parseInt((Date.now() / 1000));
        this.lastAlignTime = now;
        
        const idleKeys = Object.keys(this.index).filter(key => {
            if(!this.index[key]) return false;
            return !this.index[key].time || (now - this.index[key].time) > this.opts.minIdleTime;
        });
        
        if (idleKeys.length > 0) {
            const mtimePromises = idleKeys.map(key => this.mtime(key));
            await Promise.allSettled(mtimePromises);
        }
        
        const ordered = Object.keys(this.index).filter(a => {
            if (!this.index[a]) return // bad value or deleted in mean time
            if (this.index[a].permanent || this.locked[a]) {
                if (typeof(this.index[a].size) == 'number') {
                    left -= this.index[a].size
                }
                return false
            }
            return true
        }).sort((a, b) => {
            return (this.index[a].time > this.index[b].time) ? -1 : ((this.index[a].time < this.index[b].time) ? 1 : 0);
        });
        const removals = ordered.filter(key => {
            if(!this.index[key]) return // bad value or deleted in mean time
            if (this.index[key].expiration && (now > this.index[key].expiration)) {
                this.index[key].expired = true;
                return true // expired
            }
            const elapsed = now - this.index[key].time
            if (elapsed < this.opts.minIdleTime) {
                return false
            }
            if (typeof(this.index[key].size) == 'number') {
                left -= this.index[key].size
                return left <= 0
            }
            return false
        })
        
        if (removals.length > 0) {
            const removalPromises = removals.map(async key => {
                if(!this.index[key]) return; // bad value or deleted in mean time
                // const size = this.index[key].size
                // const elapsed = now - this.index[key].time
                // const expired = this.index[key].expired ? ', expired' : ''
                // console.log('LRU cache eviction '+ key +' ('+ size + expired +') after '+ elapsed +'s idle')                
                await this.delete(key)
            });
            await Promise.allSettled(removalPromises);
        }
        
        await this.save(); // always
    }
    validateTouchSync(key, atts) {
        if (!atts || typeof atts !== 'object') atts = {};
        const entry = this.index[key]
        if (!entry) return Object.keys(atts)
        if (entry.delete === true) {
            return [
                {
                    key,
                    attr: 'delete',
                    before: false,
                    after: true
                }
            ]
        }
        if (atts.expiration && typeof entry.expiration === 'number' && atts.expiration < entry.expiration) {
            return false
        }
        if (atts.time && typeof entry.time === 'number' && atts.time < entry.time) {
            return false
        }
        const changed = Object.keys(atts).filter(k => {
            return (k === 'expiration' || k === 'time') ? 
                (typeof entry[k] === 'number' && atts[k] > entry[k] && Math.abs(atts[k] - entry[k]) > 5) : // ignore minor time changes (performance), if something else changed it will pass
                (atts[k] != entry[k])
        }).map(k => {
            return {
                key,
                attr: k,
                before: entry[k],
                after: atts[k]
            }
        })
        return changed
    }
    async touch(key, atts, doNotPropagate) {
        // Apply prepareKey only if key doesn't already have valid scope prefix (global/ or profiles/)
        if (!this.hasValidScope(key)) {
            key = this.prepareKey(key);
        }
        if (atts && atts.delete === true) { // IPC sync only
            if (this.index[key]) {
                delete this.index[key]
                this.emit('delete', key)
            }
            return
        }
        if (atts === false) return
        const time = parseInt((Date.now() / 1000))
        if (typeof this.index[key] !== 'object' || this.index[key] === null) {
            this.index[key] = {}
        }
        const entry = this.index[key]
        if (typeof atts !== 'object' || atts === null) atts = {}
        
        const prevAtts = Object.assign({}, atts)        
        atts = this.calcExpiration(atts || {}, entry)
        if (typeof(atts.expiration) != 'number' || !atts.expiration) {
            delete atts.expiration
        }
        atts.time = time
        if (typeof(atts.size) != 'number') {            
            const stat = await fs.promises.stat(this.resolve(key)).catch(() => {})
            if (stat && stat.size) {
                atts.size = stat.size
            } else {
                delete atts.size
            }
        }
        const prevValues = Object.assign({}, entry)
        this.index[key] = Object.assign(entry, atts)
        
        // Save expiration sidecar if expiration is present (only in main process to avoid race conditions)
        if (this.opts.main) {
            const value = this.index[key];
            const expiration = value.expiration || prevValues.expiration;
            if (expiration) {
                const file = this.resolve(key);
                const expFile = this.expiresPath(file);
                if (expFile === file) {
                    if (this.opts && this.opts.debug) console.warn(`[storage] Skipping writing expiration sidecar because computed expFile equals data file: ${file}`);
                } else {
                    fs.promises.writeFile(expFile, String(expiration), 'utf8').catch(() => {});
                }
            }
        }
        
        if(doNotPropagate !== true) { // IPC sync only
            this.emit('touch', key, this.index[key])
            if (this.opts.main) { // only main process should align/save index, worker will sync through IPC		
                this.alignLimiter.call() // will call saver when done
            } else {
                // Worker: notify main process to persist index
                if (this.emit && typeof this.emit === 'function') {
                    if (paths.inWorker && typeof global.__storageTouchBridge === 'function' && this.listenerCount('storage-touch') === 0) {
                        global.__storageTouchBridge({ key, entry: this.index[key] })
                    }
                    this.emit('storage-touch', { key, entry: this.index[key] })
                }
            }
        }
    }
    
    async touchFile(filePath, atts, doNotPropagate) {
        // Extract key from file path for index management
        const key = this.unresolve(filePath)
        
        if (atts && atts.delete === true) { // IPC sync only
            if (this.index[key]) {
                delete this.index[key]
                this.emit('delete', key)
            }
            return
        }
        if (atts === false) return
        
        const time = parseInt((Date.now() / 1000))
        if (typeof this.index[key] !== 'object' || this.index[key] === null) {
            this.index[key] = {}
        }
        
        const entry = this.index[key]
        if (typeof atts !== 'object' || atts === null) atts = {}
        const prevAtts = Object.assign({}, atts)        
        atts = this.calcExpiration(atts || {}, entry)
        if (typeof(atts.expiration) != 'number' || !atts.expiration) {
            delete atts.expiration
        }
        atts.time = time
        
        if (typeof(atts.size) != 'number') {            
            const stat = await fs.promises.stat(filePath).catch(() => {})
            if (stat && stat.size) {
                atts.size = stat.size
            } else {
                delete atts.size
            }
        }
        
        const prevValues = Object.assign({}, entry)
        this.index[key] = Object.assign(entry, atts)
        
        // Save expiration sidecar if expiration is present (only in main process to avoid race conditions)
        if (this.opts.main && this.index[key] && this.index[key].expiration) {
            const expFile = this.expiresPath(filePath);
            if (expFile === filePath) {
                if (this.opts && this.opts.debug) console.warn(`[storage] Skipping writing expiration sidecar because computed expFile equals data file: ${filePath}`);
            } else {
                fs.promises.writeFile(expFile, String(this.index[key].expiration), 'utf8').catch(() => {});
            }
        }
        
        if(doNotPropagate !== true) { // IPC sync only
            this.emit('touch', key, this.index[key])
            if (this.opts.main) { // only main process should align/save index, worker will sync through IPC		
                this.alignLimiter.call() // will call saver when done
            } else {
                // Worker: notify main process to persist index
                if (this.emit && typeof this.emit === 'function') {
                    if (paths.inWorker && typeof global.__storageTouchBridge === 'function' && this.listenerCount('storage-touch') === 0) {
                        global.__storageTouchBridge({ key, entry: this.index[key] })
                    }
                    this.emit('storage-touch', { key, entry: this.index[key] })
                }
            }
        }
    }

    async registerFile(filePath, opts = {}) {
        if (!filePath) {
            return
        }
        
        const atts = {
            size: typeof opts.size !== 'undefined' ? opts.size : 'auto'
        }

        if (opts.raw !== undefined) {
            atts.raw = opts.raw
        }

        if (typeof opts.expiration === 'number') {
            atts.expiration = opts.expiration
        } else if (typeof opts.ttl === 'number') {
            atts.ttl = opts.ttl
        } else if (opts.permanent === true) {
            atts.permanent = true
        }

        if (opts.compress === true) {
            atts.compress = true
        }

        return this.touchFile(filePath, atts, opts.doNotPropagate)
    }
}

class StorageIO extends StorageIndex {
    constructor(opts) {
        super(opts);
        this.profileAuth = new ProfileAuth();
        this.currentProfile = null;
        this.migrationCompleted = false;
        this.lazyMigrations = new Set(); // Track lazy migrations
        this.migrationStats = {
            migrated: 0,
            failed: 0,
            skipped: 0
        };
    }

    // Method to set current profile
    setCurrentProfile(profileId) {
        this.currentProfile = profileId;
    }

    // Method to set profile authentication
    setProfileAuth(profileId, key) {
        this.profileAuth.setAuth(profileId, key);
    }

    // auth() method as requested
    auth(profileId) {
        return {
            setKey: (key) => this.setProfileAuth(profileId, key),
            getKey: () => this.profileAuth.getAuth(profileId),
            isOpen: () => this.profileAuth.isOpen(profileId),
            clear: () => this.profileAuth.clearAuth(profileId)
        };
    }

    async getOld(key, opts={}) {
        // Ensure initial migration was checked
        await this.ensureMigrationReady();

        // Try search with new structure first
        let result = await this.getWithNewStructure(key, opts);

        // Fallback to lazy migration if not found
        if (result === null) {
            result = await this.tryLazyMigration(key, opts);
        }

        return result;
    }

    async getWithNewStructure(key, opts={}) {
        // Don't apply prepareKey if key already has valid scope prefix
        if (!this.hasValidScope(key)) {
            key = this.prepareKey(key);

            // Try direct key first (for non-personal/non-sensitive data)
            let result = await this.getByKey(key, opts);

            // If not found, try as personal (with current profile)
            if (result === null) {
                let actualKey = `profiles/${this.currentProfile || 'default'}/${key}`;
                result = await this.getByKey(actualKey, opts);
            }

            // If not found, try as global
            if (result === null) {
                let actualKey = `global/${key}`;
                result = await this.getByKey(actualKey, opts);
            }

            return result;
        } else {
            // Key already has valid scope, use it directly
            return this.getByKey(key, opts);
        }
    }

    async getByKey(key, opts={}) {
        if (!this.index[key]) {
            // Try auto-heal if not in index
            const healed = await this.tryAutoHealKey(key).catch(() => false);
            if (!healed) {
                if(opts.throwIfMissing === true) {
                    throw new Error('Key not found: '+ key)
                }
                return null;
            }
        }
        const row = this.index[key]
        if (!row) {
            if(opts.throwIfMissing === true) {
                throw new Error('Key not found: '+ key)
            }
            return null;
        }

        // grab this row to mem to avoid losing it due to its deletion in meanwhile, maybe using a lock() would be better
        if (opts.encoding !== null && typeof(opts.encoding) != 'string') {
            if (row.compress) {
                opts.encoding = null
            } else {
                opts.encoding = 'utf-8'
            }
        }
        await this.touch(key, false) // wait writing on file to finish before to re-enable access

        // Acquire lock and ensure it's released
        const lock = await this.lock(key, false);
        try {
            // Revalidate row after potential async operations (race condition protection)
            if (!this.index[key]) {
                if(opts.throwIfMissing === true) {
                    throw new Error('Key was deleted during processing: '+ key)
                }
                return null;
            }
            const row = this.index[key];
            if (!row || !row.expiration) {
                if(opts.throwIfMissing === true) {
                    throw new Error('Key entry is invalid: '+ key)
                }
                return null;
            }
            const now = (Date.now() / 1000)
            if (row.expiration < now) {
                if(opts.throwIfMissing === true) {
                    throw new Error('Key expired: '+ key)
                }
                return null
            }
            const file = this.resolve(key);
            const stat = await fs.promises.stat(file).catch(() => {});
            const exists = stat && typeof(stat.size) == 'number';
            if (exists) {
                let err;
                await this.touch(key, { size: stat.size });
                let content = await fs.promises.readFile(file, { encoding: opts.encoding }).catch(e => err = e);
                if (!err) {
                    if (row.compress) {
                        content = await this.decompress(content)
                    }
                    if (row.raw) {
                        return content;
                    } else {
                        if (Buffer.isBuffer(content)) { // is buffer
                            content = String(content);
                        }
                        if (content != 'undefined') {
                            try {
                                let j = parse(content);
                                if (j && j != null) {
                                    // Decrypt if necessary
                                    if (row.encrypted) {
                                        const profileId = this.extractProfileFromKey(key);
                                        const authKey = this.profileAuth.getAuth(profileId);
                                        if (authKey) {
                                            j = await this.decryptContent(j, authKey);
                                        } else {
                                            // Cannot decrypt - profile not authenticated
                                            if (opts.throwIfMissing === true) {
                                                throw new Error('Profile not authenticated: ' + profileId);
                                            }
                                            return null;
                                        }
                                    }
                                    return j;
                                }
                            }
                            catch (e) {}
                        }
                    }
                }
            }
            if(opts.throwIfMissing === true) {
                throw new Error('Key not found: '+ key)
            }
            return null;
        } finally {
            // Always release the lock
            lock.release();
        }
    }

    // Hybrid Migration System for Retro-Compatibility
    async ensureMigrationReady() {
        if (this.migrationCompleted) return;

        // Check if bulk migration was already done
        const migrationFlagKey = 'migration-profiles-system-v1';
        const alreadyMigrated = await this.getLegacyData(migrationFlagKey);

        if (!alreadyMigrated) {
            // Try quick migration of critical data
            await this.attemptCriticalDataMigration();
            // Mark as completed
            this.migrationCompleted = true;
        } else {
            this.migrationCompleted = true;
        }
    }

    async attemptCriticalDataMigration() {
        const criticalKeys = ['playlists', 'favorites', 'bookmarks'];

        for (const key of criticalKeys) {
            try {
                if (await this.hasLegacyData(key)) {
                    const data = await this.getLegacyData(key);
                    if (data !== null) {
                        console.log(`🔄 Migrating critical data: ${key}`);
                        await this.migrateDataToNewStructure(key, data);
                        this.migrationStats.migrated++;
                    }
                }
            } catch (error) {
                console.warn(`⚠️ Failed to migrate critical key ${key}:`, error.message);
                this.migrationStats.failed++;
            }
        }
    }

    async tryLazyMigration(key, opts) {
        // Avoid migration loops
        if (this.lazyMigrations.has(key)) return null;

        try {
            // Check if legacy data exists
            const legacyData = await this.getLegacyData(key);
            if (legacyData !== null) {
                console.log(`🔄 Lazy migrating: ${key}`);
                await this.migrateDataToNewStructure(key, legacyData);
                this.lazyMigrations.add(key);
                this.migrationStats.migrated++;
                return legacyData;
            }
        } catch (error) {
            console.warn(`⚠️ Lazy migration failed for ${key}:`, error.message);
            this.migrationStats.failed++;
        }

        return null;
    }

    async migrateDataToNewStructure(key, data) {
        // Create backup before migration
        await this.createMigrationBackup(key, data);

        // Determine if it's personal or global data
        const isPersonal = this.isPersonalDataKey(key);
        const shouldEncrypt = this.isSensitiveDataKey(key);

        try {
            if (isPersonal) {
                // Migrate to personal profile
                await this.set(key, data, {
                    personal: true,
                    sensitive: shouldEncrypt,
                    profileId: this.currentProfile || 'default'
                });
            } else {
                // Migrate to global
                await this.set(key, data, { personal: false });
            }

            // After successful migration, remove legacy file
            await this.removeLegacyData(key);

        } catch (error) {
            console.error(`❌ Migration failed for ${key}:`, error);
            await this.restoreMigrationBackup(key);
            throw error;
        }
    }

    async createMigrationBackup(key, data) {
        // Create backup directly, without going through migration system
        const backupKey = `migration-backup-${key}-${Date.now()}`;
        const backupFile = this.resolve(backupKey);

        try {
            // Create directory if it doesn't exist
            const dir = path.dirname(backupFile);
            await fs.promises.mkdir(dir, { recursive: true }).catch(() => {});

            // Save backup directly as JSON
            const backupData = JSON.stringify({
                key,
                data,
                timestamp: Date.now(),
                version: 'migration-backup-v1'
            });

            await fs.promises.writeFile(backupFile, backupData, 'utf8');

            // Update index
            await this.touch(backupKey, {
                size: backupData.length,
                permanent: true,
                time: Date.now() / 1000
            });

        } catch (error) {
            console.warn(`⚠️ Could not create backup for ${key}:`, error.message);
        }
    }

    async restoreMigrationBackup(key) {
        // In a complete implementation, we would search for the most recent backup
        // and restore the legacy file
        console.warn(`⚠️ Migration rollback needed for ${key} - manual intervention required`);
    }

    async hasLegacyData(key) {
        // Check if legacy file exists (without profiles/ or global/ prefixes)
        const legacyFile = this.resolve(key);
        try {
            await fs.promises.access(legacyFile);
            return true;
        } catch {
            return false;
        }
    }

    async getLegacyData(key) {
        // Read data directly from legacy file
        const legacyFile = this.resolve(key);
        try {
            const stat = await fs.promises.stat(legacyFile).catch(() => null);
            if (!stat) return null;

            const content = await fs.promises.readFile(legacyFile, 'utf8');
            if (content && content.trim()) {
                const row = this.index[key];
                let parsed = content;

                // Decompress if necessary
                if (row && row.compress) {
                    parsed = await this.decompress(Buffer.from(content));
                }

                // Parse JSON if not raw
                if (row && !row.raw && parsed !== 'undefined') {
                    try {
                        const j = parse(parsed);
                        return j && j !== null ? j : null;
                    } catch (e) {
                        return null;
                    }
                }

                return parsed;
            }
        } catch (error) {
            // Silently ignore errors when checking legacy data
        }
        return null;
    }

    async removeLegacyData(key) {
        try {
            const legacyFile = this.resolve(key);
            await fs.promises.unlink(legacyFile).catch(() => {});

            // Remove from index if exists
            if (this.index[key]) {
                delete this.index[key];
            }
        } catch (error) {
            console.warn(`⚠️ Could not remove legacy data for ${key}:`, error.message);
        }
    }

    isNewStructureKey(key) {
        // Check if the key is already in the new structure
        return this.hasValidScope(key);
    }

    isPersonalDataKey(key) {
        // List of keys that are considered personal data
        const personalKeys = [
            'favorites', 'bookmarks', 'user-tasks', 'search', 'trending-current',
            'recorder-schedules', 'cast-known-devices', 'stream-state',
            'discovery', 'bsdk-last-mtime', 'pac-', 'history', 'playlists'
        ];

        return personalKeys.some(personalKey =>
            key.startsWith(personalKey) || key.includes(personalKey)
        );
    }

    isSensitiveDataKey(key) {
        // Data that contains sensitive information that should be encrypted
        const sensitiveKeys = [
            'playlists', 'pac-', 'credentials', 'auth', 'api-keys'
        ];

        return sensitiveKeys.some(sensitiveKey =>
            key.includes(sensitiveKey)
        );
    }

    extractProfileFromKey(key) {
        const match = key.match(/^profiles\/([^\/]+)\//);
        return match ? match[1] : 'default';
    }

    extractScopeFromKey(key) {
        return key.startsWith('global/') ? 'global' : 'personal';
    }

    // Encryption methods
    async encryptContent(content, key) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipher('aes-256-gcm', key);
        cipher.setAAD(Buffer.from('storage-data'));

        let encrypted = cipher.update(JSON.stringify(content), 'utf8', 'hex');
        encrypted += cipher.final('hex');

        return {
            data: encrypted,
            iv: iv.toString('hex'),
            tag: cipher.getAuthTag().toString('hex')
        };
    }

    async decryptContent(encryptedData, key) {
        const decipher = crypto.createDecipher('aes-256-gcm', key);
        decipher.setAuthTag(Buffer.from(encryptedData.tag, 'hex'));
        decipher.setAAD(Buffer.from('storage-data'));

        let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return JSON.parse(decrypted);
    }

    async set(key, content, atts) {
        // Note: prepareKey is now called INSIDE applyScopeAndEncryption to avoid stripping scope slashes
        // Process new personal/sensitive parameters
        const processedAtts = this.processStorageAttributes(atts);

        // Apply scope and encryption (prepareKey is applied to base key inside)
        const result = await this.applyScopeAndEncryption(key, content, processedAtts);
        result.content = content; // preserve original content

        // Use write queue with the processed key
        return this.queueWrite(result.key, async () => {
            const lock = await this.lock(result.key, true), t = typeof(result.atts);
            if (t == 'boolean' || t == 'number') {
                if (t == 'number') {
                    result.atts += (Date.now() / 1000);
                }
                result.atts = { expiration: result.atts };
            }
            if (result.atts.encoding !== null && typeof(result.atts.encoding) != 'string') {
                if (result.atts.compress) {
                    result.atts.encoding = null;
                } else {
                    result.atts.encoding = 'utf-8';
                }
            }
            let file = this.resolve(result.key, 'dat');
            if (result.atts.raw && typeof(result.content) != 'string' && !Buffer.isBuffer(result.content))
                result.atts.raw = false;
            if (!result.atts.raw)
                result.content = JSON.stringify(result.content);
            if (result.atts.compress)
                result.content = await this.compress(result.content);
            await this.write(file, result.content, result.atts.encoding).catch(err => console.error(err));

            await this.touch(result.key, Object.assign(result.atts, { size: result.content.length }));

            // Save expiration sidecar file AFTER touch() (which calculates expiration via calcExpiration)
            const finalExp = this.index[result.key]?.expiration;
            if (typeof finalExp === 'number' && finalExp > 0) {
                const expFile = this.expiresPath(file);
                if (expFile === file) {
                    if (this.opts && this.opts.debug) console.warn(`[storage] Skipping writing expiration sidecar because computed expFile equals data file: ${file}`);
                } else {
                    await fs.promises.writeFile(expFile, String(finalExp), 'utf8').catch(() => {});
                }
            }

            lock.release()
        });
    }

    // Process the attributes of the new API
    processStorageAttributes(atts = {}) {
        const processed = { ...atts };

        // personal: true/false (default false)
        const personal = processed.personal || false;
        delete processed.personal;

        // sensitive: defaults to personal value, only can be true if personal==true
        let sensitive = processed.sensitive;
        if (typeof sensitive === 'undefined') {
            sensitive = personal; // defaults to personal value
        } else if (sensitive && !personal) {
            throw new Error('sensitive can only be true if personal is true');
        }
        delete processed.sensitive;

        return {
            ...processed,
            personal,
            sensitive
        };
    }

    // Apply scope and encryption
    async applyScopeAndEncryption(key, content, atts) {
        // Apply prepareKey to the BASE key first (before adding scope prefix)
        // This ensures slashes in scope prefixes are preserved
        const baseKey = this.prepareKey(key);
        
        let finalKey = baseKey;
        let finalContent = content;
        let finalAtts = { ...atts };

        const profileId = atts.profileId || this.currentProfile || 'default';

        // Apply scope - note: baseKey is already sanitized, scope prefix is added cleanly
        if (atts.personal) {
            finalKey = `profiles/${profileId}/${baseKey}`;
        } else if (atts.sensitive) {
            finalKey = `global/${baseKey}`; // Sensitive data goes to global with encryption
        } else {
            finalKey = baseKey; // No scope for non-personal, non-sensitive data
        }

        // Apply encryption if necessary
        if (atts.sensitive && !this.profileAuth.isOpen(profileId)) {
            const authKey = this.profileAuth.getAuth(profileId);
            if (authKey) {
                finalContent = await this.encryptContent(content, authKey);
                finalAtts.encrypted = true;
            }
        }

        return {
            key: finalKey,
            content: finalContent,
            atts: finalAtts
        };
    }

    hasValidScope(key) {
        if (typeof key !== 'string' || !key.length) {
            return false;
        }
        return key.startsWith('global/') || key.startsWith('profiles/');
    }

    // Modification of get() method to support profiles
    async get(key, opts = {}) {
        // Don't apply prepareKey if key already has valid scope prefix
        if (!this.hasValidScope(key)) {
            key = this.prepareKey(key);

            // Try direct key first (for non-personal/non-sensitive data)
            let result = await this.getByKey(key, opts);

            // If not found, try as personal (with current profile)
            if (result === null) {
                let actualKey = `profiles/${this.currentProfile || 'default'}/${key}`;
                result = await this.getByKey(actualKey, opts);
            }

            // If not found, try as global
            if (result === null) {
                let actualKey = `global/${key}`;
                result = await this.getByKey(actualKey, opts);
            }

            return result;
        } else {
            // Key already has valid scope, use it directly
            return await this.getByKey(key, opts);
        }
    }

    // Utilities to extract information from keys
    extractProfileFromKey(key) {
        const match = key.match(/^profiles\/([^\/]+)\//);
        return match ? match[1] : 'default';
    }

    // Encryption methods
    async encryptContent(content, key) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipher('aes-256-gcm', key);
        cipher.setAAD(Buffer.from('storage-data'));

        let encrypted = cipher.update(JSON.stringify(content), 'utf8', 'hex');
        encrypted += cipher.final('hex');

        return {
            data: encrypted,
            iv: iv.toString('hex'),
            tag: cipher.getAuthTag().toString('hex')
        };
    }

    async decryptContent(encryptedData, key) {
        const decipher = crypto.createDecipher('aes-256-gcm', key);
        decipher.setAuthTag(Buffer.from(encryptedData.tag, 'hex'));
        decipher.setAAD(Buffer.from('storage-data'));

        let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return JSON.parse(decrypted);
    }
    
    // Queue system for write operations
    async queueWrite(key, writeOperation) {
        // Get or create queue for this key
        if (!this.writeQueue.has(key)) {
            this.writeQueue.set(key, []);
        }
        const queue = this.writeQueue.get(key);
        
        // Get or create lock for this key's queue
        if (!this.writeQueueLocks.has(key)) {
            this.writeQueueLocks.set(key, false);
        }
        
        return new Promise((resolve, reject) => {
            const queueItem = { writeOperation, resolve, reject };
            queue.push(queueItem);
            
            // Process queue if not already processing
            if (!this.writeQueueLocks.get(key)) {
                this.processWriteQueue(key);
            }
        });
    }
    
    async processWriteQueue(key) {
        const queue = this.writeQueue.get(key);
        const lock = this.writeQueueLocks.get(key);
        
        if (!queue || queue.length === 0 || lock) {
            return;
        }
        
        // Set lock to prevent concurrent processing
        this.writeQueueLocks.set(key, true);
        
        try {
            while (queue.length > 0) {
                const item = queue.shift();
                const remainingItems = queue.length;
                try {
                    if (this.opts.debug) {
                        console.log(`Processing write queue for key: ${key}, remaining items: ${remainingItems}`);
                    }
                    
                    const result = await item.writeOperation();
                    item.resolve(result);
                } catch (error) {
                    console.error(`Write operation failed for key ${key}:`, error);
                    item.reject(error);
                }
            }
        } finally {
            // Release lock
            this.writeQueueLocks.set(key, false);
            
            // Clean up empty queues
            if (queue.length === 0) {
                this.writeQueue.delete(key);
                this.writeQueueLocks.delete(key);
                if (this.opts.debug) {
                    console.log(`Write queue cleaned up for key: ${key}`);
                }
            }
        }
    }
    calcExpiration(atts, prevAtts) {
        if (typeof atts !== 'object' || atts === null) atts = {};
        if (typeof(atts.expiration) == 'number') return atts
        const now = (Date.now() / 1000)
        if (typeof(atts.ttl) == 'number') {
            atts.expiration = now + atts.ttl;
            delete atts.ttl;
        } else if (!atts.expiration && !atts.permanent) {
            atts.expiration = now + 600; // default = 10min
            if (prevAtts && prevAtts.expiration > atts.expiration) {
                atts.expiration = prevAtts.expiration;
            }
        } else {
            atts.expiration = now + this.opts.maxExpiration; // true = forever (100 years)
        }
        return atts;
    }
    setTTL(key, expiration) {
        if (expiration === false) {
            expiration = 600 // default = 10min
        } else if (expiration === true || typeof(expiration) != 'number') {
            expiration = this.opts.maxExpiration // true = forever (100 years)
        }
        expiration = (Date.now() / 1000) + expiration
        this.touch(key, { size: 'auto', expiration })
    }
    async tryAutoHealKey(key) {
        key = this.prepareKey(key);
        const file = this.resolve(key);
        
        // Check if data file exists
        const stat = await fs.promises.stat(file).catch(() => null);
        if (!stat || typeof stat.size !== 'number') {
            return false; // No data file, can't heal
        }
        
        // Check for expiration sidecar
        const expFile = file.replace(/\.dat$/, '.expires.json');
        const expRaw = await fs.promises.readFile(expFile, 'utf8').catch(() => null);
        
        if (!expRaw) {
            return false; // No expiration known, don't auto-heal
        }
        
        const exp = parseInt(expRaw.trim());
        if (isNaN(exp) || exp <= 0) {
            return false; // Invalid expiration
        }
        
        // Reindex with exact expiration
        const now = (Date.now() / 1000);
        const mtime = stat.mtimeMs / 1000;
        
        await this.touch(key, {
            size: stat.size,
            time: mtime,
            expiration: exp
        });
        
        return true;
    }

    expiration(key) {
        let lookupKey;

        if (this.hasValidScope(key)) {
            lookupKey = key;
        } else {
            const preparedKey = this.prepareKey(key);
            // Try personal first, then global
            const personalKey = `profiles/${this.currentProfile || 'default'}/${preparedKey}`;
            const globalKey = `global/${preparedKey}`;

            if (this.index[personalKey] && this.index[personalKey].expiration) {
                return this.index[personalKey].expiration;
            }
            if (this.index[globalKey] && this.index[globalKey].expiration) {
                return this.index[globalKey].expiration;
            }
            lookupKey = preparedKey;
        }

        if (this.index[lookupKey] && this.index[lookupKey].expiration) {
            return this.index[lookupKey].expiration;
        }
        // Note: Auto-heal is async, called from async methods (get/exists)
        return 0;
    }
    async exists(key) {
        if (!this.hasValidScope(key)) {
            const preparedKey = this.prepareKey(key);

            // Try personal scope first
            const personalKey = `profiles/${this.currentProfile || 'default'}/${preparedKey}`;
            if (this.index[personalKey]) {
                const file = this.resolve(personalKey);
                const stat = await fs.promises.stat(file).catch(() => {});
                if (stat && typeof(stat.size) == 'number') {
                    return true;
                }
            }

            // Try global scope
            const globalKey = `global/${preparedKey}`;
            if (this.index[globalKey]) {
                const file = this.resolve(globalKey);
                const stat = await fs.promises.stat(file).catch(() => {});
                if (stat && typeof(stat.size) == 'number') {
                    return true;
                }
            }

            // Try direct key (fallback for old entries)
            if (this.has(preparedKey)) {
                const file = this.resolve(preparedKey);
                const stat = await fs.promises.stat(file).catch(() => {});
                if (stat && typeof(stat.size) == 'number') {
                    return true;
                }
            }

            // Try auto-heal if not found
            const healed = await this.tryAutoHealKey(preparedKey).catch(() => false);
            if (healed && this.index[preparedKey]) {
                return true;
            }

            return false;
        } else {
            // Key already has valid scope, check directly
            if (this.index[key]) {
                const file = this.resolve(key);
                const stat = await fs.promises.stat(file).catch(() => {});
                if (stat && typeof(stat.size) == 'number') {
                    return true;
                }
            }
            return false;
        }
    }
    has(key) {
        let lookupKey;

        if (this.hasValidScope(key)) {
            lookupKey = key;
        } else {
            const preparedKey = this.prepareKey(key);
            // Try personal first, then global
            const personalKey = `profiles/${this.currentProfile || 'default'}/${preparedKey}`;
            const globalKey = `global/${preparedKey}`;

            if (this.index[personalKey]) {
                lookupKey = personalKey;
            } else if (this.index[globalKey]) {
                lookupKey = globalKey;
            } else {
                lookupKey = preparedKey;
            }
        }

        if (!this.index[lookupKey])
            return false;
        const expiral = this.expiration(lookupKey);
        return (expiral > (Date.now() / 1000));
    }
    async write(file, content, enc) {
        if (typeof(content) == 'number') {
            content = String(content);
        }        
        // Ensure directory exists
        const dir = path.dirname(file)
        await fs.promises.mkdir(dir, { recursive: true }).catch(() => {})
        
        // Use a more predictable filename to reduce file handle usage
        const tmpFile = path.join(dir, 'temp_' + Date.now() + '_' + process.pid + '_' + Math.floor(Math.random()*1000000)) + '.commit';
        
        const maxRetries = 3;
        let lastError;
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                await fs.promises.writeFile(tmpFile, content, enc);
                
                // More robust verification that temp file exists and is readable
                const exists = await fs.promises.access(tmpFile).then(() => true).catch(() => false);
                if (!exists) {
                    throw new Error('Temporary file was deleted before move operation');
                }
                
                // Verify file has some content (but don't be too strict about exact size)
                const stat = await fs.promises.stat(tmpFile);
                if (stat.size === 0) {
                    throw new Error('Temporary file is empty');
                }
                
                await moveFile(tmpFile, file);
                return; // Success
                
            } catch (err) {
                lastError = err;
                
                // Clean up temp file on error (check if it exists first)
                try {
                    await fs.promises.access(tmpFile);
                    await fs.promises.unlink(tmpFile);
                } catch (cleanupErr) {
                    // Temp file doesn't exist or can't be deleted, ignore
                }
                
                // Retry logic for specific errors
                if ((err.code === 'ENOENT' || err.message.includes('Temporary file') || err.message.includes('empty') || err.message.includes('deleted')) && attempt < maxRetries - 1) {
                    console.warn(`Storage write attempt ${attempt + 1} failed for ${path.basename(file)}, retrying...`, err.message);
                    await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1))); // Exponential backoff
                    continue;
                }
                
                console.error(`Storage write error for ${path.basename(file)}:`, err.message);
                throw err;
            }
        }
        
        // If we get here, all retries failed
        console.error(`Storage write failed after all retries for ${path.basename(file)}:`, lastError.message);
        throw lastError;
    }
    async delete(key, removeFile) {
        // Handle scoped keys differently than simple keys
        if (this.hasValidScope(key)) {
            // Key already has valid scope, delete directly
            return this.deleteByKey(key, removeFile);
        } else {
            // Simple key - try both personal and global scopes
            const preparedKey = this.prepareKey(key);

            // Try personal first
            const personalKey = `profiles/${this.currentProfile || 'default'}/${preparedKey}`;
            if (this.index[personalKey]) {
                return this.deleteByKey(personalKey, removeFile);
            }

            // Try global
            const globalKey = `global/${preparedKey}`;
            if (this.index[globalKey]) {
                return this.deleteByKey(globalKey, removeFile);
            }

            // Fallback - delete with prepared key directly
            return this.deleteByKey(preparedKey, removeFile);
        }
    }

    async deleteByKey(key, removeFile) {
        const files = []
        for (const ext of this.knownExtensions) {
            files.push(this.resolve(key, ext)) // before deleting from index
        }
        if (removeFile !== null) {
            for (const file of files) {
                await fs.promises.unlink(file).catch(() => {})
            }
            // Also delete expiration sidecar if exists
            const dataFile = this.resolve(key);
            const expFile = dataFile.replace(/\.dat$/, '.expires.json');
            await fs.promises.unlink(expFile).catch(() => {})
        }
        if (removeFile && !files.includes(removeFile)) {
            await fs.promises.unlink(removeFile).catch(() => {})
        }
        if (this.index[key]) {
            delete this.index[key]
        }
        this.emit('touch', key, { delete: true }) // IPC notify
    }
}

class Storage extends StorageIO {
    constructor(opts) {
        super(opts)
        this.unlockListeners = {};
        this.setMaxListeners(99)
        
        // Add lock cleanup interval to prevent orphaned locks
        this.lockCleanupInterval = setInterval(() => {
            this.cleanupOrphanedLocks();
        }, 60000); // Clean up every minute
        
        // Add process exit handler for cleanup
        process.on('exit', () => {
            this.dispose();
        });
        
        // Handle SIGINT and SIGTERM
        process.on('SIGINT', () => {
            this.dispose();
            process.exit(0);
        });
        
        process.on('SIGTERM', () => {
            this.dispose();
            process.exit(0);
        });
        
        fs.access(this.opts.folder, err => {
            if (err) {
                fs.mkdir(this.opts.folder, { recursive: true }, (err) => {
                    if (err) {
                        console.error(err)
                    }
                })
            }
        })
    }
    
    // Enable debug mode for troubleshooting
    enableDebug() {
        this.opts.debug = true;
        console.log('Storage debug mode enabled');
    }
    
    // Disable debug mode
    disableDebug() {
        this.opts.debug = false;
        console.log('Storage debug mode disabled');
    }
    
    // Get lock status for debugging
    getLockStatus() {
        const status = {
            activeLocks: Object.keys(this.locked).length,
            waitingQueues: Object.keys(this.unlockListeners).length,
            writeQueues: this.writeQueue.size,
            writeQueueLocks: this.writeQueueLocks.size,
            details: {}
        };
        
        // Add details for each active lock
        for (const [key, lockTime] of Object.entries(this.locked)) {
            const lockAge = Date.now() - lockTime;
            const waitingCount = this.unlockListeners[key] ? this.unlockListeners[key].length : 0;
            const hasWriteOperations = this.unlockListeners[key] && this.unlockListeners[key].some(l => l.write === true);
            
            status.details[key] = {
                lockAge: Math.round(lockAge / 1000) + 's',
                waitingCount,
                hasWriteOperations,
                isWriteLock: typeof lockTime === 'number'
            };
        }
        
        return status;
    }
    
    // Print lock status for debugging
    printLockStatus() {
        const status = this.getLockStatus();
        console.log('=== Storage Lock Status ===');
        console.log(`Active locks: ${status.activeLocks}`);
        console.log(`Waiting queues: ${status.waitingQueues}`);
        console.log(`Write queues: ${status.writeQueues}`);
        console.log(`Write queue locks: ${status.writeQueueLocks}`);
        
        if (Object.keys(status.details).length > 0) {
            console.log('Lock details:');
            for (const [key, detail] of Object.entries(status.details)) {
                console.log(`  ${key}: age=${detail.lockAge}, waiting=${detail.waitingCount}, write=${detail.hasWriteOperations}`);
            }
        }
        console.log('==========================');
    }
    
    // Emergency cleanup - force clear all locks and queues
    emergencyCleanup() {
        console.warn('=== EMERGENCY STORAGE CLEANUP ===');
        
        const lockCount = Object.keys(this.locked).length;
        const listenerCount = Object.keys(this.unlockListeners).length;
        const queueCount = this.writeQueue.size;
        const queueLockCount = this.writeQueueLocks.size;
        
        // Clear all locks
        this.locked = {};
        this.unlockListeners = {};
        this.writeQueue.clear();
        this.writeQueueLocks.clear();
        
        console.warn(`Cleared ${lockCount} locks, ${listenerCount} listeners, ${queueCount} write queues, ${queueLockCount} queue locks`);
        console.warn('=== EMERGENCY CLEANUP COMPLETE ===');
    }
    
    // Clean up orphaned locks that might be stuck
    cleanupOrphanedLocks() {
        const now = Date.now();
        const maxWriteLockAge = 120000; // 2 minutes for write locks
        const maxReadLockAge = 300000;  // 5 minutes for read locks
        
        for (const [key, lockTime] of Object.entries(this.locked)) {
            if (typeof lockTime === 'number') {
                const lockAge = now - lockTime;
                // Check if there are any write operations waiting in the queue
                const hasWriteOperations = this.unlockListeners[key] && this.unlockListeners[key].some(l => l.write === true);
                const maxAge = hasWriteOperations ? maxWriteLockAge : maxReadLockAge;
                
                if (lockAge > maxAge) {
                    console.warn(`Cleaning up orphaned ${hasWriteOperations ? 'write' : 'read'} lock for key: ${key}, age: ${Math.round(lockAge/1000)}s`);
                    delete this.locked[key];
                    delete this.unlockListeners[key];
                }
            }
        }
    }
    
    // Cleanup method to dispose of resources
    dispose() {
        if (this.lockCleanupInterval) {
            clearInterval(this.lockCleanupInterval);
            this.lockCleanupInterval = null;
        }
        
        // Stop watching index file
        if (this._indexWatchSetup && this._watchedIndexPath) {
            fs.unwatchFile(this._watchedIndexPath);
            this._indexWatchSetup = false;
            this._watchedIndexPath = null;
        }
        
        // Clear all locks and listeners
        this.locked = {};
        this.unlockListeners = {};
        this.writeQueue.clear();
        this.writeQueueLocks.clear();
        
        if (this.opts.debug) {
            console.log('Storage resources cleaned up');
        }
    }
    
    // Override lock method to track lock times
    lock(key, write) {
        const lockPromise = new Promise((resolve, reject) => {
            // Reduced timeout values to prevent long waits
            const timeoutMs = write ? 10000 : 15000; // 10s for writes, 15s for reads
            
            // Add timeout to prevent deadlocks
            const timeout = setTimeout(() => {
                console.error(`Lock timeout for key: ${key}, write: ${write}, timeout: ${timeoutMs}ms`);
                // Don't reject immediately, try to clean up first
                this.cleanupLock(key);
                reject(new Error(`Mutex acquisition timeout after ${timeoutMs}ms`));
            }, timeoutMs);
            
            if (this.locked[key]) {
                if (this.opts.debug) {
                    console.log(`Lock waiting for key: ${key}, write: ${write}, current lock: ${this.locked[key]}`);
                }
                
                if (this.unlockListeners[key]) {
                    // Add write operations to the front of the queue for priority
                    const queueItem = { resolve, reject, write, timeout };
                    if (write) {
                        this.unlockListeners[key].unshift(queueItem);
                    } else {
                        this.unlockListeners[key].push(queueItem);
                    }
                } else {
                    this.unlockListeners[key] = [{ resolve, reject, write, timeout }];
                }
            } else {
                if (write) {
                    this.locked[key] = Date.now(); // Track lock time
                    if (this.opts.debug) {
                        console.log(`Lock acquired for key: ${key}, write: ${write}`);
                    }
                }
                
                const release = () => {
                    clearTimeout(timeout);
                    
                    if (write && this.locked[key]) {
                        delete this.locked[key];
                        if (this.opts.debug) {
                            console.log(`Lock released for key: ${key}, write: ${write}`);
                        }
                    }
                    
                    if (this.unlockListeners[key]) {
                        const listener = this.unlockListeners[key].shift();
                        if (listener) {
                            clearTimeout(listener.timeout);
                            this.lock(key, listener.write).then(ret => listener.resolve(ret)).catch(listener.reject);
                        }
                        if (this.unlockListeners[key].length === 0) {
                            delete this.unlockListeners[key];
                        }
                    }
                }
                
                resolve({ release });
            }
        });
        
        // Add error handling to prevent unhandled rejections
        lockPromise.catch(err => {
            if (err.message && err.message.includes('Mutex acquisition timeout')) {
                console.warn(`Mutex timeout handled for key: ${key}, write: ${write}`);
            }
        });
        
        return lockPromise;
    }
    
    // Cleanup method for stuck locks
    cleanupLock(key) {
        try {
            // Clear any pending listeners for this key
            if (this.unlockListeners[key]) {
                this.unlockListeners[key].forEach(listener => {
                    if (listener.timeout) {
                        clearTimeout(listener.timeout);
                    }
                });
                delete this.unlockListeners[key];
            }
            
            // Force release the lock
            if (this.locked[key]) {
                delete this.locked[key];
                if (this.opts.debug) {
                    console.log(`Force released stuck lock for key: ${key}`);
                }
            }
        } catch (err) {
            console.error(`Error cleaning up lock for key ${key}:`, err);
        }
    }
    
    resolve(key, ext=null) {
        const originalKey = key;

        // Don't apply prepareKey if key already has valid scope prefix (global/ or profiles/)
        const preparedKey = this.hasValidScope(key) ? key : this.prepareKey(key);

        // Try to find the key in index considering scope prefixes
        const possibleKeys = [
            preparedKey, // try exact key first (already scoped)
            `profiles/${this.currentProfile || 'default'}/${this.prepareKey(key)}`, // personal
            `global/${this.prepareKey(key)}`, // global
            this.prepareKey(key) // fallback for old keys without scope
        ];

        for (const scopedKey of possibleKeys) {
            if (this.index[scopedKey]) {
                if (this.index[scopedKey].file && (typeof(ext) !== 'string' || this.index[scopedKey].file.endsWith('.' + ext))) { // use the indexed file if available
                    // Check if the file actually exists
                    try {
                        fs.accessSync(this.index[scopedKey].file);
                        return this.index[scopedKey].file;
                    } catch (e) {
                        // File doesn't exist, remove from index
                        delete this.index[scopedKey];
                    }
                }
            }
        }

        // Fallback: generate filename first
        let filename;
        if (this.hasValidScope(originalKey)) {
            // Convert scoped key to safe filename: global/key -> global__key, profiles/default/key -> profiles__default__key
            filename = originalKey.replace(/\//g, '__');
        } else {
            filename = this.prepareKey(originalKey);
        }

        // Try to find existing files with known extensions, preferring larger 'jdb' files
        let candidateFiles = [];
        for (const testExt of this.knownExtensions) {
            if (typeof(ext) === 'string' && testExt !== ext) continue; // if specific ext requested, only try that
            const filePath = this.opts.folder + '/' + filename + '.' + testExt;
            try {
                const stat = fs.statSync(filePath);
                candidateFiles.push({ path: filePath, size: stat.size, ext: testExt });
            } catch (e) {
                // File doesn't exist
            }
        }
        if (candidateFiles.length > 0) {
            // Prefer 'jdb' files, and among them the largest
            const jdbFiles = candidateFiles.filter(f => f.ext === 'jdb').sort((a, b) => b.size - a.size);
            if (jdbFiles.length > 0) {
                return jdbFiles[0].path;
            }
            // If no 'jdb', return the first (or largest if multiple)
            candidateFiles.sort((a, b) => b.size - a.size);
            return candidateFiles[0].path;
        }

        // If no existing file, generate default path with .dat extension
        if (ext && !filename.endsWith('.' + ext)) {
            return this.opts.folder + '/' + filename + '.' + ext;
        } else if (!ext && !this.knownExtensions.some(knownExt => filename.endsWith('.' + knownExt))) {
            // If no extension specified and filename doesn't have a known extension, add .dat
            return this.opts.folder + '/' + filename + '.dat';
        }
        return this.opts.folder + '/' + filename;
    }
    unresolve(file) {
        let basename = path.basename(file);
        // Remove all known extensions recursively
        const extPattern = new RegExp('\\.(json|offsets\\.jdb|idx\\.jdb|dat|jdb)$');
        while (extPattern.test(basename)) {
            basename = basename.replace(extPattern, '');
        }
        let key = this.prepareKey(basename);
        // If the key contains '__', it's a scoped key, unscoped it
        if (key.includes('__')) {
            key = key.replace(/__/g, '/');
        }
        this.touch(key, false); // touch to update entry time and so warmp up our interest on it
        return key;
    }
    prepareKey(key) {
        return String(key).replace(new RegExp('[^A-Za-z0-9\\._\\- ]', 'g'), '').substr(0, 128);
    }
}

let instance;
if (globalThis.__storage_instance) {
    instance = globalThis.__storage_instance;
} else {
    instance = new Storage({ main: !paths.inWorker });
    globalThis.__storage_instance = instance;
}

export default instance;

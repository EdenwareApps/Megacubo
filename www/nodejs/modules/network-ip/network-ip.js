import { networkInterfaces } from "os";
import { execSync } from "node:child_process";

class NetworkIP {
    constructor() {
        this.androidSDKVerCache = null;
        this.networkIpCache = null;
        this.networkIpCacheTTL = 10;
    }
    execSync(cmd) {
        let stdout;
        try {
            stdout = execSync(cmd).toString();
        } catch (e) {
            stdout = String(e);
        }
        return stdout;
    }
    isNetworkIP(addr) {
        if (addr) {
            return (addr.startsWith('10.') || addr.startsWith('172.') || addr.startsWith('192.')) ? 'ipv4' : null;
        }
        return null;
    }
    androidSDKVer() {
        if (!this.androidSDKVerCache) {
            this.androidSDKVerCache = parseInt(this.execSync('getprop ro.build.version.sdk').trim());
        }
        return this.androidSDKVerCache;
    }
    networkDummyInterfaces(addr) {
        return {
            "Wi-Fi": [
                {
                    "address": addr,
                    "netmask": "255.255.255.0",
                    "family": "IPv4",
                    "mac": "00:00:00:00:00:00",
                    "internal": false
                }
            ],
            "Loopback Pseudo-Interface 1": [
                {
                    "address": "127.0.0.1",
                    "netmask": "255.0.0.0",
                    "family": "IPv4",
                    "mac": "00:00:00:00:00:00",
                    "internal": true,
                    "cidr": "127.0.0.1/8"
                }
            ]
        };
    }
    androidIPCommand() {
        return this.execSync('ip route get 8.8.8.8');
    }
    shouldPatchNetworkInterfaces() {
        if (process.platform === 'android') {
            const sdkVer = this.androidSDKVer();
            return isNaN(sdkVer) || sdkVer < 20 || sdkVer >= 29;
        }
    }
    networkInterfaces() {
        if (this.shouldPatchNetworkInterfaces()) {
            let addr, time = Date.now();
            if (this.networkIpCache && (this.networkIpCache.time + this.networkIpCacheTTL) > time) {
                addr = this.networkIpCache.addr;
            } else {
                const match = this.androidIPCommand().match(new RegExp('src +([0-9\.]+)'));
                if (match) {
                    addr = match[1];
                    this.networkIpCache = { addr, time };
                } else {
                    addr = this.networkIpCache ? this.networkIpCache.addr : '127.0.0.1';
                }
            }
            return this.networkDummyInterfaces(addr);
        }
        return networkInterfaces() // from 'os'
    }
    networkIP() {
        const interfaces = this.networkInterfaces()
        let addr = '127.0.0.1'
        const skipIfs = /^(vmware|virtualbox)$/i
        for (const devName in interfaces) {
            if (devName.match(skipIfs)) continue
            const iface = interfaces[devName]
            for (let i = 0; i < iface.length; i++) {
                const alias = iface[i];
                if (alias.family === 'IPv4' && !alias.internal && this.isNetworkIP(alias.address)) {
                    addr = alias.address
                    break
                }
            }
        }
        return addr
    }
}
export default new NetworkIP()

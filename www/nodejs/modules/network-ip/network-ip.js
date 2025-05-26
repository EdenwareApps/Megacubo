import { networkInterfaces as osNetworkInterfaces } from "os";
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
    networkDummyInterfaces(addr, iface) {
        return {
            [iface || "Wi-Fi"]: [
                {
                    address: addr,
                    netmask: "255.255.255.0",
                    family: "IPv4",
                    mac: "00:00:00:00:00:00",
                    internal: false
                }
            ],
            "Loopback Pseudo-Interface 1": [
                {
                    address: "127.0.0.1",
                    netmask: "255.0.0.0",
                    family: "IPv4",
                    mac: "00:00:00:00:00:00",
                    internal: true,
                    cidr: "127.0.0.1/8"
                }
            ]
        };
    }
    androidIPCommand() {
        return this.execSync('ip -4 r');
    }
    shouldPatchNetworkInterfaces() {
        if (process.platform === 'android') {
            const sdkVer = this.androidSDKVer();
            return isNaN(sdkVer) || sdkVer < 20 || sdkVer >= 29;
        }
        return false;
    }
    networkInterfaces() {
        if (this.shouldPatchNetworkInterfaces()) {
            let addr, iface, time = Date.now();
            if (this.networkIpCache && (this.networkIpCache.time + this.networkIpCacheTTL) > time) {
                addr = this.networkIpCache.addr;
                iface = this.networkIpCache.iface;
            } else {
                const output = this.androidIPCommand();
                // Find default route to get interface
                const defaultMatch = output.match(/default via ([\d.]+) dev (\S+)/);
                if (defaultMatch) {
                    const gateway = defaultMatch[1];
                    iface = defaultMatch[2];
                    // Find the route for the interface to get src IP
                    const srcMatch = output.match(new RegExp(`${iface}.*src (\\d+\\.\\d+\\.\\d+\\.\\d+)`));
                    if (srcMatch) {
                        addr = srcMatch[1];
                        this.networkIpCache = { addr, iface, time };
                    } else {
                        addr = this.networkIpCache ? this.networkIpCache.addr : '127.0.0.1';
                        iface = this.networkIpCache ? this.networkIpCache.iface : 'Wi-Fi';
                    }
                } else {
                    addr = this.networkIpCache ? this.networkIpCache.addr : '127.0.0.1';
                    iface = this.networkIpCache ? this.networkIpCache.iface : 'Wi-Fi';
                }
            }
            return this.networkDummyInterfaces(addr, iface);
        }
        return osNetworkInterfaces();
    }
    networkIP() {
        const interfaces = this.networkInterfaces();
        let addr = '127.0.0.1';
        const skipIfs = /^(vmware|virtualbox)$/i;
        for (const devName in interfaces) {
            if (devName.match(skipIfs)) continue;
            const iface = interfaces[devName];
            for (let i = 0; i < iface.length; i++) {
                const alias = iface[i];
                if (alias.family === 'IPv4' && !alias.internal && this.isNetworkIP(alias.address)) {
                    addr = alias.address;
                    break;
                }
            }
        }
        return addr;
    }
}
export default new NetworkIP();

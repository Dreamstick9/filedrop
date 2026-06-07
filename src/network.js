/**
 * src/network.js
 * Handles network interface discovery, filtering, and scoring.
 */
const os = require('os');
const { execSync } = require('child_process');
const platform = require('./platform');

function getFilterReason(name, info) {
    if (info.family !== 'IPv4') return 'not IPv4';
    if (info.internal || info.address.startsWith('127.')) return 'loopback';
    if (info.address.startsWith('169.254.')) return 'link-local';
    if (info.address.startsWith('172.17.0.')) return 'Docker bridge';
    
    const nameLower = name.toLowerCase();
    if (nameLower.startsWith('vmnet') || nameLower.startsWith('vboxnet') || nameLower.startsWith('utun')) return 'VM adapter';
    if (nameLower.startsWith('tun') || nameLower.startsWith('tap') || nameLower.startsWith('wg') || nameLower.startsWith('ppp')) return 'VPN tunnel';
    
    return null;
}

function scoreInterface(name, info) {
    let score = 0;
    const nameLower = name.toLowerCase();
    
    // Strong primary OS-specific preferences
    if (nameLower === 'en0') score += 1000;
    else if (nameLower === 'wlan0') score += 900;
    else if (nameLower === 'eth0') score += 800;
    
    // Name patterns
    if (nameLower.startsWith('en') || nameLower.startsWith('eth') || nameLower.startsWith('wlan') || nameLower.includes('wi-fi') || nameLower.includes('ethernet')) {
        score += 100;
    }
    
    // Subnet preferences
    if (info.address.startsWith('192.168.')) score += 50;
    else if (info.address.startsWith('10.')) score += 40;
    
    return score;
}

function isValidIPv4(ip) {
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipv4Regex.test(ip)) return false;
    for (const octet of ip.split('.')) {
        if (parseInt(octet, 10) > 255) return false;
    }
    return true;
}

function getInterface(options = {}) {
    const { bind, verbose } = options;
    const interfaces = os.networkInterfaces();
    
    const allIPv4 = [];
    
    for (const [name, infos] of Object.entries(interfaces)) {
        for (const info of infos) {
            if (info.family === 'IPv4') {
                allIPv4.push({ name, info });
            }
        }
    }
    
    if (bind) {
        if (!isValidIPv4(bind)) {
            console.error(`filedrop: error: Invalid IPv4 address provided to --bind: ${bind}\nRun 'filedrop --help' for usage.`);
            process.exit(1);
        }
        if (bind.startsWith('127.')) {
            console.error(`filedrop: error: Cannot bind to loopback address: ${bind}\nRun 'filedrop --help' for usage.`);
            process.exit(1);
        }
        
        const matched = allIPv4.find(i => i.info.address === bind);
        if (!matched) {
            console.error(`filedrop: error: The IP address ${bind} does not exist on any IPv4 interface on this machine.\nRun 'filedrop --help' for usage.`);
            process.exit(1);
        }
        
        return matched;
    }
    
    const usable = [];
    const filtered = [];
    
    for (const item of allIPv4) {
        const reason = getFilterReason(item.name, item.info);
        if (!reason) {
            usable.push(item);
        } else {
            filtered.push({ ...item, reason });
        }
    }
    
    if (usable.length === 0) {
        console.error('ERR_NO_INTERFACE: No usable non-loopback network interface found. Are you connected to a local network?');
        process.exit(2);
    }
    
    usable.sort((a, b) => {
        const scoreA = scoreInterface(a.name, a.info);
        const scoreB = scoreInterface(b.name, b.info);
        if (scoreA !== scoreB) {
            return scoreB - scoreA;
        }
        
        const metricA = a.info.metric !== undefined ? a.info.metric : 9999;
        const metricB = b.info.metric !== undefined ? b.info.metric : 9999;
        if (metricA !== metricB) {
            return metricA - metricB;
        }
        
        return a.name.localeCompare(b.name);
    });
    
    const selected = usable[0];
    
    if (verbose) {
        if (platform.isWindows()) {
            try {
                // Try to resolve GUIDs to friendly names using wmic (only in verbose mode)
                const wmicOutput = execSync('wmic nic get GUID,NetConnectionID /format:csv', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
                const lines = wmicOutput.split('\\n');
                const guidMap = {};
                for (const line of lines) {
                    const parts = line.trim().split(',');
                    if (parts.length >= 3) {
                        const guid = parts[1].trim();
                        const friendlyName = parts[2].trim();
                        if (guid && friendlyName) {
                            guidMap[guid] = friendlyName;
                        }
                    }
                }
                
                for (const item of usable) {
                    if (guidMap[item.name]) item.displayName = guidMap[item.name];
                }
                for (const item of filtered) {
                    if (guidMap[item.name]) item.displayName = guidMap[item.name];
                }
            } catch (e) {
                // Ignore wmic errors, just use GUIDs
            }
        }
        
        console.log('Network interfaces:');
        
        for (const item of usable) {
            const dispName = item.displayName || item.name;
            if (item === selected) {
                console.log(`  ✓  ${dispName.padEnd(7)} ${item.info.address.padEnd(15)} (selected)`);
            } else {
                console.log(`     ${dispName.padEnd(7)} ${item.info.address.padEnd(15)} (secondary)`);
            }
        }
        for (const item of filtered) {
            const dispName = item.displayName || item.name;
            console.log(`     ${dispName.padEnd(7)} ${item.info.address.padEnd(15)} (filtered: ${item.reason})`);
        }
    }
    
    const ip = selected.info.address;
    const isPrivate = ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip);
    if (!isPrivate) {
        console.warn(`Warning: Selected interface IP is ${ip}. Make sure your phone is on the same network.`);
    }
    
    return selected;
}

module.exports = {
    getInterface,
    getFilterReason,
    scoreInterface,
    isValidIPv4
};

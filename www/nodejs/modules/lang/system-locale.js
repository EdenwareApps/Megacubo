import path from 'node:path'
import { execFile } from 'node:child_process'

/**
 * Reads the locale/region configured in the operating system.
 *
 * The display language and the country are independent settings on every
 * desktop OS, so a user may run the system in English while still living in
 * another country (and expecting local content). Only the OS exposes that
 * distinction, so it is read here instead of relying on navigator.language.
 *
 * Returns `{ languages: string[], region: string|null, source: string }`, where
 * `region` is an ISO 3166-1 alpha-2 code and `languages` is the ordered list of
 * languages the user chose for the system.
 */
let cached = null

const run = (cmd, args) => new Promise(resolve => {
    // the queries below are quick (~1 s together), the timeout only exists to
    // avoid hanging the boot when the binary is missing or blocked by a
    // security tool, so it is generous on purpose
    execFile(cmd, args, { timeout: 10000, windowsHide: true, maxBuffer: 256 * 1024, encoding: 'utf8' }, (err, stdout) => {
        // reg.exe exits with a non-zero code when any of the sub keys it walked
        // is not readable, but the values it already printed are still valid, so
        // the output is kept instead of discarded.
        resolve(String(stdout || ''))
    })
})

const normalizeTag = tag => {
    if (typeof tag != 'string') return ''
    return tag.trim().replace(/[._]/g, '-')
}

// strips the charset/modifier of a POSIX locale (en_US.UTF-8@latin -> en-US)
const cleanPosix = value => normalizeTag(String(value || '').replace(/@.*$/, '')).replace(/-(UTF-8|utf8|iso.*)$/i, '')

export const parseWindowsInternational = output => {
    const values = {}
    const nested = new Set()
    let section = ''
    String(output || '').split(/\r?\n/).forEach(line => {
        const trimmed = line.trim()
        if (!trimmed) return
        if (/^HKEY_/i.test(trimmed)) {
            section = trimmed
            return
        }
        if (section.includes('\\International\\')) { // sub keys (Geo, User Profile, per language...)
            nested.add(section.split('\\International\\').pop())
        }
        const m = trimmed.match(/^(\S+)\s+REG_\w+\s+(.*)$/)
        if (!m) return
        const key = section.includes('\\International\\') ? section.split('\\International\\').pop() + '\\' + m[1] : m[1]
        values[key] = m[2]
    })
    const list = []
    // multi string values (display languages) are printed as "en-US\0pt-BR"
    String(values['User Profile\\Languages'] || '').split(/\\0|\u0000/).forEach(lng => {
        lng = normalizeTag(lng)
        if (lng && !list.includes(lng)) list.push(lng)
    })
    // "Country or region" setting (Windows 10+), independent from the display language
    let region = normalizeTag(values['Geo\\Name'] || '').toUpperCase()
    if (!/^[A-Z]{2}$/.test(region)) {
        // fall back to the region of the format locale (en-US -> US)
        const format = normalizeTag(values['LocaleName'] || '')
        const parts = format.split('-')
        region = parts.length > 1 && /^[A-Za-z]{2}$/.test(parts[parts.length - 1]) ? parts[parts.length - 1].toUpperCase() : ''
    }
    return {
        languages: list,
        region: /^[A-Z]{2}$/.test(region) ? region : null,
        formatLocale: normalizeTag(values['LocaleName'] || '') || null,
        source: 'windows-registry'
    }
}

export const parseAppleLocale = output => {
    const locale = normalizeTag(String(output || '').trim())
    const parts = locale.split('-')
    const region = parts.length > 1 && /^[A-Za-z]{2}$/.test(parts[parts.length - 1]) ? parts[parts.length - 1].toUpperCase() : null
    return { region, formatLocale: locale || null }
}

export const parseAppleLanguages = output => {
    const list = []
    const re = /"([^"]+)"/g
    let m
    while ((m = re.exec(String(output || ''))) !== null) {
        const lng = normalizeTag(m[1])
        if (lng && !list.includes(lng)) list.push(lng)
    }
    return list
}

export const parsePosixLocaleEnv = env => {
    env = env || {}
    const languages = []
    const push = value => {
        cleanPosix(value).split(':').forEach(lng => {
            lng = cleanPosix(lng)
            if (/^[a-z]{2,3}(-|$)/i.test(lng) && !languages.includes(lng)) languages.push(lng)
        })
    }
    // LANGUAGE holds the translation preference list, the other ones the format locale
    push(env.LANGUAGE)
    let formatLocale = ''
    for (const key of ['LC_ALL', 'LC_TIME', 'LC_MONETARY', 'LANG']) {
        const value = cleanPosix(env[key])
        if (value && !formatLocale) formatLocale = value
        push(value)
    }
    const parts = formatLocale.split('-')
    const region = parts.length > 1 && /^[A-Za-z]{2}$/.test(parts[parts.length - 1]) ? parts[parts.length - 1].toUpperCase() : null
    return { languages, region, formatLocale: formatLocale || null }
}

export const parseGnomeRegion = output => {
    const region = normalizeTag(String(output || '').replace(/['"\r\n]/g, ''))
    const parts = region.split('-')
    const code = parts.length > 1 ? parts[parts.length - 1] : region
    return /^[A-Za-z]{2}$/.test(code) ? code.toUpperCase() : null
}

// `getprop persist.sys.locale` on Android returns a single tag such as "pt-BR"
export const parseAndroidLocale = output => {
    const value = cleanPosix(output)
    if (!/^[a-z]{2,3}(-|$)/i.test(value)) return null
    const parts = value.split('-')
    const region = parts.length > 1 && /^[a-z]{2}$/i.test(parts[parts.length - 1]) ? parts[parts.length - 1].toUpperCase() : null
    return { languages: [value], region, formatLocale: value }
}

// Node/Electron report 'linux' on Android, but this runtime (capacitor-nodejs) reports 'android'
const isAndroid = () => process.platform == 'android' || !!(process.env.ANDROID_DATA || process.env.ANDROID_ROOT || (process.versions && process.versions.android))

const readWindows = async () => {
    const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe')
    const base = 'HKCU\\Control Panel\\International'
    // Walking the whole key with `/s` can take over 10 s on Windows 11 (it also
    // descends into the per language and emoji sub keys), which used to hit the
    // timeout above and lose the country/region value. Only the three values we
    // need are queried, each one taking a few milliseconds.
    const queries = [
        [base + '\\Geo', 'Name'], // "Country or region"
        [base, 'LocaleName'], // format locale, region fallback
        [base + '\\User Profile', 'Languages'] // preferred languages
    ]
    const outputs = await Promise.all(queries.map(([key, value]) => run(reg, ['query', key, '/v', value])))
    let output = outputs.filter(o => o).join('\n')
    if (!/REG_/.test(output)) { // reg.exe not found at that path, try the one from PATH
        output = ''
        for (const [key, value] of queries) {
            output += await run('reg', ['query', key, '/v', value])
        }
    }
    return output ? parseWindowsInternational(output) : null
}

const readMac = async () => {
    const [localeOut, languagesOut] = await Promise.all([
        run('defaults', ['read', '-g', 'AppleLocale']),
        run('defaults', ['read', '-g', 'AppleLanguages'])
    ])
    const locale = parseAppleLocale(localeOut)
    return { languages: parseAppleLanguages(languagesOut), region: locale.region, formatLocale: locale.formatLocale, source: 'macos-defaults' }
}

const readLinux = async () => {
    let info = parsePosixLocaleEnv(process.env)
    if (!info.languages.length || !info.region) {
        const output = await run('locale', [])
        const env = {}
        output.split(/\r?\n/).forEach(line => {
            const [key, value] = line.split('=')
            if (key && value) env[key.trim()] = value.replace(/^"|"$/g, '')
        })
        const fromCommand = parsePosixLocaleEnv({ ...process.env, ...env })
        info = {
            languages: info.languages.length ? info.languages : fromCommand.languages,
            region: info.region || fromCommand.region,
            formatLocale: info.formatLocale || fromCommand.formatLocale
        }
    }
    if (!info.region) { // GNOME keeps the region apart from the language (like Windows/macOS)
        const region = parseGnomeRegion(await run('gsettings', ['get', 'org.gnome.system.locale', 'region']))
        if (region) info = { ...info, region, source: 'gnome-region' }
    }
    return { languages: info.languages, region: info.region, formatLocale: info.formatLocale, source: info.source || 'posix-locale' }
}

// Android has no POSIX locale variables nor `locale`/`gsettings` binaries, the system locale lives in the props
const readAndroid = async () => {
    let fallback = null
    for (const prop of ['persist.sys.locale', 'ro.product.locale', 'ro.product.locale.language']) {
        const info = parseAndroidLocale(await run('getprop', [prop]) || await run('/system/bin/getprop', [prop]))
        if (!info) continue
        if (info.region) return { languages: info.languages, region: info.region, formatLocale: info.formatLocale, source: 'android-getprop' }
        fallback = fallback || info // "en" only
    }
    return fallback
        ? { languages: fallback.languages, region: null, formatLocale: fallback.formatLocale, source: 'android-getprop' }
        : { languages: [], region: null, formatLocale: null, source: 'android' }
}

export const getSystemLocaleInfo = async (force) => {
    if (cached && !force) return cached
    let info = null
    try {
        if (process.platform == 'win32') info = await readWindows()
        else if (process.platform == 'darwin') info = await readMac()
        else if (isAndroid()) info = await readAndroid()
        else info = await readLinux()
    } catch (err) {
        console.warn('⚠️ Could not read the system locale:', err.message)
    }
    cached = info || { languages: [], region: null, formatLocale: null, source: process.platform }
    return cached
}

export default getSystemLocaleInfo

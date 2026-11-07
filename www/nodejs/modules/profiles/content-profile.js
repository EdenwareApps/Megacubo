import { EventEmitter } from 'node:events'
import config from '../config/config.js'
import cloud from '../cloud/cloud.js'
import paths from '../paths/paths.js'
import lang from '../lang/lang.js'

/**
 * Content profile
 *
 * Three independent axes:
 *  - paths.EDITION          branding of the installer (seeds the profile once, never again)
 *  - content-profile        user intent: what the app should focus on ('' = general)
 *  - parental-control-age   restriction: how old the viewer is allowed to be
 *
 * The profile never changes the age, and the age never changes the profile:
 * an adult profile viewed with age < 18 is *suspended* (derived, not written),
 * so raising the age back restores it automatically.
 */

const GENERAL = ''

const PROFILES = [GENERAL, 'adult', 'sports', 'movies', 'series', 'kids', 'anime', 'news', 'music-video', 'religious']

const FALLBACK_LABELS = {
    pt: {
        '': 'Geral (todos os conteÃºdos)',
        adult: 'Adulto (+18)',
        sports: 'Esportes',
        movies: 'Filmes',
        series: 'SÃ©ries e novelas',
        kids: 'Infantil',
        anime: 'Anime / Otaku',
        news: 'NotÃ­cias',
        'music-video': 'MÃºsica',
        religious: 'Religioso'
    },
    en: {
        '': 'General (all contents)',
        adult: 'Adult (+18)',
        sports: 'Sports',
        movies: 'Movies',
        series: 'Series & soap operas',
        kids: 'Kids',
        anime: 'Anime / Otaku',
        news: 'News',
        'music-video': 'Music',
        religious: 'Religious'
    }
}

// Adult vocabulary blocked from the default (trending / most searched / channels)
// tags whenever the effective profile is not adult. The adult definition below is
// the source of truth for its own content; this covers the words that the wider
// search vocabulary picks up and that must not leak into kids/religious/etc.
const ADULT_EXTRA_VOCAB = ['sex', 'sexo', 'anal', 'nude', 'nudes', 'xxx', 'porn', 'porno', 'pornografia', 'hentai', 'erotic', 'erotico', 'erotica', 'sensual', 'sexy', 'hot', 'playboy', 'privado', 'acompanhante', 'pelada', 'peladas', 'transando']

// Used when the cloud (and the bundled fallback) has no `content-profiles` map.
// `strictness: 'add'` only contributes extra lists; 'only' also filters entries.
const BUILTIN_PROFILES = {
    adult: {
        lists: ['adult-iptv'],
        terms: ADULT_EXTRA_VOCAB,
        categories: ['adult', 'adulto', 'xxx', '18+', '+18'],
        tags: ['adult', '+18', 'adulto', 'adultos', 'xxx', 'sexo', 'sexual', 'erotico', 'erotica', 'erotic', 'porn', 'porno', 'hentai', 'sensual', 'sexy', 'playboy', 'sextreme', 'prive'],
        strictness: 'only'
    },
    sports: {
        lists: ['sports-iptv'],
        terms: ['sport', 'sports', 'esporte', 'esportes', 'futebol', 'football', 'soccer', 'nfl', 'nba', 'mlb', 'nhl', 'ufc', 'boxe', 'boxing', 'mma', 'f1', 'formula 1', 'motogp', 'nascar', 'olympic', 'olympiad', 'olimpiada', 'tennis', 'tenis', 'volei', 'volleyball', 'basquete', 'basketball', 'handball', 'surf', 'skate', 'golf', 'cricket', 'rugby', 'esportivo', 'espn'],
        categories: ['sports', 'esportes'],
        tags: ['sports', 'esporte', 'esportes', 'futebol', 'soccer', 'football', 'nba', 'nfl', 'ufc', 'mma', 'f1', 'formula', 'deporte', 'deportes', 'basquete', 'volei', 'tenis', 'espn', 'combate', 'automobilismo', 'lutam', 'premiere', 'payperview'],
        strictness: 'only'
    },
    movies: {
        lists: ['movies-iptv'],
        terms: ['movie', 'movies', 'filme', 'filmes', 'cinema', 'vod', 'hbo', 'netflix', 'telecine', 'megapix', 'paramount', 'universal', 'warner', 'lionsgate', 'studio'],
        categories: ['movies', 'filmes', 'cinema'],
        tags: ['movies', 'movie', 'filmes', 'filme', 'cinema', 'hbo', 'telecine', 'megapix', 'paramount', 'warner', 'acao', 'suspense', 'terror', 'comedia', 'oscar', 'lancamentos', 'aventura', 'ficcao', 'guerra', 'policial'],
        strictness: 'only'
    },
    series: {
        lists: ['series-iptv'],
        terms: ['serie', 'series', 'novela', 'novelas', 'temporada', 'season', 'episodio', 'episode', 'sitcom', 'drama', 'dorama', 'doramas', 'dorameira', 'dorameiras', 'kdrama', 'k-drama', 'cdrama', 'c-drama', 'jdrama', 'j-drama', 'telenovela', 'telenovelas', 'novela turca', 'novelas turcas'],
        categories: ['series', 'novelas', 'soap', 'doramas', 'dorama'],
        tags: ['series', 'serie', 'novelas', 'novela', 'temporada', 'episodio', 'sitcom', 'sitcoms', 'drama', 'maratona', 'dorama', 'doramas', 'dorameira', 'kdrama', 'k-drama', 'cdrama', 'telenovela', 'novela turca'],
        strictness: 'only'
    },
    kids: {
        lists: ['kids-iptv'],
        terms: ['kids', 'crianca', 'criancas', 'infantil', 'cartoon', 'cartoons', 'desenho', 'desenhos', 'anime', 'animes', 'disney', 'nickelodeon', 'gulli', 'baby', 'junior', 'toon'],
        categories: ['kids', 'infantil', 'children'],
        tags: ['kids', 'cartoon', 'anime', 'animes', 'infantil', 'desenho', 'desenhos', 'crianca', 'criancas', 'disney', 'nickelodeon', 'junior', 'toon', 'animacao', 'animados', 'animado', 'family', 'familia'],
        strictness: 'only'
    },
    anime: {
        lists: ['anime-iptv'],
        terms: ['anime', 'animes', 'otaku', 'otakus', 'manga', 'mangas', 'shonen', 'shounen', 'seinen', 'shojo', 'shoujo', 'mecha', 'isekai', 'tokusatsu', 'animax', 'crunchyroll', 'naruto', 'one piece', 'dragon ball', 'dragonball', 'bleach', 'saint seiya', 'cavaleiros do zodiaco'],
        categories: ['anime', 'animes', 'otaku'],
        tags: ['anime', 'animes', 'otaku', 'manga', 'mangas', 'shonen', 'seinen', 'shojo', 'isekai', 'mecha', 'tokusatsu', 'ova'],
        strictness: 'only'
    },
    news: {
        lists: ['news-iptv'],
        terms: ['news', 'noticia', 'noticias', 'jornal', 'jornalismo', 'cnn', 'bbc', 'fox news', 'sky news', 'euronews', 'globo news', 'band news', 'record news', 'bloomberg', 'cnbc', 'al jazeera', 'france 24', 'dw'],
        categories: ['news', 'noticias'],
        tags: ['news', 'noticias', 'noticia', 'jornal', 'jornalismo', 'cnn', 'bbc', 'globo news', 'band news', 'record news', 'euronews', 'debate', 'documentario', 'documentarios'],
        strictness: 'only'
    },
    'music-video': {
        lists: ['music-iptv'],
        terms: ['music', 'musica', 'musical', 'mtv', 'vh1', 'clipe', 'clipes', 'hits', 'kiss tv', 'trace', 'stingray'],
        categories: ['music', 'musica'],
        tags: ['music', 'musica', 'mtv', 'clipes', 'clipe', 'hits', 'show', 'festival', 'sertanejo', 'funk', 'rock', 'musicais', 'videoclipes'],
        strictness: 'only'
    },
    religious: {
        lists: ['religious-iptv'],
        terms: ['religio', 'religiao', 'religious', 'gospel', 'igreja', 'church', 'catolic', 'cristao', 'crista', 'evangelic', 'deus', 'islam', 'judaism', 'budism', 'hindu', 'tv aparecida', 'canÃ§Ã£o nova', 'cancao nova'],
        categories: ['religious', 'religioso'],
        tags: ['religious', 'gospel', 'religiao', 'igreja', 'culto', 'missa', 'fe', 'deus', 'cristao', 'evangelico', 'catolico', 'terco', 'religioso', 'religiosos'],
        strictness: 'only'
    }
}

const normalize = (str) => String(str == null ? '' : str).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Brand and genre names that carry a profile word without its meaning: "Adult Swim"
 * is a cartoon channel and "Young Adult" is a family genre, so matching them as
 * adult content is a false positive.
 */
const FALSE_FRIENDS = ['young adult', 'adult swim']

/** Removes brand/genre names from a raw metadata string before tag matching. */
function stripFalseFriends(text) {
    let out = normalize(text)
    for (const phrase of FALSE_FRIENDS) {
        if (out.includes(phrase)) {
            out = out.split(phrase).join(' ')
        }
    }
    return out
}

class ContentProfile extends EventEmitter {
    constructor() {
        super()
        this.setMaxListeners(32)
        this.configure = {}
        this.migrated = false
        this._compiled = {}
        this._profileSources = new Map()
        this._unsubConfigure = cloud.sync('configure', c => {
            this.configure = (c && typeof c == 'object') ? c : {}
            this._compiled = {}
            this._profileSources = new Map()
            this.migrate()
        })
        // config may be loaded before cloud data arrives; migrate as soon as possible
        this.migrate()
        config.on('change', (keys) => {
            if (keys.includes('content-profile') || keys.includes('parental-control-age')) {
                this._compiled = {}
                this._profileSources = new Map()
                this.emit('changed', this.state())
            }
        })
    }

    /**
     * Profiles known by this build (the UI uses this order), plus any profile the
     * cloud configuration declares so it can be offered without an app update.
     */
    codes() {
        const ret = PROFILES.slice(0)
        for (const code of Object.keys(this.definitions())) {
            const normalized = String(code || '').trim().toLowerCase()
            if (normalized && !ret.includes(normalized)) {
                ret.push(normalized)
            }
        }
        return ret
    }

    definitions() {
        const fromCloud = this.configure && this.configure['content-profiles']
        if (fromCloud && typeof fromCloud == 'object' && Object.keys(fromCloud).length) {
            return Object.assign({}, BUILTIN_PROFILES, fromCloud)
        }
        return BUILTIN_PROFILES
    }

    definition(code) {
        code = this.normalizeCode(code)
        if (!code) {
            return null
        }
        const defs = this.definitions()
        return defs[code] || null
    }

    normalizeCode(code) {
        code = String(code == null ? '' : code).trim().toLowerCase()
        if (!code || code == 'generic' || code == 'default' || code == 'general') {
            return GENERAL
        }
        if (PROFILES.includes(code)) {
            return code
        }
        // Profiles declared by the cloud configuration are valid codes even when
        // this build has no hardcoded entry for them.
        const def = this.definitions()[code]
        const declared = def && typeof def == 'object' &&
            (Array.isArray(def.terms) || Array.isArray(def.tags) || Array.isArray(def.lists) || typeof def.strictness == 'string')
        return declared ? code : GENERAL
    }

    /**
     * Profile pinned by the installer: `content-profile` in configure.json, or
     * the adult edition. Empty when the installer left the choice to the user.
     */
    installerProfile() {
        const raw = this.configure && this.configure['content-profile']
        const code = this.normalizeCode(Array.isArray(raw) ? raw[0] : raw)
        if (code) {
            return code
        }
        const edition = String(paths.EDITION || '').toLowerCase()
        return (edition == 'ero' || edition == 'adult') ? 'adult' : GENERAL
    }

    installerDefined() {
        const raw = this.configure && this.configure['content-profile']
        const declared = Array.isArray(raw) ? raw[0] : raw
        if (declared != null && String(declared).trim()) {
            // An explicit key is a decision from the installer, even when it means "general"
            return true
        }
        const edition = String(paths.EDITION || '').toLowerCase()
        return edition == 'ero' || edition == 'adult'
    }

    /**
     * Waits briefly for configure.json so installer-defined options are known
     * before the wizard decides whether to ask the user for a profile.
     */
    async ready(timeout = 5000) {
        if (Object.keys(this.configure).length) {
            return this.configure
        }
        const data = await Promise.race([
            cloud.get('configure').catch(() => null),
            new Promise(resolve => setTimeout(() => resolve(null), timeout))
        ])
        if (data && typeof data == 'object' && !Object.keys(this.configure).length) {
            this.configure = data
            this._compiled = {}
        this._profileSources = new Map()
            this.seedFromInstaller()
        }
        return this.configure
    }

    /**
     * Applies the installer profile while the user hasn't chosen one. Idempotent,
     * so a late configure.json download still seeds the profile.
     */
    seedFromInstaller() {
        const installed = this.installerProfile()
        if (!installed) {
            return GENERAL
        }
        if (!config.userSet('content-profile')) {
            config.set('content-profile', installed)
        }
        if (installed == 'adult' && !config.userSet('parental-control-age')) {
            config.set('parental-control-age', 18)
        }
        return installed
    }

    /**
     * One-time migration: the installer seeds the profile (and, for adult, releases
     * +18 by default). After that it never touches the user's choices again.
     */
    migrate() {
        this.seedFromInstaller()
        if (this.migrated || config.userSet('content-profile-version')) {
            this.migrated = true
            return
        }
        config.set('content-profile-version', 1)
        this.migrated = true
    }

    // ----------------------------------------------------------------- state

    /** Stored intent ('' = general). */
    profile() {
        return this.normalizeCode(config.get('content-profile'))
    }

    /** Maximum allowed age rating; 18 means +18 content is released. */
    maxAge() {
        const age = parseInt(config.get('parental-control-age'), 10)
        return isNaN(age) ? 16 : age
    }

    adultAllowed() {
        return this.maxAge() >= 18
    }

    /**
     * Profile actually in force. An adult profile requested by a viewer under
     * 18 stays remembered but is suspended until the age allows it again.
     */
    effective() {
        const code = this.profile()
        if (code == 'adult' && !this.adultAllowed()) {
            return GENERAL
        }
        return code
    }

    isSuspended() {
        return this.profile() == 'adult' && !this.adultAllowed()
    }

    state() {
        return {
            profile: this.profile(),
            effective: this.effective(),
            suspended: this.isSuspended(),
            age: this.maxAge(),
            adultAllowed: this.adultAllowed()
        }
    }

    setProfile(code) {
        code = this.normalizeCode(code)
        if (code !== GENERAL && !this.definition(code)) {
            code = GENERAL
        }
        config.set('content-profile-user-changed', true)
        // Suspend instead of discarding: raising the age again restores the
        // adult intent without any further user action.
        config.set('content-profile', code)
        return this.state()
    }

    /**
     * An adult installer selection is trusted until the user changes profiles.
     * Selecting Adult again after that change must pass the normal PIN gate.
     */
    isInstallerAdult() {
        return this.installerProfile() == 'adult' &&
            this.profile() == 'adult' &&
            !config.userSet('content-profile-user-changed')
    }

    setMaxAge(age) {
        age = parseInt(age, 10)
        if (isNaN(age)) {
            return this.state()
        }
        config.set('parental-control-age', Math.max(0, Math.min(18, age)))
        return this.state()
    }

    // ----------------------------------------------------------------- labels

    label(code) {
        code = this.normalizeCode(code)
        // 'GENERIC'/'ERO' are the keys this app already ships for these two
        // options, so their translations are reused across all locales.
        const key = code == 'adult' ? 'CONTENT_PROFILE_ERO'
            : (code ? 'CONTENT_PROFILE_' + code.toUpperCase().replace(/-/g, '_') : 'CONTENT_PROFILE_GENERIC')
        const locale = String((lang && (lang.locale || lang.language)) || 'en').toLowerCase()
        const table = locale.startsWith('pt') ? FALLBACK_LABELS.pt : FALLBACK_LABELS.en
        const label = (lang && lang[key]) || table[code]
        if (label) {
            return label
        }
        // A profile declared only by the cloud can carry its own label, either as
        // a plain string or as a per-locale map.
        const def = this.definition(code)
        const custom = def && def.label
        if (typeof custom == 'string' && custom.trim()) {
            return custom.trim()
        }
        if (custom && typeof custom == 'object') {
            const value = custom[locale.slice(0, 2)] || custom.en || Object.values(custom).find(v => v)
            if (typeof value == 'string' && value.trim()) {
                return value.trim()
            }
        }
        return code
    }

    // ------------------------------------------------------------------ lists

    /** Resolve a `*-iptv` key (or a raw URL) from the cloud configuration. */
    resolveListUrl(key) {
        if (!key || typeof key != 'string') {
            return null
        }
        if (/^https?:\/\//i.test(key)) {
            return key
        }
        const val = this.configure[key]
        if (typeof val == 'string' && val.trim()) {
            return val.trim()
        }
        if (Array.isArray(val)) {
            const first = val.find(u => typeof u == 'string' && u.trim())
            if (first) {
                return first.trim()
            }
        }
        return null
    }

    listsForProfile(code) {
        const def = this.definition(code)
        if (!def) {
            return []
        }
        const keys = Array.isArray(def.lists) ? def.lists : (def.lists ? [def.lists] : [])
        const ret = []
        for (const key of keys) {
            const url = this.resolveListUrl(key)
            if (url && !ret.includes(url)) {
                ret.push(url)
            }
        }
        return ret
    }

    /** Lists that the profile in force wants to be downloaded. */
    listsForDiscovery() {
        return this.listsForProfile(this.effective())
    }

    /**
     * Whether a list is one the profile in force bundles (e.g. the adult list).
     * Everything inside those lists belongs to the profile by origin, so the
     * vocabulary filter must not touch it: the adult catalog groups its content
     * under niche names ("Brunette", "MILF") that never match the profile terms,
     * and filtering them left a single group behind.
     * @param {string} url - List URL
     * @returns {boolean}
     */
    isProfileSource(url) {
        if (!url || typeof url != 'string') {
            return false
        }
        const code = this.effective()
        // Called once per entry while filtering big lists, so keep the answer.
        const cache = this._profileSources || (this._profileSources = new Map())
        const key = `${code}|${url}`
        if (cache.has(key)) {
            return cache.get(key)
        }
        const value = this.listsForProfile(code).includes(url)
        if (cache.size > 64) {
            cache.clear()
        }
        cache.set(key, value)
        return value
    }

    /** Every list that belongs to any profile (used to drop stale ones). */
    allProfileListUrls() {
        const ret = []
        for (const code of this.codes()) {
            for (const url of this.listsForProfile(code)) {
                if (!ret.includes(url)) {
                    ret.push(url)
                }
            }
        }
        return ret
    }

    // --------------------------------------------------------------- matching

    compiled(code) {
        if (this._compiled[code]) {
            return this._compiled[code]
        }
        const def = this.definition(code)
        if (!def) {
            return null
        }
        const terms = (Array.isArray(def.terms) ? def.terms : [])
            .map(t => normalize(t).trim())
            .filter(t => t.length >= 2)
        const categories = (Array.isArray(def.categories) ? def.categories : []).map(c => normalize(c))
        const tags = (Array.isArray(def.tags) ? def.tags : [])
            .map(t => normalize(t).trim())
            .filter(t => t.length >= 2)
        let regex = null
        if (terms.length) {
            try {
                regex = new RegExp('(?:^|[^a-z0-9])(' + terms.map(escapeRegExp).join('|') + ')(?![a-z0-9])')
            } catch (err) {
                console.error('content-profile: invalid terms for "' + code + '"', err)
                regex = null
            }
        }
        let tagsRegex = null
        if (tags.length) {
            try {
                tagsRegex = new RegExp('(?:^|[^a-z0-9])(' + tags.map(escapeRegExp).join('|') + ')(?![a-z0-9])', 'g')
            } catch (err) {
                console.error('content-profile: invalid tags for "' + code + '"', err)
                tagsRegex = null
            }
        }
        const compiled = { regex, categories, tagsRegex }
        this._compiled[code] = compiled
        return compiled
    }

    /** Does a raw text/category pair match the given profile? */
    matches(code, text, category) {
        const compiled = this.compiled(code)
        if (!compiled) {
            return false
        }
        if (category) {
            const cat = normalize(category)
            if (compiled.categories.some(c => c && (cat == c || cat.includes(c)))) {
                return true
            }
        }
        const searchableText = code == 'adult' ? stripFalseFriends(text) : normalize(text)
        return compiled.regex ? compiled.regex.test(searchableText) : false
    }

    /** Whether the profile in force hides content outside of its theme. */
    isRestrictive() {
        const code = this.effective()
        const def = code ? this.definition(code) : null
        if (!def) {
            return false
        }
        const strictness = String(def.strictness || 'add').toLowerCase()
        return strictness != 'add' && strictness != 'none'
    }

    /**
     * How much a folder (list group) is about the profile in force.
     * 0 means "not about this profile".
     */
    groupRelevance(group) {
        const code = this.effective()
        if (!code) {
            return 0
        }
        if (group && this.isProfileSource(group.url)) {
            return 2 // the profile's own list: every folder is relevant by origin
        }
        const rawText = [group && group.name, group && group.group].filter(v => v).join(' ')
        const text = code == 'adult' ? stripFalseFriends(rawText) : normalize(rawText)
        if (!text) {
            return 0
        }
        const compiled = this.compiled(code)
        if (!compiled) {
            return 0
        }
        let score = compiled.regex && compiled.regex.test(text) ? 2 : 0
        if (compiled.tagsRegex) {
            const hits = text.match(compiled.tagsRegex)
            if (hits) {
                score += hits.length
            }
        }
        return score
    }

    /**
     * Split folders in the ones shown first and the ones kept for later, taking
     * the profile relevance and a display limit into account. Off-topic folders
     * of a restrictive profile are moved to `hidden` (never dropped) and folders
     * of lists added by the user are always kept visible.
     */
    planGroups(groups, limit) {
        const list = Array.isArray(groups) ? groups : []
        limit = parseInt(limit, 10)
        if (isNaN(limit) || limit < 1) {
            limit = list.length
        }
        const ranked = this.rankGroups(list)
        let visible = ranked.matched.concat(ranked.others)
        const hidden = []
        if (this.isRestrictive()) {
            const code = this.effective()
            const keep = []
            visible.forEach(group => {
                if (!group.relevance && this.isCommunity(group.url)) {
                    hidden.push(group)
                } else {
                    keep.push(group)
                }
            })
            // Never empty the category (unusual list layout or profile)
            if (keep.length || code == 'adult') {
                visible = keep
            }
        }
        const overflow = visible.slice(limit)
        return {
            visible: visible.slice(0, limit),
            hidden: overflow.concat(hidden)
        }
    }

    /**
     * Split folders in "about this profile" (most relevant first) and the rest,
     * both keeping the original order. Folders are { name, group, url } objects
     * and come back with a `relevance` field.
     */
    rankGroups(groups) {
        const matched = [], others = []
        if (!Array.isArray(groups) || !groups.length) {
            return { matched, others }
        }
        const code = this.effective()
        if (!code) {
            return { matched, others: groups.map(group => Object.assign({}, group, { relevance: 0 })) }
        }
        groups
            .map((group, index) => ({ group, index, relevance: this.groupRelevance(group) }))
            .sort((a, b) => (b.relevance - a.relevance) || (a.index - b.index))
            .forEach(item => {
                const entry = Object.assign({}, item.group, { relevance: item.relevance })
                if (item.relevance > 0) {
                    matched.push(entry)
                } else {
                    others.push(entry)
                }
            })
        return { matched, others }
    }

    /**
     * Theme used to filter community lists: only profiles with strictness
     * 'only'/'prefer' filter, and never while the profile is suspended.
     */
    theme() {
        if (!this.isRestrictive()) {
            return null
        }
        return this.effective()
    }

    /** Whether the URL is a community list (user added lists are never filtered). */
    isCommunity(url) {
        if (!url) {
            return false
        }
        const mine = config.get('lists') || []
        for (const item of mine) {
            const u = Array.isArray(item) ? item[1] : item
            if (typeof u == 'string' && u == url) {
                return false
            }
        }
        const lists = global.lists
        const list = lists && lists.lists ? lists.lists[url] : null
        if (list && list.origin) {
            return list.origin == 'community'
        }
        let type = null
        try {
            type = lists && lists.discovery && typeof lists.discovery.details == 'function' ? lists.discovery.details(url, 'type') : null
        } catch (err) {
            type = null
        }
        if (type) {
            return type == 'community'
        }
        return true
    }

    allowsEntry(entry, url) {
        if (!entry || typeof entry != 'object') {
            return true
        }
        if (url && !this.isCommunity(url)) {
            return true
        }
        if (this.isProfileSource(url)) {
            return true
        }
        const code = this.theme()
        if (!code) {
            return true
        }
        const text = [entry.name || entry.title, entry.group, entry.groupName].filter(v => v).join(' ')
        return this.matches(code, text, entry.category || entry.group)
    }

    /**
     * Filter a flat list of entries. Never empties a list: when too few entries
     * match (misconfigured profile, unusual list layout) the list is kept as is.
     */
    filter(entries, url) {
        if (!Array.isArray(entries) || !entries.length) {
            return entries
        }
        const code = this.theme()
        if (!code) {
            return entries
        }
        if (url && !this.isCommunity(url)) {
            return entries
        }
        if (this.isProfileSource(url)) {
            return entries
        }
        const total = entries.length
        const minKeep = Math.max(5, Math.ceil(total * 0.05))
        const kept = entries.filter(entry => this.allowsEntry(entry, url))
        if (code == 'adult') {
            return kept
        }
        if (kept.length < minKeep) {
            return entries
        }
        return kept
    }

    /** Filter channel suggestions (name + category) keeping a usable amount. */
    filterChannels(channels) {
        if (!Array.isArray(channels) || !channels.length) {
            return channels
        }
        const code = this.theme()
        if (!code) {
            return channels
        }
        const minKeep = Math.max(5, Math.ceil(channels.length * 0.05))
        const kept = channels.filter(ch => this.matches(code, ch && ch.name, ch && ch.category))
        if (code == 'adult') {
            return kept
        }
        return kept.length >= minKeep ? kept : channels
    }

    // -------------------------------------------------------- recommendations

    /**
     * Default tags seeded by the profile in force. They are used with a decaying
     * weight by the recommendations engine, so real interests take over naturally.
     */
    seedTags() {
        const ret = {}
        const def = this.definition(this.effective())
        if (!def || !Array.isArray(def.tags)) {
            return ret
        }
        def.tags.forEach(tag => {
            const key = String(tag || '').toLowerCase().trim()
            if (key.length >= 2) {
                ret[key] = 1
            }
        })
        return ret
    }

    /**
     * Drops generic default interest tags that would pull the recommendations
     * against the profile in force: with `adult` selected, a default "disney" or
     * "cartoon" must not surface kids channels on the first screens. Restrictive
     * profiles (`strictness: 'only'`) give up every foreign vocabulary, while the
     * additive ones only give up the vocabularies that contradict them.
     * @param {Object} tags - tag => weight map
     * @returns {Object} the tags that don't fight the profile
     */
    filterDefaultTags(tags) {
        if (!tags || typeof tags != 'object') {
            return {}
        }
        const code = this.effective()
        const def = this.definition(code)
        if (!def) {
            return tags
        }
        const own = new Set([...(def.tags || []), ...(def.terms || []), ...(def.categories || [])].map(tag => normalize(tag)))
        const strict = String(def.strictness || 'add').toLowerCase() != 'add'
        const foreign = new Set()
        for (const [other, otherDef] of Object.entries(this.definitions())) {
            if (other == code) {
                continue
            }
            const opposes = (other == 'kids' && code != 'kids') || (other == 'adult' && code != 'adult')
            if (!strict && !opposes) {
                continue
            }
            for (const tag of [...(otherDef.tags || []), ...(otherDef.terms || []), ...(otherDef.categories || [])]) {
                const key = normalize(tag).replace(/\+/g, '')
                if (key.length > 2 && !own.has(key) && !own.has(key + '+')) {
                    foreign.add(key)
                }
            }
        }
        if (code && code != 'adult') {
            for (const tag of ADULT_EXTRA_VOCAB) {
                const key = normalize(tag)
                if (!own.has(key)) {
                    foreign.add(key)
                }
            }
        }
        if (!foreign.size) {
            return tags
        }
        const ret = {}
        for (const [tag, weight] of Object.entries(tags)) {
            if (!foreign.has(normalize(tag).replace(/\+/g, ''))) {
                ret[tag] = weight
            }
        }
        return ret
    }
}

const contentProfile = new ContentProfile()

export { ContentProfile, stripFalseFriends }
export default contentProfile

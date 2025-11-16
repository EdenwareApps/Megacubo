export default {
    create: false, // Read-only for existing lists
    allowIndexRebuild: true,
    compression: true,
    termMapping: true, // Ativa term mapping globalmente
    termMappingFields: ['nameTerms', 'groupTerms'], // Fields que usarão mapping (adapte com fields reais do seu índice)
    indexedQueryMode: 'strict', // Ativa modo strict: só permite queries com fields indexados, lança erro иначе
    // Para bypass em queries específicas: use { allowNonIndexed: true } nas opções de find/count
    fields: {
        url: 'string',              // Stream URL
        name: 'string',             // Stream name
        icon: 'string',             // Stream icon/logo
        gid: 'string',             // TV guide ID
        group: 'string',            // Group title
        groups: 'array:string',     // Multiple groups
        groupName: 'string',       // Group name
        nameTerms: 'array:string',  // Search terms from name
        groupTerms: 'array:string', // Search terms from group
        lang: 'string',            // Language (tvg-language + detection)
        country: 'string',          // Country (tvg-country + detection)
        age: 'number',             // Age rating (0 = default, no restriction)
        subtitle: 'string',        // Subtitle
        userAgent: 'string',       // User agent (http-user-agent)
        referer: 'string',         // Referer (http-referer)
        author: 'string',          // Author (pltv-author)
        site: 'string',            // Site (pltv-site)
        email: 'string',           // Email (pltv-email)
        phone: 'string',           // Phone (pltv-phone)
        description: 'string',     // Description (pltv-description)
        epg: 'string',             // EPG URL (url-tvg, x-tvg-url)
        subGroup: 'string',        // Sub group (pltv-subgroup)
        rating: 'string',          // Rating (rating, tvg-rating)
        parental: 'string',        // Parental control (parental, censored)
        genre: 'string',          // Genre (tvg-genre)
        region: 'string',         // Region (region)
        categoryId: 'string',     // Category ID (category-id)
        ageRestriction: 'string'   // Age restriction (age-restriction)
    },
    indexes: ['nameTerms', 'groupTerms', 'groups', 'group'], // Only the fields we want to index
    integrityCheck: 'none', // Skip integrity check for speed
    streamingThreshold: 0.8, // Higher threshold for lists (80% of data)
    debugMode: false, // Disable debug mode for production
}
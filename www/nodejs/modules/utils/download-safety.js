class DownloadSafety {
    static getContentType(headers) {
        const header = headers?.['content-type'] || headers?.['Content-Type'] || ''
        return String(header).split(';')[0].trim().toLowerCase()
    }

    static isHtmlContentType(headers) {
        const type = this.getContentType(headers)
        return /^(text\/html|application\/xhtml\+xml|application\/html|text\/xml|application\/xml|application\/javascript|application\/x-javascript|text\/javascript)$/.test(type)
    }

    static isHtmlBodySample(sample) {
        if (!sample) {
            return false
        }
        const content = typeof sample === 'string' ? sample : sample.toString('utf8')
        const snippet = content.slice(0, 1024)
        return /<(html|!doctype html|head|body|script|meta|iframe|frame|link|title|style|img|svg|base|object|embed|noscript|form)(\s|>|\/)/i.test(snippet) ||
               /(window\.location|location\.href|document\.write|document\.location|<meta[^>]*http-equiv=["']refresh["'])/i.test(snippet)
    }

    static isSuspiciousResponse(headers, sample) {
        return this.isHtmlContentType(headers) || this.isHtmlBodySample(sample)
    }
}

export default DownloadSafety

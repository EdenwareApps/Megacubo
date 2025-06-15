const setupFontDetector = () => {
    const cache = {}
    const fingerprint = font => {
        if(cache[font]) {
            return cache[font];
        }
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = `128px ${font}`;
        ctx.imageSmoothingEnabled = false;
        ctx.fillText("- fingerprint -", 0, 100);
        const hash = canvas.toDataURL();
        cache[font] = hash;
        return hash;
    }
    
    const container = document.createElement('span')
    container.innerHTML = Array(100).join('wi')
    container.style.cssText = [
        'position:absolute',
        'width:auto',
        'font-size:128px',
        'left:-99999px'
    ].join(' !important;')
    // Pre compute the widths of monospace, serif & sans-serif for better performance
    const monoHash  = fingerprint('monospace')
    const serifHash = fingerprint('serif')
    const sansHash  = fingerprint('sans-serif')  
    console.log('fingerprint', {
        monoHash,
        serifHash,
        sansHash
    })
    return {
        available: font => {
            return monoHash !== fingerprint(font + ',monospace') ||
                sansHash !== fingerprint(font + ',sans-serif') ||
                serifHash !== fingerprint(font + ',serif');
        },
        release: () => {
            container.innerHTML = ''
            if (container.parentElement) {
                container.parentElement.removeChild(container)
            }
        }
    }
}

let fontListCache = null
export const getFontList = () => {
    if(fontListCache) {
        return fontListCache
    }
    const { available, release } = setupFontDetector()
    fontListCache = [
        'Arial',
        'BlinkMacSystemFont', 
        'Calibri',
        'Candara',
        'Cantarell',
        'Century Gothic',
        'Comic Sans',
        'Consolas',
        'Corbel',
        'Courier',
        'Dejavu Sans',
        'Dejavu Serif',
        'Fira Sans',
        'Futura',
        'Georgia',
        'Gill Sans',
        'Gotham',
        'Helvetica',
        'Helvetica Neue', 
        'Impact',
        'Lato',
        'Liberation Sans',
        'Lucida Sans',
        'Montserrat',
        'Myriad Pro',
        'Netflix Sans',
        'Noto Sans',
        'Open Sans',
        'Oxygen-Sans', 
        'Palatino',
        'Roboto',
        'Segoe UI', 
        'Segoe UI Variable',
        'SF Pro',
        'Source Sans Pro',
        'Tahoma',
        'Times New Roman',
        'Trebuchet',
        'Ubuntu',
        'Verdana',
        'Zapfino'
    ].filter(available)
    release()
    return fontListCache
}
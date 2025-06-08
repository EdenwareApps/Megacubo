export function prepare(obj, visited = new WeakSet()) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    if (visited.has(obj)) {
        return '[Circular]';
    }
    visited.add(obj);

    // Se for array, processa com loop simples e flag de mudança.
    if (Array.isArray(obj)) {
        const result = new Array(obj.length);
        for (let i = 0; i < obj.length; i++) {
            result[i] = prepare(obj[i], visited);
        }
        return result;
    }

    // Para tipos especiais, sempre gera novo valor.
    if (obj instanceof Date) {
        return obj.toISOString();
    }
    if (obj instanceof RegExp) {
        return obj.toString();
    }
    if (obj instanceof Map || obj instanceof Set) {
        return Array.from(obj);
    }
    if (typeof(Element) !== 'undefined' && obj instanceof Element) {
        return obj.outerHTML;
    }
    if (obj instanceof Error) {
        return {
            name: obj.name,
            message: obj.message,
            stack: obj.stack
        };
    }


    // Para objetos comuns, itera sobre as chaves próprias.
    const keys = Object.keys(obj);
    const result = {};
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const value = obj[key];
        if (typeof value === 'function' || value === undefined) {
            continue;
        }
        result[key] = prepare(value, visited);
    }
    return result;
}

export function parse(json) {
    let ret;
    try {
        let parsed = JSON.parse(typeof(json) === 'string' ? json : String(json))
        ret = parsed
    }
    catch (e) {}
    return ret
}

export function stringify(obj) {
    return JSON.stringify(prepare(obj))
}

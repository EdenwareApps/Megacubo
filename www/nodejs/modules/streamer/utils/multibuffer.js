const { BufferList } = require('bl')

class MultiBuffer extends BufferList {
    constructor() {
        super()
    }
    extract(start, end) {
        const ret = this.slice(start, end)
        this.consume(end)
        return ret
    }
    remove(start, end) {
        const pieces = [
            this.shallowSlice(0, start),
            this.shallowSlice(end, this.length)
        ]
        this.consume(this.length)
        pieces.forEach(p => this.append(p))
    }
    clear() {
        this.consume(this.length)
    }
    destroy() {
        this.clear()
    }
}

module.exports = MultiBuffer

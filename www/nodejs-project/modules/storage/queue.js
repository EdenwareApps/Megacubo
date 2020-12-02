
class Queue {
    constructor(){
        this.locks = {}
        this.queue = {}
    }
    add(key, fn){
        if(!Array.isArray(this.queue[key])){
            this.queue[key] = []
        }
        this.queue[key].push(fn)
        if(!this.locks[key]){
            this.next(key)
        }
    }
    next(key){
        if(Array.isArray(this.queue[key]) && this.queue[key].length){
            if(!this.locks[key]){
                this.locks[key] = true
            }
            this.queue[key].shift()(key).catch(err => {
                if(!['not found', 'expired'].includes(err)){
                    console.error(err)
                }
            }).finally(() => {
                this.next(key)
            })
        } else {
            this.locks[key] = false
            delete this.queue[key]
        }
    }
}

module.exports = Queue

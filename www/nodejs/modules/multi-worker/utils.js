import { workerData, parentPort } from 'worker_threads'

const DEBUG = false;

let postMessage
if(parentPort) {
    if(DEBUG) {
        postMessage = (data) => {
            console.log('postMessage', data);
            return parentPort.postMessage(data);
        }
    } else {
        postMessage = parentPort.postMessage.bind(parentPort)
    }
} else {
    postMessage = () => {}
}

function loadGlobalVars() {
    Object.keys(workerData || {}).forEach(k => global[k] = workerData[k])
}

export default file => {
    file = file.replace(new RegExp('\\.jsc?$'), '')
    const emit = (type, content) => {
        //console.log('🔍 MultiWorker Utils: Emitting event:', { type, file, contentSize: JSON.stringify(content).length })
        postMessage({id: 0, file, type: 'event', data: type +':'+ JSON.stringify(content)})
    }
    // Efficient binary event: avoids JSON.stringify of large Buffers, which serializes
    // every byte as a JSON number (~10-15x memory/CPU overhead and a major cause of
    // ERR_WORKER_OUT_OF_MEMORY in workers that emit binary data, e.g. mpegts processor).
    // Sends the raw Buffer, transferring the underlying ArrayBuffer (zero-copy) when it
    // is standalone; the receiving side gets a Buffer view with no extra copy.
    const emitBinary = (type, content) => {
        if (Buffer.isBuffer(content)) {
            let buf = content
            const transferList = []
            if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) {
                // Standalone buffer - transfer the ArrayBuffer (zero-copy)
                transferList.push(buf.buffer)
            } else {
                // Buffer is a view into a shared pool - copying with Buffer.from() would
                // STILL be pooled, and Node throws when transferring a shared pool
                // ArrayBuffer. allocUnsafeSlow() always allocates a standalone buffer.
                buf = Buffer.allocUnsafeSlow(buf.length)
                content.copy(buf)
                transferList.push(buf.buffer)
            }
            postMessage({ id: 0, file, type: 'event', data: type, buffer: buf }, transferList)
        } else {
            emit(type, content)
        }
    }
    const logErr = data => {
        postMessage({id: 0, file, type: 'event', data: 'worker-error:'+ JSON.stringify(data)})
    }
    return {logErr, postMessage, parentPort, emit, emitBinary, loadGlobalVars }
}
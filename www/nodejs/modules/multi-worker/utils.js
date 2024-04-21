import { workerData, parentPort } from 'worker_threads'

let postMessage
if(parentPort) {
    postMessage = parentPort.postMessage.bind(parentPort)
} else {
    postMessage = () => {}
}

function loadGlobalVars() {
    Object.keys(workerData || {}).forEach(k => global[k] = workerData[k])
}

export default file => {
    file = file.replace(new RegExp('\.jsc?$'), '')
    const emit = (type, content) => {
        postMessage({id: 0, file, type: 'event', data: type +':'+ JSON.stringify(content)})
    }    
    const logErr = data => {
        postMessage({id: 0, file, type: 'event', data: 'error:'+ JSON.stringify(data)})
    }
    return {logErr, postMessage, parentPort, emit, loadGlobalVars }
}
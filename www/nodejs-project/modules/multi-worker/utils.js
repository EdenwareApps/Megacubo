const { workerData, parentPort } = require('worker_threads')

if(parentPort) {
    postMessage = parentPort.postMessage.bind(parentPort)
} else {
    postMessage = () => {}
}

function loadGlobalVars() {
    Object.keys(workerData || {}).forEach(k => global[k] = workerData[k])
}

module.exports = file => {
    file = file.replace(new RegExp('\.jsc?$'), '')
    const emit = (type, content) => {
        postMessage({id: 0, file, type: 'event', data: type +':'+ JSON.stringify(content)})
    }    
    const logErr = (data) => {
        postMessage({id: 0, file, type: 'event', data: 'error:'+ JSON.stringify(data), file: global.file})
    }    
    return {logErr, postMessage, parentPort, emit, loadGlobalVars}
}
const { workerData, parentPort } = require('worker_threads')
postMessage = parentPort.postMessage.bind(parentPort)

const emit = (type, content) => {
	postMessage({id: 0, type: 'event', data: type +':'+ JSON.stringify(content)})
}

function logErr(data) {
    postMessage({id: 0, type: 'event', data: 'error:'+ JSON.stringify(data), file: global.file})
}

function loadGlobalVars() {
    Object.keys(workerData).forEach(k => global[k] = workerData[k])
}

module.exports = {logErr, postMessage, parentPort, emit, loadGlobalVars}

const {CookieJar} = require('tough-cookie'), HttpAgent = require('agentkeepalive'), {HttpsAgent} = HttpAgent, dnsCache = require('./lookup.js'), cookieJar = new CookieJar()
const agentOpts = {
	keepAlive: true,
	freeSocketTimeout: 10000,
	timeout: 15000,
	maxSockets: 3,
	maxFreeSockets: 5,
	socketActiveTTL: null
}
const got = require('got').extend({
	headers: {
		'Connection': 'close'
	},
	cookieJar,
	dnsCache,
	ignoreInvalidCookies: true,
	resolveBodyOnly: true,
	retry: 0,
	handlers: [
		(options, next) => {
			let promiseOrStream = next(options)
			if (typeof options.downloadLimit === 'number') {
				promiseOrStream.on('downloadProgress', progress => {
					if (progress.transferred > options.downloadLimit && progress.percent !== 1) {
						promiseOrStream.cancel(`Exceeded the download limit of ${options.downloadLimit} bytes`)
					}
				})
			}
			if (typeof options.uploadLimit === 'number') {
				promiseOrStream.on('uploadProgress', progress => {
					if (progress.transferred > options.uploadLimit && progress.percent !== 1) {
						promiseOrStream.cancel(`Exceeded the upload limit of ${options.uploadLimit} bytes`)
					}
				})
			}
			return promiseOrStream
		}
	],
	https: {
		rejectUnauthorized: false
	},
	hooks: {
		beforeError: [
			error => {
				try {
					let serr = String(error)
					console.warn('gotError', serr)
					error.request.emit('download-error', serr)
					try {
						throw error // avoid process crashing with uncaught exception, TODO: find a better way
					} catch(e) {}
				} catch(e){
					console.error(e)
				}
			}
		],
		beforeRetry: [
			(options, error, retryCount) => {
                if (error instanceof got.TimeoutError) {
                    console.warn(`Request to ${options.url} timed out. ${error.message}. Retrying... (Attempt #${retryCount})`);
                } else {
					console.warn(`Retrying to ${options.url}... (Attempt #${retryCount})`, error.message)
				}
			}
		]
	}
})
got.ka = got.extend({
	headers: {
		'Connection': 'keep-alive'
	},
	agent: {
		http: new HttpAgent(agentOpts),
		https: new HttpsAgent(agentOpts)
	}
})
got.cookieJar = cookieJar

module.exports = got


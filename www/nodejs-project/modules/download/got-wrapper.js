const {CookieJar} = require('tough-cookie'), cookieJar = new CookieJar()
const HttpAgent = require('agentkeepalive'), HttpsAgent = HttpAgent.HttpsAgent
const agentOpts = {
	keepAlive: true,
	freeSocketTimeout: 4000, // The default server-side timeout is 5000 milliseconds, to avoid ECONNRESET exceptions, we set the default value to 4000 milliseconds.
	maxSockets: 4,
	maxFreeSockets: 2,
	socketActiveTTL: 30,
	rejectUnauthorized: false
}

const resolver = new (require('dns').Resolver)()
const CacheableLookup = require('cacheable-lookup')

resolver.setServers(['8.8.8.8', '1.1.1.1'])

const dnsCache = new CacheableLookup({resolver})
const got = require('got').extend({
	headers: {
		'Connection': 'close'
	},
	cookieJar,
	dnsCache,
	ignoreInvalidCookies: true,
	resolveBodyOnly: true,
	retry: 0,
	https: {
		rejectUnauthorized: false
	},
	hooks: {
		beforeError: [
			error => {
				let serr = String(error)
				console.warn('gotError '+ serr, error.response && error.response.url ? error.response.url : '', global.traceback())
				error.request.emit('download-error', serr)
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

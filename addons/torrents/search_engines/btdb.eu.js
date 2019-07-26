/*
Name: BTDB.eu
*/
(function() {
    'use strict';  
    var $, request
    module.exports = (query, callback) => {
        if (typeof($) == 'undefined' || typeof(request) == 'undefined') {
            $ = require('cheerio')
            request = require('request')
        }
		const url = 'https://btdb.eu/?search=' + encodeURIComponent(query), opts = {url}
        request(opts, function (error, response, body) {
			console.warn('BTDB', error, response, body)
            var entries = []
			var $$ = $.load(body || '')
			var elems = $$('li[class=search-ret-item]'), count = elems.length;
			elems.each(function () {
				var magnet = $$(this).find('a[class=magnet]').attr('href')
				var name = $$(this).find('.item-title a').attr('title')
				var meta = $$(this).find('.item-meta-info-value')
				var size = meta.eq(0).text();
				var seeds = parseInt(meta.eq(-2).text()) || 0
				var peers = parseInt(meta.eq(-1).text()) || 0
                entries.push({
                    url: magnet,
                    name: name || 'Untitled',
                    label: 'BTDB, '+size,
                    score: seeds + peers
                })
			})
			console.warn('BTDB', entries, url)
            callback(null, entries, url, response.body)
        })
    }
})()
  
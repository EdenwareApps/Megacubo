/*
Name: TorrentZ
*/
(function() {
    'use strict';  
    var $, request
    module.exports = (query, callback) => {
        if (typeof($) == 'undefined' || typeof(request) == 'undefined') {
            $ = require('cheerio')
            request = require('request')
        }
        if (typeof query == 'string') {
          query = { 'query': query }
        }    
        query.quality = query.quality || 'good';    
        var url = 'https://torrentz2.eu/';    
        if (query.quality == 'any') url += 'any';
        if (query.quality == 'good') url += 'search';
        if (query.quality == 'verified') url += 'verified';    
        if (query.order == 'peers') url += 'P';
        if (query.order == 'rating') url += 'N';
        if (query.order == 'date') url += 'A';
        if (query.order == 'size') url += 'S';    
        url += '?q=' + query.query.replace(new RegExp(' +'), '+')
        if (query.page) url += '&p=' + (query.page - 1);
        request({url}, function (error, response, body) {
            var results = $('div.results', response.body || '');
            var items = $('dl', results);
            results = {
              page: parseInt($('p span > span', results).text().trim()) || 1,
              pagecount: parseInt($('p a:last-child', results).prev().text()),
              torrents: items.map(function(index, item) {
                if (!$('a', item).text()) return null;
                var title = $('a', item).text();
                var categories = $('dt', item)
                  .text().substr(title.length)
                  .split(' ').filter(function(e){
                    return !!e && e != '»';
                  });
    
                return {
                  title: title,
                  categories: categories,
                  hash: $('a', item).attr('href').substr(1),
                  date: new Date($('span.a span', item).attr('title') + ' UTC'),
                  size: $('span.s', item).text(),
                  seeds: parseInt($('span.u', item).text()),
                  peers: parseInt($('span.d', item).text())
                };
              }).get()              
            };
            var score, entries = [];
            for(var i in results.torrents) {
                score = results.torrents[i].seeds + results.torrents[i].peers;
                entries.push({
                    url: 'magnet:?xt=urn:btih:'+results.torrents[i].hash+'&dn='+encodeURIComponent(results.torrents[i].title)+'&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80&tr=udp%3A%2F%2Fopentor.org%3A2710&tr=udp%3A%2F%2Ftracker.ccc.de%3A80&tr=udp%3A%2F%2Ftracker.blackunicorn.xyz%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969',
                    name: results.torrents[i].title || 'Untitled',
                    label: 'TorrentZ, '+results.torrents[i].categories.filter((c) => { return c.length > 1 }).join(', '),
                    score: score
                })
            }
            callback(null, entries, url, response.body, results.length)
        })
    }
})()
  
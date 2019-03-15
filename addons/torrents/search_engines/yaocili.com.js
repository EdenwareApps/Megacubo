/*
Name: Yaocili
*/
module.exports = (terms, callback, modules) => {
    const url = 'https://www.yaocili.com/main-search-kw-' + encodeURIComponent(terms)+ '-1.html';
    modules.request(url, (err, resp, html) => {
        var $ = modules.cheerio.load(html), results = [];
        var elems = $('dl'), count = elems.length;
        elems.each(function () {
            var e = $(this)
            var nfo = e.find('dd span')
            var magnet = e.find('a[href^="magnet:"]').attr('href')
            var name = e.find('dt a').text().trim()
            var size = nfo.eq(1).text().replace(new RegExp('^[^0-9]+'), '').trim()
            var popularity = nfo.eq(2).find('b').text().replace(new RegExp('[^0-9]+'), '').trim()
            results.push({name: name, url: magnet, label: 'Yaocili, '+size, score: popularity})
        })
        callback(null, results)
    })
}
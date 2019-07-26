String.prototype.replaceAll = function(search, replacement) {
    var target = this;
    if(target.indexOf(search)!=-1){
        target = target.split(search).join(replacement);
    }
    return String(target)
} 

class M3UExtParser {
	constructor(lang, request){
        this.debug = require('debug')('M3UExtParser')
        this.lang = lang
		this.request = request
        this.badexts = ['jpg', 'jpeg', 'gif', 'bmp', 'png', 'txt'];
		this.regexes = {
			'group': new RegExp('group\-title *= *["\']*([^,"\']*)', 'i'),
			'logo': new RegExp('tvg\-logo *= *["\']*([^"\']+//[^"\']+)', 'i'),
			'name': new RegExp(',([^,]*)$', 'i'),
			'notags': new RegExp('\\[[^\\]]*\\]', 'g'),
			'validateprotocol': new RegExp('^(magnet:|//|[a-z]+://)', 'i'),
			'validatehost': new RegExp('^(//|https?://)(0\.0\.0\.0|127\.0\.0\.1| )'),
			'nullgroup': new RegExp('(^|[^A-Za-z0-9])N/A([^A-Za-z0-9]|$)', 'i')
		}
	}
	ext(url){
		return (''+url).split('?')[0].split('#')[0].split('.').pop().toLowerCase();        
	}
	basename(str, rqs){
		str = String(str)
		let qs = '', pos = str.indexOf('?')
		if(pos != -1){
			qs = str.slice(pos + 1)
			str = str.slice(0, pos)
		}
		str = str.replaceAll('\\', '/')
		pos = str.lastIndexOf('/')
		if(pos != -1){
			str = str.substring(pos + 1)
		}
		if(!rqs && qs){
			str += '?'+qs
		}
		return str
	}
    key(key){
        return key.replace(new RegExp('[^A-Za-z0-9\\._-]', 'g'), '')
    }
    isPath(o){
        return (typeof(o)=='string' && o.length <= 1024 && !o.match("[\t\r\n]") && o.match("[\\\\/]"))
    }
    read(path, callback){
        if(path.substr(0, 2)=='//'){
            path = 'http:' + path;
        }
        if(path.match('^https?:')){
            this.request({
                method: 'GET',
                uri: path,
                ttl: 6 * 3600
            }, (error, response, r) => {
                if(typeof(r)=='string' && r.indexOf('#EXT')!=-1){
                    r = this.extract(r)
                    callback(r, path)
                } else {
                    this.debug('READ '+path+' returned empty.', error)
                    callback(String(r), path)
                }
            })
        } else {
            fs.readFile(path, (err, content) => {
                if(typeof(content)!='string'){
                    content = String(content);
                }
                content = this.extract(content);
                callback(content, path)
            })
        }
    }
	extract(content){ // extract inline lists from HTMLs
        var pos = content.substr(0, 80000).toLowerCase().indexOf('<body');
        if(pos != -1){
            content = content.substr(pos);
            var e = (new RegExp('#(EXTM3U|EXTINF).*', 'mis')).exec(content);
            if(e && e.index){
                content = content.substr(e.index);
                content = content.replace(new RegExp('<[ /]*br[ /]*>', 'gi'), "\r\n");
                e = (new RegExp('</[A-Za-z]+>')).exec(content);
                if(e && e.index){
                    content = content.substr(0, e.index);
                }
            }
        }
        return content;
    }
    parseMeta(meta){
        // get logo, group and name
        var c = {}
        c.logo = this.parseMetaField(meta, this.regexes['logo'])
        c.group = this.parseMetaField(meta, this.regexes['group']).replaceAll('\\', '/').toUpperCase().replace(this.regexes['nullgroup'], '').trim()
        c.rawname = this.parseMetaField(meta, this.regexes['name']).trim()
        c.name = c.rawname.replace(this.regexes['notags'], '').trim()
        c.groupName = this.basename(c.group)
        c.type = 'stream'
        return c
    }
	parseMetaField(meta, rgx, index){
        if(typeof(index)!='number') index = 1;
        var r = meta.match(rgx);
        if(r && r.length > index) return r[index];
        return '';
    }
    parse(content, cb, url){ // parse a list to a array of entries/objects
        if(typeof(content) != 'string'){
            content = String(content)
        }
        if(this.isPath(content)){
            url = content;
            this.debug('READING', content)
            this.read(content, (content, path) => {
                this.debug('READEN', path)
                this.parse(content, cb, url)
            })
        } else {
            this.debug('PARSING', content.length)
            var parsingStream = null, flatList = [], slist = content.split("\n");
            for(var i in slist){
                if(slist[i].length > 12){
                    if(slist[i].substr(0, 3).indexOf('#')!=-1){
                        parsingStream = this.parseMeta(slist[i])
                    } else if(parsingStream) {
                        parsingStream.url = slist[i].trim();
                        parsingStream.source = url;
                        if(parsingStream.url && this.badexts.indexOf(this.ext(parsingStream.url)) == -1 && parsingStream.url.match(this.regexes['validateprotocol']) && !parsingStream.url.match(this.regexes['validatehost'])){ // ignore bad stream urls
                            flatList.push(parsingStream)
                        }
                        parsingStream = null;
                    }
                }
            }
            this.debug('PARSED')
            cb(flatList)
        }
    }
}

module.exports = M3UExtParser

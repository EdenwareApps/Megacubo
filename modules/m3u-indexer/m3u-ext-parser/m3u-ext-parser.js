String.prototype.replaceAll = function(search, replacement) {
    var target = this;
    if(target.indexOf(search)!=-1){
        target = target.split(search).join(replacement);
    }
    return String(target)
} 

class M3UExtParser {
	constructor(opts){
        this.debug = require('debug')('M3UExtParser')
		this.request = opts.request ? opts.request : require('request')
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
        var pos = content.substr(0, 80000).toLowerCase().indexOf('<body')
        if(pos != -1){
            content = content.substr(pos);
            var e = (new RegExp('#(EXTM3U|EXTINF).*', 'mis')).exec(content);
            if(e && e.index){
                content = content.substr(e.index)
                content = content.replace(new RegExp('<[ /]*br[ /]*>', 'gi'), "\r\n")
                e = (new RegExp('</[A-Za-z]+>')).exec(content)
                if(e && e.index){
                    content = content.substr(0, e.index)
                }
            }
        }
        content = this.fixUTF8(content)        
        return content
    }    
	fixUTF8(str){
		return String(str)
		// U+20AC  0x80  € â‚¬   %E2 %82 %AC
		.replace(/â‚¬/g, '€')
		// U+201A  0x82  ‚ â€š   %E2 %80 %9A
		.replace(/â€š/g, '‚')
		// U+0192  0x83  ƒ Æ’  %C6 %92
		.replace(/Æ’/g, 'ƒ')
		// U+201E  0x84  „ â€ž   %E2 %80 %9E
		.replace(/â€ž/g, '„')
		// U+2026  0x85  … â€¦   %E2 %80 %A6
		.replace(/â€¦/g, '…')
		// U+2020  0x86  † â€  %E2 %80 %A0
		.replace(/â€\u00A0/g, '†')
		// U+2021  0x87  ‡ â€¡   %E2 %80 %A1
		.replace(/â€¡/g, '‡')
		// U+02C6  0x88  ˆ Ë†  %CB %86
		.replace(/Ë†/g, 'ˆ')
		// U+2030  0x89  ‰ â€°   %E2 %80 %B0
		.replace(/â€°/g, '‰')
		// U+0160  0x8A  Š Å   %C5 %A0
		.replace(/Å\u00A0/g, 'Š')
		// U+2039  0x8B  ‹ â€¹   %E2 %80 %B9
		.replace(/â€¹/g, '‹')
		// U+0152  0x8C  Œ Å’  %C5 %92
		.replace(/Å’/g, 'Œ')
		// U+017D  0x8E  Ž Å½  %C5 %BD
		.replace(/Å½/g, 'Ž')
		// U+2018  0x91  ‘ â€˜   %E2 %80 %98
		.replace(/â€˜/g, '‘')
		// U+2019  0x92  ’ â€™   %E2 %80 %99
		.replace(/â€™/g, '’')
		// U+201C  0x93  “ â€œ   %E2 %80 %9C
		.replace(/â€œ/g, '“')
		// U+201D  0x94  ” â€  %E2 %80 %9D
		.replace(/â€\u009D/g, '”')
		// U+2022  0x95  • â€¢   %E2 %80 %A2
		.replace(/â€¢/g, '•')
		// U+2013  0x96  – â€“   %E2 %80 %93
		.replace(/â€“/g, '–')
		// U+2014  0x97  — â€”   %E2 %80 %94
		.replace(/â€”/g, '—')
		// U+02DC  0x98  ˜ Ëœ  %CB %9C
		.replace(/Ëœ/g, '˜')
		// U+2122  0x99  ™ â„¢   %E2 %84 %A2
		.replace(/â„¢/g, '™')
		// U+0161  0x9A  š Å¡  %C5 %A1
		.replace(/Å¡/g, 'š')
		// U+203A  0x9B  › â€º   %E2 %80 %BA
		.replace(/â€º/g, '›')
		// U+0153  0x9C  œ Å“  %C5 %93
		.replace(/Å“/g, 'œ')
		// U+017E  0x9E  ž Å¾  %C5 %BE
		.replace(/Å¾/g, 'ž')
		// U+0178  0x9F  Ÿ Å¸  %C5 %B8
		.replace(/Å¸/g, 'Ÿ')
		// U+00A0  0xA0    Â   %C2 %A0
		.replace(/Â /g, ' ')
		// U+00A1  0xA1  ¡ Â¡  %C2 %A1
		.replace(/Â¡/g, '¡')
		// U+00A2  0xA2  ¢ Â¢  %C2 %A2
		.replace(/Â¢/g, '¢')
		// U+00A3  0xA3  £ Â£  %C2 %A3
		.replace(/Â£/g, '£')
		// U+00A4  0xA4  ¤ Â¤  %C2 %A4
		.replace(/Â¤/g, '¤')
		// U+00A5  0xA5  ¥ Â¥  %C2 %A5
		.replace(/Â¥/g, '¥')
		// U+00A6  0xA6  ¦ Â¦  %C2 %A6
		.replace(/Â¦/g, '¦')
		// U+00A7  0xA7  § Â§  %C2 %A7
		.replace(/Â§/g, '§')
		// U+00A8  0xA8  ¨ Â¨  %C2 %A8
		.replace(/Â¨/g, '¨')
		// U+00A9  0xA9  © Â©  %C2 %A9
		.replace(/Â©/g, '©')
		// U+00AA  0xAA  ª Âª  %C2 %AA
		.replace(/Âª/g, 'ª')
		// U+00AB  0xAB  « Â«  %C2 %AB
		.replace(/Â«/g, '«')
		// U+00AC  0xAC  ¬ Â¬  %C2 %AC
		.replace(/Â¬/g, '¬')
		// U+00AD  0xAD  ­ Â­  %C2 %AD
		.replace(/Â­/g, '­')
		// U+00AE  0xAE  ® Â®  %C2 %AE
		.replace(/Â®/g, '®')
		// U+00AF  0xAF  ¯ Â¯  %C2 %AF
		.replace(/Â¯/g, '¯')
		// U+00B0  0xB0  ° Â°  %C2 %B0
		.replace(/Â°/g, '°')
		// U+00B1  0xB1  ± Â±  %C2 %B1
		.replace(/Â±/g, '±')
		// U+00B2  0xB2  ² Â²  %C2 %B2
		.replace(/Â²/g, '²')
		// U+00B3  0xB3  ³ Â³  %C2 %B3
		.replace(/Â³/g, '³')
		// U+00B4  0xB4  ´ Â´  %C2 %B4
		.replace(/Â´/g, '´')
		// U+00B5  0xB5  µ Âµ  %C2 %B5
		.replace(/Âµ/g, 'µ')
		// U+00B6  0xB6  ¶ Â¶  %C2 %B6
		.replace(/Â¶/g, '¶')
		// U+00B7  0xB7  · Â·  %C2 %B7
		.replace(/Â·/g, '·')
		// U+00B8  0xB8  ¸ Â¸  %C2 %B8
		.replace(/Â¸/g, '¸')
		// U+00B9  0xB9  ¹ Â¹  %C2 %B9
		.replace(/Â¹/g, '¹')
		// U+00BA  0xBA  º Âº  %C2 %BA
		.replace(/Âº/g, 'º')
		// U+00BB  0xBB  » Â»  %C2 %BB
		.replace(/Â»/g, '»')
		// U+00BC  0xBC  ¼ Â¼  %C2 %BC
		.replace(/Â¼/g, '¼')
		// U+00BD  0xBD  ½ Â½  %C2 %BD
		.replace(/Â½/g, '½')
		// U+00BE  0xBE  ¾ Â¾  %C2 %BE
		.replace(/Â¾/g, '¾')
		// U+00BF  0xBF  ¿ Â¿  %C2 %BF
		.replace(/Â¿/g, '¿')
		// U+00C0  0xC0  À Ã€  %C3 %80
		.replace(/Ã€/g, 'À')
		// U+00C2  0xC2  Â Ã‚  %C3 %82
		.replace(/Ã‚/g, 'Â')
		// U+00C3  0xC3  Ã Ãƒ  %C3 %83
		.replace(/Ãƒ/g, 'Ã')
		// U+00C4  0xC4  Ä Ã„  %C3 %84
		.replace(/Ã„/g, 'Ä')
		// U+00C5  0xC5  Å Ã…  %C3 %85
		.replace(/Ã…/g, 'Å')
		// U+00C6  0xC6  Æ Ã†  %C3 %86
		.replace(/Ã†/g, 'Æ')
		// U+00C7  0xC7  Ç Ã‡  %C3 %87
		.replace(/Ã‡/g, 'Ç')
		// U+00C8  0xC8  È Ãˆ  %C3 %88
		.replace(/Ãˆ/g, 'È')
		// U+00C9  0xC9  É Ã‰  %C3 %89
		.replace(/Ã‰/g, 'É')
		// U+00CA  0xCA  Ê ÃŠ  %C3 %8A
		.replace(/ÃŠ/g, 'Ê')
		// U+00CB  0xCB  Ë Ã‹  %C3 %8B
		.replace(/Ã‹/g, 'Ë')
		// U+00CC  0xCC  Ì ÃŒ  %C3 %8C
		.replace(/ÃŒ/g, 'Ì')
		// U+00CD  0xCD  Í Ã   %C3 %8D
		.replace(/Ã\u008D/g, 'Í')
		// U+00CE  0xCE  Î ÃŽ  %C3 %8E
		.replace(/ÃŽ/g, 'Î')
		// U+00CF  0xCF  Ï Ã   %C3 %8F
		.replace(/Ã\u008F/g, 'Ï')
		// U+00D0  0xD0  Ð Ã   %C3 %90
		.replace(/Ã\u0090/g, 'Ð')
		// U+00D1  0xD1  Ñ Ã‘  %C3 %91
		.replace(/Ã‘/g, 'Ñ')
		// U+00D2  0xD2  Ò Ã’  %C3 %92
		.replace(/Ã’/g, 'Ò')
		// U+00D3  0xD3  Ó Ã“  %C3 %93
		.replace(/Ã“/g, 'Ó')
		// U+00D4  0xD4  Ô Ã”  %C3 %94
		.replace(/Ã”/g, 'Ô')
		// U+00D5  0xD5  Õ Ã•  %C3 %95
		.replace(/Ã•/g, 'Õ')
		// U+00D6  0xD6  Ö Ã–  %C3 %96
		.replace(/Ã–/g, 'Ö')
		// U+00D7  0xD7  × Ã—  %C3 %97
		.replace(/Ã—/g, '×')
		// U+00D8  0xD8  Ø Ã˜  %C3 %98
		.replace(/Ã˜/g, 'Ø')
		// U+00D9  0xD9  Ù Ã™  %C3 %99
		.replace(/Ã™/g, 'Ù')
		// U+00DA  0xDA  Ú Ãš  %C3 %9A
		.replace(/Ãš/g, 'Ú')
		// U+00DB  0xDB  Û Ã›  %C3 %9B
		.replace(/Ã›/g, 'Û')
		// U+00DC  0xDC  Ü Ãœ  %C3 %9C
		.replace(/Ãœ/g, 'Ü')
		// U+00DD  0xDD  Ý Ã   %C3 %9D
		.replace(/Ã\u009D/g, 'Ý')
		// U+00DE  0xDE  Þ Ãž  %C3 %9E
		.replace(/Ãž/g, 'Þ')
		// U+00DF  0xDF  ß ÃŸ  %C3 %9F
		.replace(/ÃŸ/g, 'ß')
		// U+00E0  0xE0  à Ã   %C3 %A0
		.replace(/Ã\u00A0/g, 'à')
		// U+00E1  0xE1  á Ã¡  %C3 %A1
		.replace(/Ã¡/g, 'á')
		// U+00E2  0xE2  â Ã¢  %C3 %A2
		.replace(/Ã¢/g, 'â')
		// U+00E3  0xE3  ã Ã£  %C3 %A3
		.replace(/Ã£/g, 'ã')
		// U+00E4  0xE4  ä Ã¤  %C3 %A4
		.replace(/Ã¤/g, 'ä')
		// U+00E5  0xE5  å Ã¥  %C3 %A5
		.replace(/Ã¥/g, 'å')
		// U+00E6  0xE6  æ Ã¦  %C3 %A6
		.replace(/Ã¦/g, 'æ')
		// U+00E7  0xE7  ç Ã§  %C3 %A7
		.replace(/Ã§/g, 'ç')
		// U+00E8  0xE8  è Ã¨  %C3 %A8
		.replace(/Ã¨/g, 'è')
		// U+00E9  0xE9  é Ã©  %C3 %A9
		.replace(/Ã©/g, 'é')
		// U+00EA  0xEA  ê Ãª  %C3 %AA
		.replace(/Ãª/g, 'ê')
		// U+00EB  0xEB  ë Ã«  %C3 %AB
		.replace(/Ã«/g, 'ë')
		// U+00EC  0xEC  ì Ã¬  %C3 %AC
		.replace(/Ã¬/g, 'ì')
		// U+00ED  0xED  í Ã­  %C3 %AD
		.replace(/Ã\u00AD/g, 'í')
		// U+00EE  0xEE  î Ã®  %C3 %AE
		.replace(/Ã®/g, 'î')
		// U+00EF  0xEF  ï Ã¯  %C3 %AF
		.replace(/Ã¯/g, 'ï')
		// U+00F0  0xF0  ð Ã°  %C3 %B0
		.replace(/Ã°/g, 'ð')
		// U+00F1  0xF1  ñ Ã±  %C3 %B1
		.replace(/Ã±/g, 'ñ')
		// U+00F2  0xF2  ò Ã²  %C3 %B2
		.replace(/Ã²/g, 'ò')
		// U+00F3  0xF3  ó Ã³  %C3 %B3
		.replace(/Ã³/g, 'ó')
		// U+00F4  0xF4  ô Ã´  %C3 %B4
		.replace(/Ã´/g, 'ô')
		// U+00F5  0xF5  õ Ãµ  %C3 %B5
		.replace(/Ãµ/g, 'õ')
		// U+00F6  0xF6  ö Ã¶  %C3 %B6
		.replace(/Ã¶/g, 'ö')
		// U+00F7  0xF7  ÷ Ã·  %C3 %B7
		.replace(/Ã·/g, '÷')
		// U+00F8  0xF8  ø Ã¸  %C3 %B8
		.replace(/Ã¸/g, 'ø')
		// U+00F9  0xF9  ù Ã¹  %C3 %B9
		.replace(/Ã¹/g, 'ù')
		// U+00FA  0xFA  ú Ãº  %C3 %BA
		.replace(/Ãº/g, 'ú')
		// U+00FB  0xFB  û Ã»  %C3 %BB
		.replace(/Ã»/g, 'û')
		// U+00FC  0xFC  ü Ã¼  %C3 %BC
		.replace(/Ã¼/g, 'ü')
		// U+00FD  0xFD  ý Ã½  %C3 %BD
		.replace(/Ã½/g, 'ý')
		// U+00FE  0xFE  þ Ã¾  %C3 %BE
		.replace(/Ã¾/g, 'þ')
		// U+00FF  0xFF  ÿ Ã¿  %C3 %BF
		.replace(/Ã¿/g, 'ÿ')
	}
    parseMeta(meta){
        // get logo, group and name
        var c = {}
        c.logo = this.parseMetaField(meta, this.regexes['logo'])
        c.group = this.parseMetaField(meta, this.regexes['group']).replaceAll('\\', '/').toUpperCase().replace(this.regexes['nullgroup'], '').trim()
        c.rawname = this.parseMetaField(meta, this.regexes['name']).trim()
        c.name = c.rawname.replace(this.regexes['notags'], '').trim()
        c.groups = c.group.split('/')
        c.groupName = c.groups[c.groups.length - 1]
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

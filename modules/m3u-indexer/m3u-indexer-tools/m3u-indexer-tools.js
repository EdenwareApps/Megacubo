
class M3UTools {
	constructor(){
		this.settings = {
			folderSizeLimit: 96,
			folderSizeLimitTolerance: 12
		}
	}
	basename(str, rqs){
		str = String(str), qs = ''
		let pos = str.indexOf('?')
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
	dirname(str){
		_str = new String(str)
		pos = _str.replaceAll('\\', '/').lastIndexOf('/')
		if(!pos) return ''
		_str = _str.substring(0, pos)
		return _str
	}
	labelify(){
		var count
		for (var i=0; i<list.length; i++){
			if(list[i].type=='group'){
				count = Number(list[i].entries.length);
				if(count == 1){
					list[i] = list[i].entries[0];
					list[i].path = this.dirname(list[i].path);
					list[i].group = this.dirname(list[i].group);
				} else {
					list[i].label = count+' '+lngStr;
					list[i].entries = this.labelify(list[i].entries, locale, lngStr)
				}
			} else if(list[i].type=='stream') {
				list[i].label = this.basename(list[i].path || list[i].group)
			}
		}
		return list
	}
	insertAtPath(_index, groupname, group){ // group is entry object of type "group" to be put as last location, create the intermediaries, groupname is like a path
		var structure = this.buildPathStructure(groupname, group);
		_index = this.mergeEntriesWithNoCollision(_index, structure);
		return _index;
	}
	paginate(list){
		//console.log('AA', list.length);
		var nentries;
		for (var i=(list.length - 1); i >= 0; i--){
			if(list[i] && list[i].type=='group' && list[i].entries.length > (this.settings.folderSizeLimit + this.settings.folderSizeLimitTolerance)){
				nentries = this.paginateGroup(list[i]);
				list[i] = nentries.shift();
				for(var j=(nentries.length - 1); j >= 0; j--){
					//console.log('ZZ', j, nentries[j])
					if(typeof(nentries[j])=='object'){
						list.splice(i + 1, 0, nentries[j])
					}
				}
			}
		}
		//console.log('BB', list.length);
		return list;
	}
	paginateGroup(groupEntry){
		//console.log('CC', groupEntry.entries.length);
		var group, entries = [], template = groupEntry, n = 1, already = {};
		for(var i=0; i<groupEntry.entries.length; i += this.settings.folderSizeLimit){
			group = Object.assign({}, template);
			//console.log('CD', i, this.settings.folderSizeLimit);
			group.entries = groupEntry.entries.slice(i, i + this.settings.folderSizeLimit);
			group.name += ' '+this.getLetterRange(group.entries);
			if(typeof(already[group.name])!='undefined'){
				already[group.name]++;
				group.name += ' '+already[group.name];
			} else {
				already[group.name] = 1;
			}
			//console.log('DC', group.entries.length);
			entries.push(group);
			n++;
		}
		//console.log('DD', entries.length);
		return entries;
	}
	sortRecursively(list){
		var result = [], entry;
		for (var i=0; i<list.length; i++){
			entry = Object.assign({}, list[i]);
			if(entry.type=='group'){
				if(entry.entries.length){
					if(entry.entries.length == 1){
						entry = entry.entries[0];
						entry.path = this.dirname(entry.path);
					} else {
						entry.entries = this.sortRecursively(entry.entries);
						/* nextGroupForLogo
						for (var j=0; j<entry.entries.length; j++){
							if(entry.entries[j].logo){
								entry.logo = entry.entries[j].logo;
								break;
							}
						}
						*/
					}
				}
			}
			result.push(entry)
		}
		result.sort(function(a, b) {
			return (a.name > b.name) ? 1 : ((b.name > a.name) ? -1 : 0)
		}); 
		return result;
	}
	getLetterRange(entries){
		var l, start = '0', end = 'Z', r = new RegExp('[A-Za-z0-9]');
		for(var i=0; i<entries.length; i++){
			l = entries[i].name.charAt(0);
			if(l.match(r)){
				start = l.toUpperCase();
				break;
			}
		}
		for(var i=(entries.length - 1); i>=0; i--){
			l = entries[i].name.charAt(0);
			if(l.match(r)){
				end = l.toUpperCase()
				break;
			}
		}
		return (start==end)?start:start+'-'+end;
	}
	// mergeEntriesWithNoCollision([{name:'1',type:'group', entries:[1,2,3]}], [{name:'1',type:'group', entries:[4,5,6]}])
	mergeEntriesWithNoCollision(leveledIndex, leveledEntries){
		var ok;
		if(Array.isArray(leveledIndex) && Array.isArray(leveledEntries)){
			for(var j=0;j<leveledEntries.length;j++){
				ok = false;
				for(var i=0;i<leveledIndex.length;i++){
					if(leveledIndex[i].type==leveledEntries[j].type && leveledIndex[i].name==leveledEntries[j].name){
						//console.log('LEVELING', leveledIndex[i], leveledEntries[j])
						leveledIndex[i].entries = this.mergeEntriesWithNoCollision(leveledIndex[i].entries, leveledEntries[j].entries);
						ok = true;
						break;
					}
				}
				if(!ok){
					//console.log('NOMATCH FOR '+leveledEntries[j].name, leveledIndex, leveledEntries[j]);
					leveledIndex.push(leveledEntries[j]);
					//console.log('noMATCH' , JSON.stringify(leveledIndex).substr(0, 128));
				}
			}
		}
		return leveledIndex;
	}
	buildPathStructure(path, group){ // group is entry object of type "group" to be put as last location, create the intermediaries
		var groupEntryTemplate = {name: '', path: '', type: 'group', label: '', entries: []};
		path = path.replace(new RegExp('\\+'), '/');
		var paths = path.split('/');
		var structure = group;
		for(var i=(paths.length - 2);i>=0;i--){
			//console.log(structure);
			var entry = groupEntryTemplate;
			entry.entries = [Object.assign({}, structure)];
			entry.name = paths[i];
			entry.label = '';
			entry.path = paths.slice(0, i + 1).join('/');
			structure = entry;
		}
		return [structure]
	}
}

module.exports = M3UTools
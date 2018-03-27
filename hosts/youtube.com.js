
module.exports = (scope) => {
	var v = scope.document.querySelector('video');
	if(v && v.paused){
		var e = scope.document.querySelector('.ytp-play-button');
		if(e){
			e.click();
		}
	}
	return true;
}
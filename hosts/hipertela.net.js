
module.exports = function process(scope){
	var e = scope.document.querySelector('.vjs-big-play-button');
	if(e){
		e.click();
	}
	return true;
}
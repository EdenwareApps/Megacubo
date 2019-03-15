
module.exports = function process(scope){
	if(typeof(scope['tudoPlayer'])=='function' && !scope['tudoPlayerOK']){
		scope['tudoPlayerOK'] = true;
		scope.tudoPlayer()
	}
	return true; // true = run default fitting
}
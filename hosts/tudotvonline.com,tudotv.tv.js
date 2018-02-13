
module.exports = function process(scope){
	if(typeof(scope['tudoPlayer'])=='function'){
		scope.tudoPlayer();
	}
	return true; // true = run default fitting
}
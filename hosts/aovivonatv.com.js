
module.exports = function process(scope){
	if(typeof(scope['abrirPlayer'])=='function'){
		scope.abrirPlayer('player');
	} else {
		var as = scope.document.querySelectorAll('.QualidadePlayer a');
		if(as.length){
			as[as.length - 1].click();
		}
	}
	return true; // true = run default fitting
}

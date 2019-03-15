
module.exports = function process(scope){
	if(!scope['clk1'] && typeof(scope['abrirPlayer'])=='function'){
		scope['clk1'] = true;
		scope.abrirPlayer('player')
	}
	if(!scope['clk2']){
		var as = scope.document.querySelectorAll('.QualidadePlayer a')
		if(as.length){
			scope['clk2'] = true;
			as[as.length - 1].click()
		}
	}
	return true; // true = run default fitting
}

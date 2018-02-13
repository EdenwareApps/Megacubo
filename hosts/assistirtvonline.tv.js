
module.exports = function process(scope){
	var as = scope.document.querySelectorAll('base');
	for(var i=0;i<as.length;i++){
		var p = as[i].parentNode;
		if(p) p.removeChild(as[i]);	
	}
	return true; // true = run default fitting
}

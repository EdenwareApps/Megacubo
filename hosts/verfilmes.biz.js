module.exports = function process(scope){
	var as = scope.document.querySelectorAll('.player a, a.btn');
	for(var i in as){
		as[i].onmousedown = function (){
			scope.location.href = as.href;
		}
	}
	return true; // true = run default fitting
}

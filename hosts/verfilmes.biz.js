module.exports = function process(scope){
	var as = scope.document.querySelectorAll('.player a, a.btn')
	for(var i in as){
		as[i].onmousedown = function (){
			scope.location.href = as.href;
		}
	}
	scope.window.open = () => { 
		var f = document.createElement('iframe')
		return f.contentWindow 
	}
	return true; // true = run default fitting
}

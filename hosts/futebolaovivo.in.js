module.exports = function process(scope){
	var a = scope.document.querySelector('a[target="Player"].visible-xs');
	if(a){
		if(a.href && a.href.match(new RegExp('^https?:'))){
			location.href = as.href;
		} else {
			as.click();
		}
	}
	return true;
}

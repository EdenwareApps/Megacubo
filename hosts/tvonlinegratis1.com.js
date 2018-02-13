module.exports = function process(scope){
	var bt = function (a){ // has bad target?
		return (a.target && (['_top','_blank','_new','_self']).indexOf(a.target)==-1);
	};
	if(typeof(scope.jQuery)!='undefined'){
		scope.jQuery(scope.document).on('mousedown', function (e){
			if(e.target && __tag(e.target)=='a'){
				var a = e.target;
				if(bt(a)){
					location.href = a.href;
				}
			}
		});
		var as = scope.jQuery(scope.document).find('.opcao a:visible');
		var a = as.get(0);
		if(bt(a)){
			return a.href;
		} else {
			a.mousedown();
			a.click();
		}
	}
	return true;
}
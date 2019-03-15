module.exports = function process(scope){
	scope.open = function (){};
	if(typeof(scope.jQuery)!='undefined'){
		scope.jQuery(scope.document).on('mousedown', 'a.but, div.but a', function(e) {
			var m, h = e.currentTarget.outerHTML;
			if(m = h.match(new RegExp("h?t?t?p?s?:?//[^\"' <>]+"))){
				e.stopPropagation()
				e.preventDefault()
				scope.location.href = m[0];
				setTimeout(function (){
					scope.location.href = m[0];
				}, 1000)
			}
		})
	}
	return true;
}
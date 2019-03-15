module.exports = function process(scope, intent, self){
	var v = scope.document.querySelector('video')
	return v ? {element: v, scope: scope} : true;
}


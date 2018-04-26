module.exports = function (scope, intent){
	scope.allowSearchStreamInCode = false;
	if(scope.document.readyState == 'complete' && !scope.document.querySelector('video') && scope.document.body.innerHTML.indexOf('protected') != -1){
		var c = intent.frame.contentWindow;
		if(c){ 
			c.location.reload(true)
		} else {
			scope.location.reload(true)
		}
		return false;
	}
	return true;
}


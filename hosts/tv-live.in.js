module.exports = function process(scope){
	var c = scope.document.querySelector('a.nyroModal');
	if(c){
		c.click();
	}
	return true;
}


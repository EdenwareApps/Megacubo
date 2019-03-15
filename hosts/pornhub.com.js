
module.exports = (scope) => {
	var url = scope.document.URL;
	var bt = scope.document.querySelector('*[class$="_play"]')
	if(bt) bt.click()
	return true; // fit and reveal this whole page
}
module.exports = function process(scope){
	if(typeof(scope.jQuery)!='undefined' && scope.jQuery(scope.document).find('#play_btn').length){
	jQuery(scope.document).find('#play_btn').click();
	return true;
}
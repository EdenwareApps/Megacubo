// thanks to @bengfarrell https://github.com/oliver-moran/jimp/issues/753#issuecomment-574852816

const JIMP_AUTOCROP_ALPHA_IGNORE_LEVEL = 255 * 0.2
const JIMP_AUTOCROP_STEP_COUNT = 48

function isTransparent(rgba){
	return rgba.a === 0
}
function isWhite(rgba){
	return rgba.r === 255 &&  rgba.g === 255 &&  rgba.b === 255
}
function isBlack(rgba){
	return rgba.r === 0 &&  rgba.g === 0 &&  rgba.b === 0
}
function isHorizontalLineBlank(scope, w, c, y){
	let stepSize = Math.max(1, parseInt(w / JIMP_AUTOCROP_STEP_COUNT))
	for (let x = 0; x < w; x += stepSize) {
		const rgba = scope.constructor.intToRGBA(scope.getPixelColor(x, y))
		if (rgba.a > JIMP_AUTOCROP_ALPHA_IGNORE_LEVEL && rgba != c) {
			return false
		}
	}
	return true
}
function isVerticalLineBlank(scope, h, c, x){
	let stepSize = Math.max(1, parseInt(h / JIMP_AUTOCROP_STEP_COUNT))
	for (let y = 0; y < h; y += stepSize) {
		const rgba = scope.constructor.intToRGBA(scope.getPixelColor(x, y))
		if (rgba.a > JIMP_AUTOCROP_ALPHA_IGNORE_LEVEL && rgba != c) {
			return false
		}
	}
	return true
}
function findRight(scope, w, h, c) {
	let halfWidth = w / 2, stepSize = Math.max(1, parseInt(w / JIMP_AUTOCROP_STEP_COUNT))
	for (let x = w; x > halfWidth; x -= stepSize) {
		if (!isVerticalLineBlank(scope, h, c, x)) {
			for (; x < w; x++) {
				if (isVerticalLineBlank(scope, h, c, x)) {
					x--
					break
				}
			}
			return x
		}
	}
	return w
}
function findLeft(scope, w, h, c) {
	let halfWidth = w / 2, stepSize = Math.max(1, parseInt(w / JIMP_AUTOCROP_STEP_COUNT))
	for (let x = 0; x < halfWidth; x += stepSize) {
		if (!isVerticalLineBlank(scope, h, c, x)) {
			for (; x > 0; x--) {
				if (isVerticalLineBlank(scope, h, c, x)) {
					x++
					break
				}
			}
			return x
		}
	}
	return 0
}
function findTop(scope, w, h, c) {
	let halfHeight = h / 2, stepSize = Math.max(1, parseInt(h / JIMP_AUTOCROP_STEP_COUNT))
	for (let y = 0; y < halfHeight; y += stepSize) {
		if (!isHorizontalLineBlank(scope, w, c, y)) {
			for (; y > 0; y--) {
				if (isHorizontalLineBlank(scope, w, c, y)) {
					y++
					break
				}
			}
			return y
		}
	}
	return 0
}
function findBottom(scope, w, h, c) {
	let halfHeight = h / 2, stepSize = Math.max(1, parseInt(h / JIMP_AUTOCROP_STEP_COUNT))
	for (let y = h; y > halfHeight; y -= stepSize) {
		if (!isHorizontalLineBlank(scope, w, c, y)) {
			for (; y < h; y++) {
				if (isHorizontalLineBlank(scope, w, c, y)) {
					y--
					break
				}
			}
			return y
		}
	}
	return h
}
function findLimits(scope, w, h, c){
	let t = findTop(scope, w, h, c)
	let l = findLeft(scope, w, h, c)
	let r = findRight(scope, w, h, c)
	let b = findBottom(scope, w, h, c)
	return {t, l, r, b}
}
export default function autocrop() {
	//const start = (new Date()).getTime(), benchmarks = {}
	const w = this.bitmap.width
	const h = this.bitmap.height
	let firstPixelColor = this.constructor.intToRGBA(this.getPixelColor(0, 0))
	if(!(isTransparent(firstPixelColor) || isWhite(firstPixelColor) || isBlack(firstPixelColor))){
		firstPixelColor = {r: 0, g: 0, b: 0, a: 0}
	}
	const {t, l, r, b} = findLimits(this, w, h, firstPixelColor)
	//benchmarks['findLimits'] = (new Date()).getTime() - start
	//console.log('AUTOCROP', {l,r,t,b,firstPixelColor,w,h})
	//if(l < (w * 0.4) && r > (w * 0.6) && t < (h * 0.4) && b > (h * 0.6)){ // seems valid values
	if(b > t && r > l){ // seems valid values
		if(l > 0 || t > 0 || r < w || b < h){
			this.crop(l, t, w - (w - r + l), h - (h - b + t))
			this.autoCropped = true
			//benchmarks['crop'] = (new Date()).getTime() - (benchmarks['findLimits'] + start)
			//console.log('JIMP autocrop', Object.keys(benchmarks).map(k => { return k+'='+benchmarks[k]}).join(', '))
		}
	} else {
		console.error('Bad values for autocrop', w, h, firstPixelColor, t, b, l, r)
	}
	return this
}

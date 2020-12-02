
const Manager = require(global.APPDIR + '/modules/lists/manager'), Common = require(global.APPDIR + '/modules/lists/common')
const Lists = require(global.APPDIR + '/modules/driver')(global.APPDIR + '/modules/lists/driver')

var aggregation = (baseClass, ...mixins) => {
    class base extends baseClass {
        constructor (...args) {
            super(...args);
            mixins.forEach((mixin) => {
                copyProps(this,(new mixin));
            });
        }
    }
    let copyProps = (target, source) => {  // this function copies all properties and symbols, filtering out some special ones
        Object.getOwnPropertyNames(source)
              .concat(Object.getOwnPropertySymbols(source))
              .forEach((prop) => {
                 if (!String(prop).match(/^(?:constructor|prototype|arguments|caller|name|bind|call|apply|toString|length)$/))
                    Object.defineProperty(target, prop, Object.getOwnPropertyDescriptor(source, prop));
               })
    }
    mixins.forEach((mixin) => { // outside contructor() to allow aggregation(A,B,C).staticFunction() to be called etc.
        copyProps(base.prototype, mixin.prototype);
        copyProps(base, mixin);
    });
    return base;
}

class Aggregated extends aggregation(Lists, Common) {
	constructor(...args){
		super()
		this.manager = new Manager(this)
	}
}

module.exports = Aggregated

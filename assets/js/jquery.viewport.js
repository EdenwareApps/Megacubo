/*
 * viewport - jQuery plugin for elements positioning in viewport
 * ver.: 0.2
 * (c) Copyright 2014, Anton Zinoviev aka xobotyi
 * Released under the MIT license
 */
(function( $ ) {
	var methods = {
		getElementPosition: function( forceViewport ) {
			var $this = $( this );

			var _scrollableParent = forceViewport ? $this.parents( forceViewport ) : $this.parents( ':have-scroll' );

			if( !_scrollableParent.length ) {
				return false;
			}

			var pos = methods['getRelativePosition'].call( this, forceViewport );
			var _topBorder = pos.top - _scrollableParent.scrollTop();
			var _leftBorder = pos.left - _scrollableParent.scrollLeft();

			return {
				"elemTopBorder": _topBorder,
				"elemBottomBorder": _topBorder + $this.height(),
				"elemLeftBorder": _leftBorder,
				"elemRightBorder": _leftBorder + $this.width(),
				"viewport": _scrollableParent,
				"viewportHeight": _scrollableParent.height(),
				"viewportWidth": _scrollableParent.width()
			};
		},
		getRelativePosition: function( forceViewport ) {
			var fromTop = 0;
			var fromLeft = 0;
			var $obj = null;

			for( var obj = $( this ).get( 0 ); obj && !$( obj ).is( forceViewport ? forceViewport : ':have-scroll' ); obj = $( obj ).parent().get( 0 ) ) {
				$obj = $( obj );
				if( typeof $obj.data( 'pos' ) == 'undefined' || new Date().getTime() - $obj.data( 'pos' )[1] > 1000 ) {
					/*
					 * Making some kind of a cache system, it takes a bit of memory but helps us veeery much, reducing calculation
					 * */
					fromTop += obj.offsetTop;
					fromLeft += obj.offsetLeft;
					$obj.data( 'pos', [
						[ obj.offsetTop, obj.offsetLeft ],
						new Date().getTime()
					] );
				} else {
					fromTop += $obj.data( 'pos' )[0][0];
					fromLeft += $obj.data( 'pos' )[0][1];
				}
			}

			return { "top": Math.round( fromTop ), "left": Math.round( fromLeft ) };
		},
		aboveTheViewport: function( threshold ) {
			var pos = methods['getElementPosition'].call( this );

			return pos ? pos.elemTopBorder - threshold < 0 : false;
		},
		partlyAboveTheViewport: function( threshold ) {
			var pos = methods['getElementPosition'].call( this );

			return pos ? pos.elemTopBorder - threshold < 0
				&& pos.elemBottomBorder - threshold >= 0 : false;
		},
		belowTheViewport: function( threshold ) {
			var pos = methods['getElementPosition'].call( this );

			return pos ? pos.viewportHeight < pos.elemBottomBorder + threshold : false;
		},
		partlyBelowTheViewport: function( threshold ) {
			var pos = methods['getElementPosition'].call( this );

			return pos ? pos.viewportHeight < pos.elemBottomBorder + threshold
				&& pos.viewportHeight > pos.elemTopBorder + threshold : false;
		},
		leftOfViewport: function( threshold ) {
			var pos = methods['getElementPosition'].call( this );

			return pos ? pos.elemLeftBorder - threshold <= 0 : false;
		},
		partlyLeftOfViewport: function( threshold ) {
			var pos = methods['getElementPosition'].call( this );

			return pos ? pos.elemLeftBorder - threshold < 0
				&& pos.elemRightBorder - threshold >= 0 : false;
		},
		rightOfViewport: function( threshold ) {
			var pos = methods['getElementPosition'].call( this );

			return pos ? pos.viewportWidth < pos.elemRightBorder + threshold : false;
		},
		partlyRightOfViewport: function( threshold ) {
			var pos = methods['getElementPosition'].call( this );

			return pos ? pos.viewportWidth < pos.elemRightBorder + threshold
				&& pos.viewportWidth > pos.elemLeftBorder + threshold : false;
		},
		inViewport: function( threshold ) {
			var pos = methods['getElementPosition'].call( this );

			return pos ? !( pos.elemTopBorder - threshold < 0 )
				&& !( pos.viewportHeight < pos.elemBottomBorder + threshold )
				&& !( pos.elemLeftBorder - threshold < 0 )
				&& !( pos.viewportWidth < pos.elemRightBorder + threshold ) : true;
		},
		getState: function( threshold, forceViewport, allowPartly ) {
			var ret = { "inside": false, "posY": '', "posX": '' };
			var pos = methods['getElementPosition'].call( this, forceViewport );

			if( !pos ) {
				ret.inside = true;
				return ret;
			}

			var _above = pos.elemTopBorder - threshold < 0;
			var _below = pos.viewportHeight < pos.elemBottomBorder + threshold;
			var _left = pos.elemLeftBorder - threshold < 0;
			var _right = pos.viewportWidth < pos.elemRightBorder + threshold;

			if( allowPartly ) {
				var _partlyAbove = pos.elemTopBorder - threshold < 0 && pos.elemBottomBorder - threshold >= 0;
				var _partlyBelow = pos.viewportHeight < pos.elemBottomBorder + threshold && pos.viewportHeight > pos.elemTopBorder + threshold;
				var _partlyLeft = pos.elemLeftBorder - threshold < 0 && pos.elemRightBorder - threshold >= 0;
				var _partlyRight = pos.viewportWidth < pos.elemRightBorder + threshold && pos.viewportWidth > pos.elemLeftBorder + threshold;
			}

			if( !_above && !_below && !_left && !_right ) {
				ret.inside = true;
				return ret;
			}

			if( allowPartly ) {
				if( _partlyAbove && _partlyBelow ) {
					ret.posY = 'exceeds';
				} else if( ( _partlyAbove && !_partlyBelow ) || ( _partlyBelow && !_partlyAbove ) ) {
					ret.posY = _partlyAbove ? 'partly-above' : 'partly-below';
				} else if( !_above && !_below ) {
					ret.posY = 'inside';
				} else {
					ret.posY = _above ? 'above' : 'below';
				}

				if( _partlyLeft && _partlyRight ) {
					ret.posX = 'exceeds';
				} else if( ( _partlyLeft && !_partlyRight ) || ( _partlyLeft && !_partlyRight ) ) {
					ret.posX = _partlyLeft ? 'partly-above' : 'partly-below';
				} else if( !_left && !_right ) {
					ret.posX = 'inside';
				} else {
					ret.posX = _left ? 'left' : 'right';
				}
			} else {
				if( _above && _below ) {
					ret.posY = 'exceeds';
				} else if( !_above && !_below ) {
					ret.posY = 'inside';
				} else {
					ret.posY = _above ? 'above' : 'below';
				}

				if( _left && _right ) {
					ret.posX = 'exceeds';
				} else if( !_left && !_right ) {
					ret.posX = 'inside';
				} else {
					ret.posX = _left ? 'left' : 'right';
				}
			}

			return ret;
		},
		haveScroll: function() {
			return this.scrollHeight > this.offsetHeight
				|| this.scrollWidth > this.offsetWidth;
		},
		generateEUID: function() {
			var result = "";
			for( var i = 0; i < 32; i++ ) {
				result += Math.floor( Math.random() * 16 ).toString( 16 );
			}

			return result;
		}
	};

	$.extend( $.expr[':'], {
		"in-viewport": function( obj, index, meta ) {
			var _threshold = typeof meta[3] == 'string' ? parseInt( meta[3], 10 ) : 0;
			return methods['inViewport'].call( obj, _threshold );
		},
		"above-the-viewport": function( obj, index, meta ) {
			var _threshold = typeof meta[3] == 'string' ? parseInt( meta[3], 10 ) : 0;
			return methods['aboveTheViewport'].call( obj, _threshold );
		},
		"below-the-viewport": function( obj, index, meta ) {
			var _threshold = typeof meta[3] == 'string' ? parseInt( meta[3], 10 ) : 0;
			return methods['belowTheViewport'].call( obj, _threshold );
		},
		"left-of-viewport": function( obj, index, meta ) {
			var _threshold = typeof meta[3] == 'string' ? parseInt( meta[3], 10 ) : 0;
			return methods['leftOfViewport'].call( obj, _threshold );
		},
		"right-of-viewport": function( obj, index, meta ) {
			var _threshold = typeof meta[3] == 'string' ? parseInt( meta[3], 10 ) : 0;
			return methods['rightOfViewport'].call( obj, _threshold );
		},
		"partly-above-the-viewport": function( obj, index, meta ) {
			var _threshold = typeof meta[3] == 'string' ? parseInt( meta[3], 10 ) : 0;
			return methods['partlyAboveTheViewport'].call( obj, _threshold );
		},
		"partly-below-the-viewport": function( obj, index, meta ) {
			var _threshold = typeof meta[3] == 'string' ? parseInt( meta[3], 10 ) : 0;
			return methods['partlyBelowTheViewport'].call( obj, _threshold );
		},
		"partly-left-of-viewport": function( obj, index, meta ) {
			var _threshold = typeof meta[3] == 'string' ? parseInt( meta[3], 10 ) : 0;
			return methods['partlyLeftOfViewport'].call( obj, _threshold );
		},
		"partly-right-of-viewport": function( obj, index, meta ) {
			var _threshold = typeof meta[3] == 'string' ? parseInt( meta[3], 10 ) : 0;
			return methods['partlyRightOfViewport'].call( obj, _threshold );
		},
		"have-scroll": function( obj ) {
			return methods['haveScroll'].call( obj );
		}
	} );

	$.fn.viewportTrack = function( options ) {
		var settings = {
			"threshold": 0,
			"allowPartly": false,
			"forceViewport": false,
			"tracker": false,
			"checkOnInit": true
		};

		if( typeof options == 'undefined' ) {
			return methods['getState'].apply( this, [ settings.threshold, settings.forceViewport, settings.allowPartly ] );
		} else if( typeof options == 'string' ) {
			if( options == 'destroy' ) {
				return this.each( function() {
					var $this = $( this );

					if( typeof $this.data( 'viewport_euid' ) == 'undefined' ) {
						return true;
					}

					var _scrollable = $( [] );

					if( typeof $this.data( 'viewport' ) != 'undefined' ) {
						$this.data( 'viewport' ).forEach( function( val ) {
							_scrollable = $.extend( _scrollable, $this.parents( val ) );
						} );
					} else {
						_scrollable = $.extend( _scrollable, $this.parents( ":have-scroll" ) );
					}

					_scrollable.each( function() {
						if( $( this ).get( 0 ).tagName == "BODY" ) {
							$( window ).unbind( ".viewport" + $this.data( 'viewport_euid' ) );
						} else {
							$( this ).unbind( ".viewport" + $this.data( 'viewport_euid' ) );
						}
					} );

					$this.removeData( 'viewport_euid' );
				} );
			} else {
				$.error( 'Incorrect parameter value.' );
				return this;
			}
		} else if( typeof options == 'object' ) {
			$.extend( settings, options );

			if( !settings.tracker && typeof settings.tracker != 'function' ) {
				return methods['getState'].apply( this, [ settings.threshold, settings.forceViewport, settings.allowPartly ] );
			} else {
				return this.each( function() {
					var $this = $( this );
					var obj = this;

					if( typeof $this.data( 'viewport_euid' ) == 'undefined' ) {
						$this.data( 'viewport_euid', methods['generateEUID'].call() );
					}

					if( settings.forceViewport ) {
						if( typeof $this.data( 'viewport' ) == 'undefined' ) {
							$this.data( 'viewport', [ settings.forceViewport ] );
						} else {
							$this.data( 'viewport' ).push( settings.forceViewport );
						}
					}

					if( settings.checkOnInit ) {
						settings.tracker.apply( obj, [ methods['getState'].apply( obj, [ settings.threshold, settings.forceViewport, settings.allowPartly ] ) ] );
					}

					var _scrollable = settings.forceViewport ? $this.parents( settings.forceViewport ) : $this.parents( ':have-scroll' );

					if( !_scrollable.length ) {
						if( settings.forceViewport ) {
							$.error( 'No such parent \'' + settings.forceViewport + '\'' );
						} else {
							settings.tracker.apply( obj, [ { "inside": true, "posY": '', "posX": '' } ] );
							return true;
						}
					}

					if( _scrollable.get( 0 ).tagName == "BODY" ) {
						$( window ).bind( "scroll.viewport" + $this.data( 'viewport_euid' ), function() {
							settings.tracker.apply( obj, [ methods['getState'].apply( obj, [ settings.threshold, settings.forceViewport, settings.allowPartly ] ) ] );
						} );
					} else {
						_scrollable.bind( "scroll.viewport" + $this.data( 'viewport_euid' ), function() {
							settings.tracker.apply( obj, [ methods['getState'].apply( obj, [ settings.threshold, settings.forceViewport, settings.allowPartly ] ) ] );
						} );
					}
				} );
			}
		}
	};
})( jQuery );
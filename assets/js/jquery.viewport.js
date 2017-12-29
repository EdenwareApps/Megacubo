/*
 * Viewport - jQuery selectors for finding elements in viewport
 *
 * Copyright (c) 2008-2009 Mika Tuupola
 *
 * Licensed under the MIT license:
 *   http://www.opensource.org/licenses/mit-license.php
 *
 * Project home:
 *  http://www.appelsiini.net/projects/viewport
 *
 */
/*global define,require*/
(function (root, factory) {
    "use strict";

    if (typeof define === 'function' && define.amd) {
        define(['jquery'], factory);
    } else if (typeof module === 'object' && module.exports) {
        factory(require('jquery'));
    } else {
        factory(root.jQuery);
    }
}(this, function ($) {
    "use strict";

    var $window = $(window);

    function int(val) {
        return parseInt(val, 10) || 0;
    }

    function belowTheFold(element, settings) {
        var fold = $window.height() + $window.scrollTop();
        return fold <= Math.round($(element).offset().top) - settings.threshold;
    }

    function belowTheFoldCompletely(element, settings) {
        var $element = $(element),
            fold = $window.height() + $window.scrollTop();
        return fold <= $element.offset().top + $element.height() - settings.threshold;
    }

    function aboveTheTop(element, settings) {
        var $element = $(element),
            top = $window.scrollTop();
        return top >= Math.round($element.offset().top) +
            $element.height() - settings.threshold;
    }

    function aboveTheTopCompletely(element, settings) {
        var top = $window.scrollTop();
        return top >= $(element).offset().top - settings.threshold;
    }

    function rightOfScreen(element, settings) {
        var fold = $window.width() + $window.scrollLeft();
        return fold <= $(element).offset().left - settings.threshold;
    }

    function rightOfScreenCompletely(element, settings) {
        var $element = $(element),
            fold = $window.width() + $window.scrollLeft();
        return fold <= $element.offset().left + $element.width() - settings.threshold;
    }

    function leftOfScreen(element, settings) {
        var $element = $(element),
            left = $window.scrollLeft();
        return left >= Math.round($element.offset().left) + $element.width() - settings.threshold;
    }

    function leftOfScreenCompletely(element, settings) {
        var left = $window.scrollLeft();
        return left >= $(element).offset().left - settings.threshold;
    }

    function inViewport(element, settings) {
        var $element = $(element),
            offset = $element.offset();

        // Return false if element is hidden.
        if (!$element.is(':visible')) {
            return false;
        }

        var windowTop = $window.scrollTop(),
            threshold = settings.threshold;

        if (offset.top - threshold < windowTop) {
            if (offset.top + $element.height() + threshold >= windowTop) {
                // top edge below the window's top
            } else {
                return false;
            }
        } else if (offset.top - threshold > windowTop + $window.height()) {
            // not (bottom edge above the window's bottom)
            return false;
        }

        var windowLeft = $window.scrollLeft();

        if (offset.left - threshold < windowLeft) {
            if (offset.left + $element.width() + threshold >= windowLeft) {
                // left edge be on the left side of the window's left edge
            } else {
                return false;
            }
        } else if (offset.left - threshold > windowLeft + $window.width()) {
            // not (right edge be on the right side of the window's right edge)
            return false;
        }

        return true;
    }

    $.extend($.expr[':'], {
        "below-the-fold": function (a, i, m) {
            // m[3] is supposedly the threshold (@theluk)
            return belowTheFold(a, {threshold: int(m[3])});
        },
        "below-the-fold-completely": function (a, i, m) {
            // m[3] is supposedly the threshold (@theluk)
            return belowTheFoldCompletely(a, {threshold: int(m[3])});
        },
        "above-the-top": function (a, i, m) {
            // m[3] is supposedly the threshold (@theluk)
            return aboveTheTop(a, {threshold: int(m[3])});
        },
        "above-the-top-completely": function (a, i, m) {
            // m[3] is supposedly the threshold (@theluk)
            return aboveTheTopCompletely(a, {threshold: int(m[3])});
        },
        "left-of-screen": function (a, i, m) {
            // m[3] is supposedly the threshold (@theluk)
            return leftOfScreen(a, {threshold: int(m[3])});
        },
        "left-of-screen-completely": function (a, i, m) {
            // m[3] is supposedly the threshold (@theluk)
            return leftOfScreenCompletely(a, {threshold: int(m[3])});
        },
        "right-of-screen": function (a, i, m) {
            // m[3] is supposedly the threshold (@theluk)
            return rightOfScreen(a, {threshold: int(m[3])});
        },
        "right-of-screen-completely": function (a, i, m) {
            // m[3] is supposedly the threshold (@theluk)
            return rightOfScreenCompletely(a, {threshold: int(m[3])});
        },
        "in-viewport": function (a, i, m) {
            // m[3] is supposedly the threshold (@theluk)
            return inViewport(a, {threshold: int(m[3])});
        }
    });

    // Export some functions for testing.
    $.viewport = $.viewport || {};
    $.extend($.viewport, {
        aboveTheTop: aboveTheTop,
        aboveTheTopCompletely: aboveTheTopCompletely,
        belowTheFold: belowTheFold,
        belowTheFoldCompletely: belowTheFoldCompletely,
        inViewport: inViewport,
        leftOfScreen: leftOfScreen,
        leftOfScreenCompletely: leftOfScreenCompletely,
        rightOfScreen: rightOfScreen,
        rightOfScreenCompletely: rightOfScreenCompletely
    });
}));

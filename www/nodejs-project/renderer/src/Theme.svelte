<script>
    import '../../modules/theme/renderer'
</script>
<div id="background-wrapper">
    <div id="background"></div>
</div>
<style global>
div#background-wrapper {
    position: fixed;
    top: 0;
    width: 100vw;
    height: 100.2vh; /* prevent blank line on bottom for some devices */
    z-index: -1;
    transition: transform 0.5s ease-out 0s;
}
html.playing div#background-wrapper {
    transform: scale(1.1);
    transform-origin: center center;				
}
div#background {
    background-size: cover;
    background-position: center center;
    width: 100%;
    height: 100%;
    visibility: hidden;
    transform-origin: center center;
}
body.animate-background-slow div#background {
    animation-name: background-breathing;
    animation-duration: 30s;
    animation-timing-function: linear;
    animation-iteration-count: infinite;
}
body.animate-background-fast div#background {
    animation-name: background-breathing;
    animation-duration: 15s;
    animation-timing-function: linear;
    animation-iteration-count: infinite;
}
body.animate-background-slow div#background, body.animate-background-fast div#background {
    transform: translateZ(0);
    backface-visibility: hidden;
    perspective: 1000;
    will-change: transform;
}
@keyframes background-breathing {
    0% {
        transform: scale(1.1) rotateZ(0deg);
    }
    5% {
        transform: scale(1.1) rotateZ(-0.8deg);
    }
    45% {
        transform: scale(1.2) rotateZ(-0.8deg);
    }
    50% {
        transform: scale(1.2) rotateZ(0deg);
    }
    55% {
        transform: scale(1.2) rotateZ(0.8deg);
    }
    95% {
        transform: scale(1.1) rotateZ(0.8deg);
    }
    100% {
        transform: scale(1.1) rotateZ(0deg);
    }
}
</style>
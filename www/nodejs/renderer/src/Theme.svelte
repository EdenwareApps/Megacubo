<script>
    import '../../modules/theme/renderer'
</script>
<div id="background-wrapper">
    <div id="background"><div></div></div>
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
div#background > div {
    position: absolute;
    width: 100vw;
    height: 100vh;
    display: block;
    top: 0;
}
</style>
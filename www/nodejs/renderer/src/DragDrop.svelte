<script>
    import { onMount } from 'svelte';
    import { main } from '../../modules/bridge/renderer';

    onMount(() => {
        if (window.capacitor) return;

        let dragCounter = 0;
        const dropOverlay = document.getElementById('drop-overlay');

        function showOverlay() {
            dropOverlay.style.display = 'block';
        }

        function hideOverlay() {
            dropOverlay.style.display = 'none';
        }

        window.addEventListener('dragover', event => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
        });

        window.addEventListener('dragenter', event => {
            event.preventDefault();
            dragCounter++;
            showOverlay();
        });

        window.addEventListener('dragleave', event => {
            event.preventDefault();
            dragCounter--;
            if (dragCounter === 0) {
                hideOverlay();
            }
        });

        window.addEventListener('drop', event => {
            event.preventDefault();
            dragCounter = 0;
            hideOverlay();
            if (event.dataTransfer.files.length > 0) {
                [...event.dataTransfer.files].forEach((file) => {
                    main.waitMain(() => {
                        const path = top.electron.showFilePath(file);
                        path && main.emit('open-url', path);
                    });
                });
            } else {
                const data = event.dataTransfer.getData('text/plain');
                if (data) {
                    main.waitMain(() => data && main.emit('open-url', data));
                }
            }
        });
    });
</script>
<style>
    #drop-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.75);
        z-index: 9999;
        opacity: 0.25;
        display: none;
        pointer-events: none;
    }
</style>
<div id="drop-overlay"></div>
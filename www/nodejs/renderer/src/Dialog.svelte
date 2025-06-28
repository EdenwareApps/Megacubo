<script>
    import { main } from "../../modules/bridge/renderer";
    import { onMount } from "svelte";

    let visible = $state(false);
    let content = $state({ entries: [], opts: [], defaultIndex: "", type: "", value: "" });
    let maskedValue = $state('');
    let mandatory = $state(false);
    let dialogQueue = $state([]);
    let currentCallback = $state(null);

    let { container = $bindable() } = $props();

    function plainText(html) {
        const temp = document.createElement("div");
        temp.innerHTML = html;
        return temp.textContent;
    }

    function text2id(txt) {
        if (txt.match(/^[A-Za-z0-9\-_]+$/)) {
            return txt;
        }
        return txt.toLowerCase().replace(/[^a-z0-9\-_]+/gi, "");
    }

    function replaceTags(text, replaces) {
        if (replaces["name"] && !replaces["rawname"]) {
            replaces["rawname"] = replaces["name"];
        }
        Object.keys(replaces).forEach((before) => {
            let t = typeof replaces[before];
            if (["string", "number", "boolean"].includes(t)) {
                let to = String(replaces[before]).replaceAll('"', '"');
                text = text.split("{" + before + "}").join(to);
                if (text.includes("\r\n")) {
                    text = text.replace(/\r\n/g, "<br />");
                }
            }
        });
        return text.replace(/\{[a-z\-]+\}/g, "");
    }

    async function start() {
        await main.menu?.sounds?.play("warn", {
            volume: 45,
            time: 275
        });
        visible = true;
        await new Promise(resolve => setTimeout(resolve, 10));
        if (visible) {
            let element = null;
            main.emit("dialog-start");
            document.body.classList.add("dialog");
            if (!main.menu) return;
            const defaultIndex = content.defaultIndex || content.opts[0].id;
            if(defaultIndex && (element=document.getElementById(`dialog-template-option-${defaultIndex}`))) {
                const key = main.menu.getKey(element);
                main.menu.lastSelectedKey = key;
                main.menu.emit("focus", element);
            } else {
                main.menu.emit("reset")
            }
            const input = container.querySelector("input, textarea");
            if (input && input !== document.activeElement) {
                input.focus();
                await new Promise(resolve => setTimeout(resolve, 10));
                input.select();
            }
        }
    }

    export function end(cancel = false) {
        if (!visible) return;
        visible = false;
        if (currentCallback) {
            try {
                currentCallback(null, true); // Call callback with null on cancel
            } catch (err) {
                console.error('!!! dialog callback error', err);
            }
        }
        content = { entries: [], opts: [], defaultIndex: "", type: "", value: "" };
        maskedValue = '';
        mandatory = false;
        currentCallback = null;
        document.body.classList.remove("dialog");
        setTimeout(() => {
            main.emit("dialog-end");
            nextDialog();
        }, 100);
    }

    function queueDialog(config, callback, mandatoryParam) {
        dialogQueue = [...dialogQueue, { config, callback }];
        mandatory = mandatoryParam || false;
        if (!visible) nextDialog();
    }

    function nextDialog() {
        if (dialogQueue.length > 0 && !visible) {
            const { config, callback } = dialogQueue[0];
            const opts = [];
            config.entries = config.entries.filter(e => {
                const isOption = e.template === "option" || e.template === "option-detailed";
                if (isOption) {
                    opts.push(e);
                }
                return !isOption;
            }).map(e => {
                if (e.text && e.text.includes('\n')) {
                    e.text = e.text.replace(new RegExp('\r?\n', 'g'), '<br />');
                }
                return e;
            });
            content = { ...config, opts };
            currentCallback = callback;
            dialogQueue = dialogQueue.slice(1);
            start();
        }
    }

    function sendCallback(id, cb, cancel) {
        if (cancel) id = null;
        if (id === "submit") {
            const input = container.querySelector("input, textarea");
            if (input) id = content.value; // Use content.value for consistency
        }
        if (typeof cb === "function") {
            cb(id);
        } else if (typeof cb === "string") {
            main.emit(cb, id || ''); // emitting null causes error: An object could not be cloned.
        } else if (Array.isArray(cb)) {
            cb.push(id || ''); // emitting null causes error: An object could not be cloned.
            main.emit(...cb);
        }
        end(); // Close dialog after any button click
    }

    export function dialog(entries, cb, defaultIndex, mandatoryParam) {
        console.log("dialog", { entries, cb, defaultIndex, mandatoryParam });
        let done = false;
        queueDialog(
            { entries, defaultIndex, type: "dialog" },
            (id, cancel) => {
                if(done) return;
                done = true;
                if (cancel) {
                    id = null;
                }
                sendCallback(id, cb, cancel);
            },
            mandatoryParam
        );
    }

    export function info(title, text, cb, fa) {
        const entries = [
            {
                template: "question",
                text: title,
                fa: fa || "fas fa-info-circle",
            },
            { template: "message", text },
            {
                template: "option",
                text: "OK",
                id: "submit",
                fa: "fas fa-check-circle",
            },
        ];
        dialog(
            entries,
            cb,
            "submit",
            false
        );
    }

    export function select(question, entries, fa, def, callback) {
        let map = {}
        const selectedIcon = "fas fa-check-circle";
        const opts = [{ template: "question", text: question, fa }];
        opts.push(
            ...entries.map((e) => {
                e.template = "option";
                e.text = String(e.name);
                e.id = e.id || text2id(e.text);
                map[e.id] = e.text;
                if (def == e.id) {
                    e.fa = selectedIcon;
                } else if (e.fa == selectedIcon) {
                    e.fa = ''
                }
                return e;
            })
        );
        dialog(
            opts,
            callback,
            def,
            false
        );
    }

    export function prompt(atts) {
        let opts = [{ template: "question", text: atts.question, fa: atts.fa }];
        if (atts.message) {
            opts.push({ template: "message", text: atts.message });
        }
        opts.push({
            template: atts.multiline ? "textarea" : "text",
            text: atts.defaultValue || "",
            id: "text",
            mask: atts.mask,
            isPassword: atts.isPassword,
            placeholder: atts.placeholder,
        });
        opts.push({
            template: "option",
            text: "OK",
            id: "submit",
            fa: "fas fa-check-circle",
        });
        if (atts.extraOpts) {
            opts.push(...atts.extraOpts);
        }
        dialog(
            opts,
            atts.callback,
            "submit",
            false
        );
    }

    export function slider(question, message, range, value, mask, callback, fa) {
        let opts = [{ template: "question", text: question, fa }];
        if (message && message !== question) {
            opts.push({ template: "message", text: message });
        }
        opts.push({ template: "slider", id: "slider", range, value, mask });
        opts.push({
            template: "option",
            text: "OK",
            id: "submit",
            fa: "fas fa-check-circle",
        });
        maskedValue = mask ? main.menu.maskValue(value, mask) : '';
        dialog(
            opts,
            callback,
            "",
            false
        );
    }

    export function inDialog() {
        return visible;
    }

    export function inDialogMandatory() {
        return visible && mandatory;
    }

    function handleOptionClick(id) {
        if (currentCallback) {
            if (id === 'submit') {
                const input = container.querySelector("input, textarea");
                if (input) id = input.value;
            }
            currentCallback(id);
            currentCallback = null;
        }
    }

    function handleInputChange(event) {
        content.value = event.target.value;
        const mask = event.target.getAttribute('data-mask');
        maskedValue = mask ? main.menu.maskValue(content.value, mask) : '';
    }

    function focusElement(element) {
        if (element) {
            element.focus();            
        }
    }

    async function maybePasteClipboard(element) {
        if (element.tagName !== 'INPUT' && element.tagName !== 'TEXTAREA') {
            return;
        }
        let mask = element.getAttribute('data-mask');
        if(!mask) {
            if (element.placeholder?.startsWith('http')) {
                mask = 'url';
            } else {
                return;
            }
        }
        const text = await main.menu.readClipboard();
        if(text) {
            if (mask === 'url') {
                mask = '(https?|ftp|rtmp[s]?|rtsp[\\w-]*|mega)://([^\\s"\']*)';
            }
            const regex = new RegExp('('+ mask +')');
            const matched = text.match(regex);
            if(matched) {
                element.value = matched[1];
                element.select();
            }
        }
        
    }

    onMount(() => {
        main.on("info", (a, b, c) => info(a, b, null, c));
        main.on("dialog", dialog);
        main.on("dialog-close", end);
        main.on("prompt", prompt);
    });

    $effect(() => {
        if (visible) {
            const defaultElement = container.querySelector(
                `#dialog-template-option-${content.defaultIndex}`
            );
            if (defaultElement) {
                defaultElement.focus();
            }
        }
    });
</script>

<div id="dialog" bind:this={container}>
    {#if visible}
        <div
            class="dialog-overlay"
            role="button"
            tabindex="-1"
            onmousedown={() => !mandatory && end(true)}
        >
            <div class="dialog-content">
                <div class="dialog-wrap">
                    <div
                        tabindex="-1"
                        role="button"
                        onmousedown={(e) => e.stopPropagation()}
                    >
                        <div class="dialog-template-entries">
                            {#each content.entries as entry}
                                {#if entry.template === "question"}
                                    <span class="dialog-template-question">
                                        {#if entry.fa}
                                            {#if entry.fa.startsWith("fa")}
                                                <i class={entry.fa} aria-hidden="true"></i>
                                            {:else}
                                                <img src={entry.fa} alt={entry.text} aria-hidden="true" />
                                            {/if}
                                        {/if}
                                        {@html entry.text}
                                        <span style="position: absolute; right: var(--padding-2x);">{maskedValue}</span>
                                    </span>
                                {:else if entry.template === "message"}
                                    <span class="dialog-template-message">{@html entry.text}</span>
                                {:else if entry.template === "text"}
                                    <span class="dialog-template-text">
                                        <input
                                            type={entry.isPassword ? "password" : "text"}
                                            onfocus={(e) => maybePasteClipboard(e.target)}
                                            placeholder={entry.placeholder} 
                                            data-mask={entry.mask||''} 
                                            value={entry.value} 
                                            onchange={handleInputChange}
                                            aria-label={entry.plainText || plainText(entry.text)}
                                        />
                                    </span>
                                {:else if entry.template === "textarea"}
                                    <span class="dialog-template-textarea">
                                        <textarea
                                            placeholder={entry.placeholder}
                                            value={entry.value} 
                                            onchange={handleInputChange}
                                            onfocus={(e) => maybePasteClipboard(e.target)}
                                            data-mask={entry.mask||''} 
                                            rows="3"
                                            aria-label={entry.plainText || plainText(entry.text)} 
                                            class="dialog-template-textarea"
                                        ></textarea>
                                    </span>
                                {:else if entry.template === "slider"}
                                    <div class="dialog-template-slider">
                                        <span class="dialog-template-slider-left">
                                            <i class="fas fa-caret-left"></i>
                                        </span>
                                        <input
                                            type="range"
                                            min={entry.range.start}
                                            max={entry.range.end}
                                            step="1"
                                            value={entry.value}
                                            data-mask={entry.mask||''} 
                                            onchange={handleInputChange} 
                                            oninput={handleInputChange} 
                                            class="dialog-template-slider-track selected"
                                            aria-label={entry.plainText || plainText(entry.text)}
                                        />
                                        <span class="dialog-template-slider-right">
                                            <i class="fas fa-caret-right"></i>
                                        </span>
                                    </div>                                    
                                {/if}
                            {/each}
                        </div>
                        <div class="dialog-template-options {content.opts.length == 2 || content.opts.length > 3 ? 'two-columns' : ''} {content.entries && content.entries.findLastIndex(e => e.template.startsWith('text')) == (content.entries.length - 1) ? 'sharp-top' : ''}">
                            {#each content.opts as option}
                                {#if option.template === "option" || option.template === "option-detailed"}
                                    <button
                                        id="dialog-template-option-{text2id(option.id)}"
                                        title={option.text}
                                        aria-label={option.text}
                                        onclick={() => handleOptionClick(option.id)}
                                        class={option.template === "option-detailed"
                                            ? "dialog-template-option-detailed"
                                            : "dialog-template-option"} 
                                        onmouseenter={(event) => focusElement(event.target)}
                                        style={(content.opts.length > 3 && (content.opts.length % 2) == 1 && option == content.opts[content.opts.length - 1]) ? 'width: 100%;' : ''}
                                    >
                                        {#if option.fa}
                                            <i class={option.fa}></i>
                                        {/if}
                                        <div>
                                            <div>{@html option.text}</div>
                                            {#if option.details}
                                                <div class="dialog-template-option-detailed-details">
                                                    {@html option.details}
                                                </div>
                                            {/if}
                                        </div>
                                    </button>
                                {/if}
                            {/each}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    {/if}
</div>

<style global>
    #dialog ::-webkit-scrollbar-thumb {
        background: rgba(0,0,0,0.25);
        box-shadow: 0px 1px 2px rgba(0, 0, 0, 0.75);
    }
    #dialog ::-webkit-slider-runnable-track {
        height: 100%;
    }
    div#dialog {
        width: 100vw;
        height: 100vh;
        top: 0;
        left: 0;
        z-index: 4;
        position: fixed;
        pointer-events: none;
    }
    .dialog-overlay {
        overflow: hidden;
        padding: var(--padding);
        border-radius: var(--radius);
        flex-direction: column;
        width: 100vw;
        height: 100vh;
        display: flex;
        transition: background 0.4s linear 0s;
        padding-top: var(--menu-padding-top);
        padding-left: var(--menu-padding-left);
        padding-right: var(--menu-padding-right);
        padding-bottom: var(--menu-padding-bottom);
        background: var(--alpha-shadow-background-color);
        z-index: 4;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        pointer-events: all;
    }
    .dialog-content {
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        height: 100%;
        max-width: 96%;
    }
    .dialog-wrap {
        max-height: var(--dialog-height);
        max-width: 88%;
        display: flex;
        align-items: center;
        justify-content: center;
        transform: none;
        transition: transform var(--menu-fx-nav-duration) ease-in-out 0s;
        border-radius: var(--radius);
        padding: var(--padding);
    }
    .dialog-wrap > div {
        width: 94vw;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
    }
    .dialog-template-message {
        margin-bottom: var(--padding);
        padding: 1.5vmax var(--padding);
        display: flex;
        justify-content: center;
        line-height: 175%;
        flex-shrink: 999;
        overflow: auto;
        word-break: break-word;
    }
    .dialog-template-message font {
        display: contents;
    }
    .dialog-template-spacer {
        max-width: var(--menu-dialog-option-min-width);
        padding: var(--padding);
        box-sizing: border-box;
        display: block;
        width: 100%;
    }
    .dialog-template-text,
    .dialog-template-textarea {
        padding: 0 var(--padding);
        display: flex;
        max-width: var(--menu-dialog-option-min-width);
        width: 100%;
        box-sizing: border-box;
        align-items: center;
        font-size: var(--menu-entry-name-font-size);
        background: linear-gradient(to top, rgba(255, 255, 255, 0.5), white);
        border-radius: var(--radius);
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
    }
    .dialog-template-text i,
    .dialog-template-textarea i {
        color: rgba(0, 0, 0, 0.8);
        opacity: var(--opacity-level-2);
    }
    .dialog-template-text i {
        padding-right: var(--padding-half);
    }
    .dialog-template-textarea i {
        padding-right: var(--padding);
    }
    .dialog-template-textarea {
        margin-bottom: var(--padding);
    }
    .dialog-template-textarea,
    .dialog-template-textarea textarea {
        min-height: 20vmax;
    }
    .dialog-template-text input,
    .dialog-template-textarea textarea {
        opacity: var(--opacity-level-4);
        background: transparent;
        padding: 0;
        width: inherit;
        min-height: 7vmax;
        border: 0;
        outline: 0;
        max-width: 97%;
        display: inline-block;
        font-size: var(--menu-entry-name-font-size);
        border-radius: var(--radius);
    }
    .dialog-template-textarea textarea {
        min-height: 25vh;
        padding: var(--padding);
        line-height: 150%;
    }
    .dialog-template-question {
        text-align: left;
    }
    .dialog-template-question i {
        margin-right: var(--padding);
        position: relative;
        top: 2px;
    }
    .dialog-template-question img {
        height: 2.5vmax;
        width: auto;
        max-width: 5vmax;
        object-fit: contain;
        object-position: center;
        margin-right: var(--padding);
    }
    .dialog-template-slider,
    .dialog-template-option,
    .dialog-template-option-detailed,
    .dialog-template-question {
        width: 100%;
        display: flex;
        min-height: 5vh;
        align-items: center;
        box-sizing: border-box;
        font-size: var(--menu-entry-name-font-size);
        max-width: var(--menu-dialog-option-min-width);
    }
    .dialog-template-entries {
        overflow: auto;
        min-height: 4vh;        
    }
    body.portrait .dialog-template-slider,
    body.portrait .dialog-template-option,
    body.portrait .dialog-template-option-detailed,
    body.portrait .dialog-template-question,
    body.portrait .dialog-template-message {
        font-size: var(--menu-entry-details-font-size);
    }
    .dialog-template-question {
        padding: 0 0 1.5vmax 0;
    }
    .dialog-template-slider {
        padding: 1.5vmax 0;
    }
    .dialog-template-option,
    .dialog-template-option-detailed {
        cursor: pointer;
        justify-content: center;
        background: linear-gradient(
            to bottom,
            rgba(255, 255, 255, 0.3) 0%,
            transparent 150%
        );
        color: black;
        border-width: 0 0 1px 0;
        border-style: solid;
        border-color: rgba(0, 0, 0, 0.1);
    }
    .dialog-template-option > div,
    .dialog-template-option-detailed > div {
        padding: 2.5vmax 0;
    }
    .dialog-template-option.selected,
    .dialog-template-option-detailed.selected
        .dialog-template-option-detailed-name {
        text-shadow: 0 0 1px rgb(0, 0, 0);
    }
    .dialog-template-option i,
    .dialog-template-option-detailed i {
        padding-right: var(--menu-padding);
    }
    .dialog-template-option.selected,
    .dialog-template-option-detailed.selected {
        background: linear-gradient(
            to bottom,
            rgba(255, 255, 255, 1) 0%,
            rgba(255, 255, 255, 0.4) 100%
        );
        border-color: rgba(0, 0, 0, 0.4);
        opacity: 1;
    }
    div.dialog-template-option-detailed-name {
        display: flex;
        flex-direction: row;
        align-items: center;
        margin-bottom: var(--padding-half);
        justify-content: center;
    }
    div.dialog-template-option-detailed-details {
        display: block;
        width: 100%;
        font-size: var(--menu-entry-details-font-size);
        opacity: var(--opacity-level-4);
        height: auto;
        line-height: 150%;
    }
    .dialog-template-text.selected-parent i,
    .dialog-template-text.selected-parent input,
    .dialog-template-textarea.selected-parent i,
    .dialog-template-textarea.selected-parent textarea,
    .dialog-template-text input:focus,
    .dialog-template-textarea textarea:focus {
        opacity: 1;
    }
    .dialog-template-options {
        box-sizing: border-box;
        overflow: auto;
        max-height: inherit;
        display: flex;
        flex-direction: column;
        flex-shrink: 1;
        border-radius: var(--radius);
    }
    @media only screen and (min-width: 321px) and (orientation: landscape) {
        .dialog-template-options.two-columns {
            flex-direction: row;
            flex-wrap: wrap;
        }
        .dialog-template-options.two-columns .dialog-template-option,
        .dialog-template-options.two-columns
            .dialog-template-option-detailed {
            width: 50%;
            border-width: 0 1px 1px 0;
        }
    }
    .dialog-template-slider a:first-child,
    .dialog-template-slider a:last-child {
        width: 4.9%;
        display: inline-block;
    }
    .dialog-template-slider .dialog-template-slider-track {
        width: calc(100% - (8 * var(--padding)));
        height: calc(4 * var(--padding));
        display: inline-block;
        margin: var(--padding);
        vertical-align: sub;
    }
    input.dialog-template-slider-track {
        overflow: hidden;
        width: 80px;
        -webkit-appearance: none;
        background: linear-gradient(
            to bottom,
            transparent -100%,
            var(--dialog-background-color) 400%
        );
        border-radius: var(--radius);
    }
    input.dialog-template-slider-track.selected {
        background: linear-gradient(
            to bottom,
            rgba(255, 255, 255, 0.8) -100%,
            var(--dialog-background-color) 400%
        ) !important;
    }
    input.dialog-template-slider-track::-webkit-slider-runnable-track {
        height: 10px;
        -webkit-appearance: none;
        margin-top: -1px;
        display: block;
    }
    input.dialog-template-slider-track::-webkit-slider-thumb {
        width: 10px;
        -webkit-appearance: none;
        height: 10px;
        cursor: ew-resize;
        background: var(--background-color);
        box-shadow: calc(100vw * -1) 0 0 100vw var(--background-color);
    }
    .dialog-template-slider-left,
    .dialog-template-slider-right {
        cursor: pointer;
        font-size: calc(4 * var(--padding));
    }
    .dialog-template-message i.fa-circle.faclr-green {
        color: #0f0 !important;
        filter: drop-shadow(0 0 0.4vmin #0f0);
        margin-right: 0.8vmin;
    }
    .dialog-template-message i.fa-circle.faclr-orange {
        color: #e0d213 !important;
        filter: drop-shadow(0 0 0.4vmin #e0d213);
        margin-right: 0.8vmin;
    }
    .dialog-template-message i.fa-circle.faclr-red {
        color: #f05 !important;
        filter: drop-shadow(0 0 0.4vmin #f05);
        margin-right: 0.8vmin;
    }
    .dialog-template-message i.fa-circle.faclr-darkred {
        color: #930d42 !important;
        filter: drop-shadow(0 0 0.4vmin #930d42);
        margin-right: 0.8vmin;
    }
    .sharp-top {
        border-top-left-radius: 0;
        border-top-right-radius: 0;
    }
</style>

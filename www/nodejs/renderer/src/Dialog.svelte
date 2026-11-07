<script>
    import { main } from "../../modules/bridge/renderer";
    import { onMount, onDestroy } from "svelte";

    let visible = $state(false);
    let content = $state({ entries: [], opts: [], defaultIndex: "", type: "", value: "", id: null });
    let maskedValue = $state('');
    let pinValue = $state('');
    let mandatory = $state(false);
    let dialogQueue = $state([]);
    let currentCallback = $state(null);
    let currentDialogId = $state(null);
    // true between picking the next queued dialog and it becoming visible
    let starting = false;

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

    async function start() {
        // do not await the sound: it delays showing the dialog and leaves a gap where a new
        // dialog call could overwrite the one being started
        try {
            main.menu?.sounds?.play("warn", {
                volume: 45,
                time: 275
            })?.catch?.(() => {});
        } catch (e) {}
        starting = false;
        visible = true;
        await new Promise(resolve => setTimeout(resolve, 10));
        if (visible) {
            let element = null;
            main.emit("dialog-start");
            document.body.classList.add("dialog");
            if (!main.menu) return;
            const firstOption = content.opts && content.opts[0];
            const defaultIndex = content.defaultIndex || (firstOption ? firstOption.id : null);
            if(defaultIndex && (element=document.getElementById(`dialog-template-option-${text2id(String(defaultIndex))}`))) {
                const key = main.menu.getKey(element);
                main.menu.lastSelectedKey = key;
                main.menu.emit("focus", element);
            } else {
                main.menu.emit("reset")
            }
            const input = container?.querySelector("input, textarea");
            if (input && input !== document.activeElement) {
                input.focus();
                await new Promise(resolve => setTimeout(resolve, 10));
                input.select();
            } else if (!input) {
                // PIN dialogs have no text field: start the spatial navigation on the keypad
                const key = container?.querySelector(".dialog-pin-key");
                if (key) main.menu.emit("focus", key);
            }
        }
    }

    export function end(cancel = false, targetDialogId = null, force = false) {
        // If a specific ID was provided, remove dialogs with this ID from the queue
        if (targetDialogId !== null) {
            removeQueuedDialogs(targetDialogId);
            // If the ID doesn't match the current dialog, only remove from queue
            if (currentDialogId !== targetDialogId) {
                return true; // Removeu da fila com sucesso
            }
        }

        if (!visible) return false;
        
        // CRITICAL: Prevent closing mandatory dialogs unless forced
        // force=true is used for:
        // 1. Programmatic closes via dialog-close event with matching ID
        // 2. User actions (clicking dialog options)
        if (mandatory && !force) {
            return false; // Cannot close mandatory dialog
        }
        
        visible = false;
        starting = false;
        if (currentCallback) {
            try {
                currentCallback(null, true); // Call callback with null on cancel
            } catch (err) {
                console.error('!!! dialog callback error', err);
            }
        }
        content = { entries: [], opts: [], defaultIndex: "", type: "", value: "", id: null };
        maskedValue = '';
        pinValue = '';
        mandatory = false;
        currentCallback = null;
        currentDialogId = null;
        document.body.classList.remove("dialog");
        setTimeout(() => {
            main.emit("dialog-end");
            // A dialog opened right after this one (e.g. a PIN retry) is already on
            // screen: resetting the menu selection here would steal its focus.
            if (!dialogQueue.length && !visible) {
                // No queued dialog: hand focus back to the menu selection
                main.menu?.reset?.();
            }
            nextDialog();
        }, 100);
        return true; // Fechou com sucesso
    }

    export function removeQueuedDialogs(targetDialogId) {
        if (targetDialogId) {
            dialogQueue = dialogQueue.filter(item => item.id !== targetDialogId);
        }
    }

    function queueDialog(config, callback, mandatoryParam) {
        // a dialog with a known id replaces the queued one, otherwise a repeated request
        // (e.g. a loading dialog) stacks identical dialogs that nobody will close later
        if (config.id) removeQueuedDialogs(config.id);
        dialogQueue = [...dialogQueue, { config, callback, id: config.id, mandatory: mandatoryParam || false }];
        if (!visible) nextDialog();
    }

    function nextDialog() {
        if (dialogQueue.length > 0 && !visible && !starting) {
            const { config, callback, id, mandatory: dialogMandatory } = dialogQueue[0];
            const opts = [];
            config.entries = config.entries.filter(e => {
                const isOption = e.template === "option" || e.template === "option-detailed";
                if (isOption) {
                    opts.push(e);
                }
                return !isOption;
            }).map(e => {
                if (typeof e.text === 'string' && e.text.includes('\n')) {
                    e.text = e.text.replace(new RegExp('\r?\n', 'g'), '<br />');
                }
                return e;
            });
            content = { ...config, opts };
            pinValue = '';
            currentCallback = callback;
            currentDialogId = id;
            mandatory = dialogMandatory || false;
            dialogQueue = dialogQueue.slice(1);
            starting = true;
            start();
        }
    }

    function sendCallback(id, cb, cancel) {
        if (cancel) id = null;
        if (id === "submit") {
            const input = container?.querySelector("input, textarea");
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
        // CRITICAL: User action (clicking option) should always close dialog, even if mandatory
        end(cancel, null, true); // force=true allows closing mandatory dialogs via user action
    }

    export function dialog(entries, callbackId, defaultIndex, mandatoryParam, dialogId = null) {
        console.log("dialog", { entries, callbackId, defaultIndex, mandatoryParam, dialogId });
        let done = false;
        queueDialog(
            { entries, defaultIndex, type: "dialog", id: dialogId },
            (id, cancel) => {
                if(done) return;
                done = true;
                if (cancel) {
                    id = null;
                }
                sendCallback(id, callbackId, cancel);
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

    export function select(question, entries, fa, def, callback, forceHero, programme, hasAffiliates) {
        let map = {}
        const selectedIcon = "fas fa-check-circle";
        // Menu entries that carry artwork (an URL) instead of an icon get the
        // Netflix-style landing page layout, driven by that artwork.
        const artwork = typeof fa === "string" && fa && !fa.startsWith("fa");
        // Playable entries always get the landing page layout; when their logo is
        // not available the title takes the artwork's place (see art-failed).
        const hero = artwork || !!forceHero;
        const programmeTitle = (hero && programme && programme.title) ? String(programme.title).trim() : "";
        const opts = [{
            template: "question",
            text: question,
            fa,
            art: artwork ? fa : "",
            // avoid repeating the title when the channel name is already the programme
            subtitle: (programmeTitle && programmeTitle !== String(question).trim()) ? programmeTitle : "",
            hero
        }];
        opts.push(
            ...entries.map((e) => {
                e.template = "option";
                e.text = String(e.name);
                e.id = e.id || text2id(e.text);
                map[e.id] = e.text;
                if (def == e.id) {
                    if (!e.fa) {
                        e.fa = selectedIcon;
                    }
                } else if (e.fa == selectedIcon) {
                    e.fa = ''
                }
                return e;
            })
        );
        if (hero && hasAffiliates) {
            // regional stations retransmitting this channel, opened as a menu page
            opts.push({
                template: "option",
                text: (main.lang && main.lang.AFFILIATES) || "Affiliates",
                id: "__affiliates",
                fa: "fas fa-satellite-dish"
            })
        }
        if (hero) {
            // "Watch now" (or any play action) is always the primary button, like Netflix's Play.
            const options = opts.filter(o => o.template === "option");
            const primary = options.find(o => /fa-play/i.test(o.fa || "")) || options[0];
            if (primary) {
                primary.primary = true;
            }
        }
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
            isPin: atts.isPin,
            maxLength: atts.maxLength,
            inputMode: atts.inputMode,
            placeholder: atts.placeholder,
        });
        
        // Check if extraOpts already contains a 'submit' button
        const hasSubmitButton = atts.extraOpts?.some(opt => opt.id === "submit");
        
        // Only add default OK button if not already present in extraOpts
        if (!hasSubmitButton) {
            opts.push({
                template: "option",
                text: "OK",
                id: "submit",
                fa: "fas fa-check-circle",
            });
        }
        
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

    // Dedicated numeric PIN dialog: masked dots + on-screen keypad, no text field and
    // no confirm button - the fourth digit submits by itself.
    export function pin(atts) {
        const opts = [{
            template: "question",
            text: atts.question,
            fa: atts.fa || "fas fa-key"
        }];
        if (atts.message) {
            opts.push({ template: "message", text: atts.message });
        }
        opts.push({
            template: "pin",
            id: "pin",
            length: atts.length || 4
        });
        dialog(
            opts,
            atts.callback,
            null,
            false
        );
    }

    export function slider(question, message, range, value, mask, callback, fa, extraOpts = []) {
        let opts = [{ template: "question", text: question, fa }];
        if (message && message !== question) {
            opts.push({ template: "message", text: message });
        }
        opts.push({ template: "slider", id: "slider", range, value, mask, step: range?.step });
        opts.push({
            template: "option",
            text: "OK",
            id: "submit",
            fa: "fas fa-check-circle",
        });
        if (Array.isArray(extraOpts) && extraOpts.length) {
            opts.push(...extraOpts);
        }
        maskedValue = mask ? main.menu.maskValue(String(value ?? ''), mask) : String(value ?? '');
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

    function handleOptionClick(id, event) {
        // CRITICAL: Stop event propagation to prevent overlay click handler from firing
        if (event) {
            event.stopPropagation();
            event.stopImmediatePropagation();
        }
        if (currentCallback) {
            if (id === 'submit') {
                if (pinEntry()) {
                    id = pinValue;
                } else {
                    const input = container?.querySelector("input, textarea");
                    if (input) id = input.value;
                }
            }
            currentCallback(id);
            currentCallback = null;
        }
    }

    function pinEntry() {
        return (content.entries || []).find(e => e.template === "pin");
    }

    function pinLength() {
        const entry = pinEntry();
        return (entry && entry.length) || 4;
    }

    function pinPress(key) {
        if (!pinEntry()) return;
        if (key === "backspace") {
            pinValue = pinValue.slice(0, -1);
            return;
        }
        if (!/^\d$/.test(String(key)) || pinValue.length >= pinLength()) return;
        pinValue += key;
        if (pinValue.length === pinLength()) {
            // let the last dot paint before the dialog closes
            setTimeout(submitPin, 100);
        }
    }

    function submitPin() {
        if (!visible || !pinEntry() || pinValue.length !== pinLength()) return;
        handleOptionClick("submit");
    }

    function handlePinKeydown(e) {
        // Physical keyboards type straight into the PIN; digits are consumed here so
        // they don't reach the menu hotkeys (channel zapping) behind the dialog.
        if (!visible || !pinEntry()) return;
        if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
        const isDigit = /^[0-9]$/.test(e.key);
        const isBackspace = e.key === "Backspace" || e.key === "Delete";
        const isEnter = e.key === "Enter" || e.key === "NumpadEnter";
        if (!isDigit && !isBackspace && !isEnter) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (isDigit) {
            pinPress(e.key);
        } else if (isBackspace) {
            pinPress("backspace");
        } else {
            submitPin();
        }
    }

    function handleInputChange(event) {
        if (event.target.dataset.pin === "true") {
            const pin = event.target.value.replace(/\D/g, "").slice(0, 4);
            if (event.target.value !== pin) {
                event.target.value = pin;
            }
            content.value = pin;
            if (pin.length === 4) {
                handleOptionClick("submit");
            }
            return;
        }
        content.value = event.target.value;
        const mask = event.target.getAttribute('data-mask');
        maskedValue = mask ? main.menu.maskValue(content.value, mask) : event.target.value;
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
        main.on("dialog", (entries, callbackId, defaultIndex, mandatoryParam, dialogId) => {
            dialog(entries, callbackId, defaultIndex, mandatoryParam, dialogId)
        });
        main.on("dialog-close", (targetDialogId) => {
            // A programmatic close must always clear the queue, even when another (mandatory)
            // dialog is on screen. Otherwise the queued dialog is shown later by nextDialog()
            // and nobody is left to close it.
            if (targetDialogId) {
                removeQueuedDialogs(targetDialogId);
                if (currentDialogId === targetDialogId) {
                    end(false, targetDialogId, true);
                }
                return;
            }
            end(false, targetDialogId);
        });
        main.on("prompt", prompt);
        main.on("pin", pin);
        document.addEventListener("keydown", handlePinKeydown, true);
    });

    onDestroy(() => {
        document.removeEventListener("keydown", handlePinKeydown, true);
    });

    $effect(() => {
        if (visible && container) {
            let defaultElement = null;
            try {
                const selector = `#dialog-template-option-${text2id(String(content.defaultIndex))}`;
                defaultElement = container?.querySelector(selector);
            } catch (e) {
                console.warn('Dialog: invalid selector for defaultIndex', content.defaultIndex, e);
            }
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
            onmousedown={(e) => {
                // CRITICAL: Prevent closing mandatory dialogs on background click
                // Click can occur on .dialog-overlay or .dialog-content, but NOT on .dialog-wrap
                const target = e.target;
                const overlay = e.currentTarget; // This is the .dialog-overlay element
                const dialogWrap = container?.querySelector('.dialog-wrap');
                
                // Click is outside dialog-wrap if target is inside overlay but NOT inside dialog-wrap
                // This includes clicks on .dialog-overlay itself and .dialog-content (but not .dialog-wrap)
                const isOutsideDialogWrap = overlay.contains(target) && (!dialogWrap || !dialogWrap.contains(target));
                
                if (isOutsideDialogWrap) {
                    if (!mandatory) {
                        // Non-mandatory: allow closing
                        end(true);
                    } else {
                        // Mandatory: block all mouse events
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        return false;
                    }
                }
            }}
            onmouseup={(e) => {
                // CRITICAL: Also block mouseup events for mandatory dialogs on overlay
                const target = e.target;
                const overlay = e.currentTarget;
                const dialogWrap = container?.querySelector('.dialog-wrap');
                const isOutsideDialogWrap = overlay.contains(target) && (!dialogWrap || !dialogWrap.contains(target));
                
                if (mandatory && isOutsideDialogWrap) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    return false;
                }
            }}
            onclick={(e) => {
                // CRITICAL: Handle click events for both mandatory and non-mandatory dialogs
                const target = e.target;
                const overlay = e.currentTarget;
                const dialogWrap = container?.querySelector('.dialog-wrap');
                const isOutsideDialogWrap = overlay.contains(target) && (!dialogWrap || !dialogWrap.contains(target));
                
                if (isOutsideDialogWrap) {
                    if (!mandatory) {
                        // Non-mandatory: allow closing (fallback in case mousedown didn't work)
                        end(true);
                    } else {
                        // Mandatory: block all mouse events
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        return false;
                    }
                }
            }}
            onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    const target = e.target;
                    const overlay = e.currentTarget;
                    const dialogWrap = container?.querySelector('.dialog-wrap');
                    // Only dismiss the dialog when the key event truly comes from
                    // outside the dialog content. When the focus is inside (e.g. the
                    // text input or an option button), let the control handle it
                    // (submit) instead of bubbling up here and cancelling with an
                    // empty result.
                    const isOutsideDialogWrap = overlay.contains(target) && (!dialogWrap || !dialogWrap.contains(target));
                    if (isOutsideDialogWrap) {
                        if (!mandatory) {
                            end(true);
                        }
                        e.preventDefault();
                        e.stopPropagation();
                        if (mandatory) return false;
                    }
                }
            }}
        >
            <div 
                class="dialog-content"
                role="button"
                tabindex="-1"
                onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        const target = e.target;
                        const dialogContent = e.currentTarget;
                        const dialogWrap = container?.querySelector('.dialog-wrap');
                        const isOutsideDialogWrap = dialogContent.contains(target) && (!dialogWrap || !dialogWrap.contains(target));
                        if (isOutsideDialogWrap) {
                            if (!mandatory) {
                                end(true);
                            }
                            e.preventDefault();
                            e.stopPropagation();
                            return false;
                        }
                    }
                }}
                onmousedown={(e) => {
                    // CRITICAL: Handle clicks on .dialog-content (but not on .dialog-wrap)
                    const target = e.target;
                    const dialogContent = e.currentTarget;
                    const dialogWrap = container?.querySelector('.dialog-wrap');
                    
                    // Click is outside dialog-wrap if target is inside dialog-content but NOT inside dialog-wrap
                    const isOutsideDialogWrap = dialogContent.contains(target) && (!dialogWrap || !dialogWrap.contains(target));
                    
                    if (isOutsideDialogWrap) {
                        if (!mandatory) {
                            // Non-mandatory: allow closing
                            end(true);
                        } else {
                            // Mandatory: block all mouse events
                            e.preventDefault();
                            e.stopPropagation();
                            e.stopImmediatePropagation();
                            return false;
                        }
                    }
                }}
                onclick={(e) => {
                    // CRITICAL: Handle clicks on .dialog-content (but not on .dialog-wrap)
                    const target = e.target;
                    const dialogContent = e.currentTarget;
                    const dialogWrap = container?.querySelector('.dialog-wrap');
                    
                    // Click is outside dialog-wrap if target is inside dialog-content but NOT inside dialog-wrap
                    const isOutsideDialogWrap = dialogContent.contains(target) && (!dialogWrap || !dialogWrap.contains(target));
                    
                    if (isOutsideDialogWrap) {
                        if (!mandatory) {
                            // Non-mandatory: allow closing (fallback)
                            end(true);
                        } else {
                            // Mandatory: block all mouse events
                            e.preventDefault();
                            e.stopPropagation();
                            e.stopImmediatePropagation();
                            return false;
                        }
                    }
                }}
            >
                <div class="dialog-wrap {content.entries && content.entries.some(e => e.hero) ? 'dialog-hero' : ''} {content.entries && content.entries.some(e => e.premium) ? 'dialog-premium' : ''}">
                    <div
                        tabindex="-1"
                        role="button"
                        onmousedown={(e) => e.stopPropagation()}
                        onclick={(e) => e.stopPropagation()}
                    >
                        <div class="dialog-template-entries">
                            {#each content.entries as entry}
                                {#if entry.template === "question"}
                                    {#if entry.hero}
                                        <span class="dialog-template-question dialog-hero-question">
                                            {#if entry.art}
                                                <span
                                                    class="dialog-hero-art"
                                                    style="background-image: url({JSON.stringify(entry.art)})"
                                                    aria-hidden="true"
                                                ></span>
                                            {/if}
                                            <span class="dialog-hero-scrim" aria-hidden="true"></span>
                                            <span class="dialog-hero-body {entry.art ? '' : 'art-failed'}">
                                                {#if entry.art}
                                                    <img
                                                        class="dialog-hero-logo"
                                                        src={entry.art}
                                                        alt={plainText(entry.text)}
                                                        onerror={(e) => e.currentTarget.parentElement?.classList.add('art-failed')}
                                                    />
                                                {/if}
                                                <span class="dialog-hero-titles">
                                                    <span class="dialog-hero-title">{@html entry.text}</span>
                                                    {#if entry.subtitle}
                                                        <span class="dialog-hero-subtitle">
                                                            <span class="dialog-hero-live">{main.lang?.LIVE || "Live"}</span>
                                                            <span class="dialog-hero-programme">{entry.subtitle}</span>
                                                        </span>
                                                    {/if}
                                                </span>
                                            </span>
                                        </span>
                                    {:else if entry.premium}
                                        <span class="dialog-template-question dialog-premium-question">
                                            {#if entry.fa}
                                                <span class="dialog-premium-crest" aria-hidden="true">
                                                    {#if entry.fa.startsWith("fa")}
                                                        <i class={entry.fa}></i>
                                                    {:else}
                                                        <img src={entry.fa} alt={entry.text} />
                                                    {/if}
                                                </span>
                                            {/if}
                                            <span class="dialog-premium-titles">
                                                <span class="dialog-premium-title">{@html entry.text}</span>
                                                {#if entry.badge}
                                                    <span class="dialog-premium-badge">{@html entry.badge}</span>
                                                {/if}
                                            </span>
                                            <span style="position: absolute; right: var(--padding-2x);">{maskedValue}</span>
                                        </span>
                                    {:else}
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
                                    {/if}
                                {:else if entry.template === "message"}
                                    <span class="dialog-template-message">{@html entry.text}</span>
                                {:else if entry.template === "text"}
                                    <span class="dialog-template-text">
                                        <input
                                            type={entry.isPassword ? "password" : "text"}
                                            inputmode={entry.inputMode || (entry.isPin ? "numeric" : undefined)}
                                            pattern={entry.isPin ? "[0-9]*" : undefined}
                                            maxlength={entry.maxLength}
                                            data-pin={entry.isPin ? "true" : undefined}
                                            onfocus={(e) => maybePasteClipboard(e.target)}
                                            placeholder={entry.placeholder} 
                                            data-mask={entry.mask||''} 
                                            value={entry.value} 
                                            onchange={handleInputChange}
                                            oninput={handleInputChange}
                                            onkeydown={(e) => {
                                                // Enter inside a text prompt must SUBMIT
                                                // (default option) with the typed value,
                                                // not bubble to the overlay and cancel.
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    if (!entry.isPin) {
                                                        const defId = text2id(String(content.defaultIndex || 'submit'));
                                                        container?.querySelector(`#dialog-template-option-${defId}`)?.click();
                                                    }
                                                }
                                            }}
                                            aria-label={entry.plainText || plainText(entry.text)}
                                        />
                                    </span>
                                {:else if entry.template === "pin"}
                                    <div class="dialog-template-pin" role="group" aria-label={entry.plainText || plainText(entry.text || "PIN")}>
                                        <div class="dialog-pin-dots" aria-hidden="true">
                                            {#each Array(pinLength()).fill(0) as _, i}
                                                <span class="dialog-pin-dot {i < pinValue.length ? 'filled' : ''}"></span>
                                            {/each}
                                        </div>
                                        <div class="dialog-pin-keys">
                                            {#each ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as digit}
                                                <button
                                                    type="button"
                                                    class="dialog-pin-key"
                                                    aria-label={digit}
                                                    onclick={() => pinPress(digit)}
                                                    onmouseenter={(event) => focusElement(event.target)}
                                                >
                                                    {digit}
                                                </button>
                                            {/each}
                                            <span class="dialog-pin-key-spacer" aria-hidden="true"></span>
                                            <button
                                                type="button"
                                                class="dialog-pin-key"
                                                aria-label="0"
                                                onclick={() => pinPress("0")}
                                                onmouseenter={(event) => focusElement(event.target)}
                                            >
                                                0
                                            </button>
                                            <button
                                                type="button"
                                                class="dialog-pin-key dialog-pin-key-backspace"
                                                aria-label="Backspace"
                                                onclick={() => pinPress("backspace")}
                                                onmouseenter={(event) => focusElement(event.target)}
                                            >
                                                <i class="fas fa-backspace"></i>
                                            </button>
                                        </div>
                                    </div>
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
                                            step={entry.range?.step || entry.step || 1}
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
                        {#if content.opts.length}
                            <div class="dialog-template-options {content.opts.length == 2 || content.opts.length > 3 ? 'two-columns' : ''} {content.entries && content.entries.findLastIndex(e => e.template.startsWith('text')) == (content.entries.length - 1) ? 'sharp-top' : ''}">
                                {#each content.opts as option}
                                    {#if option.template === "option" || option.template === "option-detailed"}
                                        <button
                                            id="dialog-template-option-{text2id(option.id)}"
                                            title={option.text}
                                            aria-label={option.text}
                                            onclick={(e) => handleOptionClick(option.id, e)}
                                            class={(option.template === "option-detailed"
                                                ? "dialog-template-option-detailed"
                                                : "dialog-template-option") + (option.primary ? " primary" : "")}
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
                        {/if}
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
    /* ------------------------------------------------------------------
       Netflix-like restyle of dialogs (visual layer only).
       The theme module injects !important rules, so matching specificity
       is needed here.
    ------------------------------------------------------------------ */
    div#dialog .dialog-overlay {
        background: rgba(6, 6, 9, 0.72) !important;
        -webkit-backdrop-filter: blur(6px) saturate(0.9);
        backdrop-filter: blur(6px) saturate(0.9);
    }
    div#dialog .dialog-wrap {
        background: linear-gradient(180deg, #1a1a1f 0%, #0d0d11 100%) !important;
        border: 1px solid var(--nf-line);
        border-radius: calc(var(--nf-radius) * 1.5);
        box-shadow: 0 2vmax 6vmax rgba(0, 0, 0, 0.65);
    }
    div#dialog .dialog-template-message,
    div#dialog .dialog-template-question {
        color: var(--nf-text);
        text-shadow: none;
    }
    div#dialog .dialog-template-option,
    div#dialog .dialog-template-option-detailed {
        background: rgba(255, 255, 255, 0.04) !important;
        border: 1px solid transparent;
        border-radius: var(--nf-radius);
        color: var(--nf-text) !important;
        margin: 2px 0;
        text-shadow: none;
        transition: background 0.15s ease-out 0s, border-color 0.15s ease-out 0s;
    }
    div#dialog .dialog-template-option.selected,
    div#dialog .dialog-template-option-detailed.selected {
        background: linear-gradient(90deg, rgba(139, 92, 246, 0.55) 0%, rgba(139, 92, 246, 0.1) 100%) !important;
        border: 1px solid rgba(167, 139, 250, 0.75);
        box-shadow: inset 0 0 0 2px #ffffff, 0 0 2.4vmin rgba(139, 92, 246, 0.35);
        color: #ffffff !important;
    }
    div#dialog .dialog-template-option-detailed.selected .dialog-template-option-detailed-name {
        text-shadow: none;
    }
    div#dialog .dialog-template-option-detailed-details {
        color: var(--nf-text-dim);
        opacity: 1;
    }
    div#dialog .dialog-template-text,
    div#dialog .dialog-template-textarea {
        background: rgba(255, 255, 255, 0.06) !important;
        border: 1px solid var(--nf-line);
        border-radius: var(--nf-radius);
        color: var(--nf-text);
    }
    div#dialog .dialog-template-text.selected-parent,
    div#dialog .dialog-template-textarea.selected-parent {
        border-color: var(--nf-accent);
        box-shadow: 0 0 0 2px var(--nf-accent-soft);
    }
    div#dialog .dialog-template-text i,
    div#dialog .dialog-template-textarea i,
    div#dialog .dialog-template-text input,
    div#dialog .dialog-template-textarea textarea {
        color: var(--nf-text) !important;
        opacity: 1;
    }
    /* ------------------------------------------------------------------
       Dedicated PIN entry: masked dots plus a touch-friendly keypad, so a
       four digit PIN needs neither a text field nor a confirm button.
    ------------------------------------------------------------------ */
    div#dialog .dialog-template-pin {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
        box-sizing: border-box;
        padding: 0.5vmax 0;
    }
    div#dialog .dialog-pin-dots {
        display: flex;
        justify-content: center;
        gap: clamp(10px, 2.6vmin, 24px);
        padding: 1.5vmin 0 2.5vmin;
    }
    div#dialog .dialog-pin-dot {
        width: clamp(16px, 3vmin, 26px);
        height: clamp(16px, 3vmin, 26px);
        border-radius: 50%;
        border: 2px solid var(--nf-line, rgba(255, 255, 255, 0.35));
        background: transparent;
        transition: background 0.15s ease-out 0s, border-color 0.15s ease-out 0s, transform 0.15s ease-out 0s;
    }
    div#dialog .dialog-pin-dot.filled {
        background: var(--nf-text, #fff);
        border-color: var(--nf-text, #fff);
        transform: scale(1.06);
    }
    div#dialog .dialog-pin-keys {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: clamp(8px, 1.4vmin, 16px);
        /* fills the dialog on phones and stays a compact keypad on TV/desktop */
        width: min(100%, 420px);
    }
    div#dialog .dialog-pin-key {
        display: flex;
        align-items: center;
        justify-content: center;
        /* touch targets never shrink below 46px, even on small phones */
        min-height: clamp(46px, 8.5vmin, 76px);
        padding: 0;
        border-radius: calc(var(--nf-radius) * 1.4);
        border: 1px solid var(--nf-line, rgba(255, 255, 255, 0.14));
        background: rgba(255, 255, 255, 0.06);
        color: var(--nf-text, #fff);
        font-family: inherit;
        font-size: calc(var(--menu-entry-name-font-size) * 1.15);
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease-out 0s, border-color 0.15s ease-out 0s, transform 0.12s ease-out 0s;
    }
    div#dialog .dialog-pin-key:hover {
        background: rgba(255, 255, 255, 0.12);
    }
    div#dialog .dialog-pin-key.selected,
    div#dialog .dialog-pin-key:focus {
        outline: none;
        background: linear-gradient(135deg, #c4b5fd 0%, #7c3aed 100%);
        border-color: rgba(196, 181, 253, 0.95);
        box-shadow: inset 0 0 0 2px #ffffff;
        transform: scale(1.04);
    }
    div#dialog .dialog-pin-key-spacer {
        visibility: hidden;
    }
    div#dialog .dialog-pin-key-backspace {
        font-size: calc(var(--menu-entry-name-font-size) * 1.05);
    }
    /* ------------------------------------------------------------------
       Netflix-style landing page ("watch now" and other artwork entries).
       The card becomes a full-bleed artwork header + a row of round
       action buttons, keeping SpatialNavigation focus semantics intact.
    ------------------------------------------------------------------ */
    div#dialog .dialog-wrap.dialog-hero {
        padding: 0 !important;
        overflow: hidden;
        max-width: 96%;
        /* keep the hero card at a predictable size (the global dialog inflate would scale it) */
        transform: none !important;
        border-radius: calc(var(--nf-radius) * 2);
        box-shadow: 0 3vmax 9vmax rgba(0, 0, 0, 0.75) !important;
    }
    /* Compact, centered modal for everything that is not an artwork landing page. */
    div#dialog .dialog-wrap:not(.dialog-hero) > div {
        width: min(820px, 86vw) !important;
    }
    div#dialog .dialog-wrap:not(.dialog-hero) .dialog-template-question {
        font-size: calc(var(--menu-entry-name-font-size) * 1.3);
        font-weight: 700;
        letter-spacing: -0.01em;
        line-height: 125%;
        padding-bottom: 1.2vmax;
    }
    div#dialog .dialog-wrap:not(.dialog-hero) .dialog-template-message {
        justify-content: flex-start;
        text-align: left;
        line-height: 165%;
        color: var(--nf-text-dim);
    }
    div#dialog .dialog-wrap.dialog-hero > div {
        width: min(1180px, 84vw) !important;
        max-height: 84vh;
        overflow: hidden;
    }
    div#dialog .dialog-wrap.dialog-hero .dialog-template-entries {
        overflow: hidden;
        min-height: 0;
    }
    div#dialog .dialog-wrap.dialog-hero .dialog-hero-question {
        position: relative;
        display: block;
        width: 100%;
        max-width: none;
        min-height: 0;
        height: 33vh;
        padding: 0;
        overflow: hidden;
        /* Same 28px fade as the home billboard, so the artwork melts into the
           buttons row below instead of being clipped on a hard edge. */
        -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent 100%);
        mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent 100%);
    }
    div#dialog .dialog-hero-art {
        position: absolute;
        top: -12%;
        left: -12%;
        width: 124%;
        height: 124%;
        background-size: cover;
        background-position: center;
        background-repeat: no-repeat;
        filter: blur(1.75vmax) saturate(1.2) brightness(0.42);
        opacity: 0.8;
    }
    div#dialog .dialog-hero-scrim {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background:
            radial-gradient(95% 120% at 4% 120%, rgba(139, 92, 246, 0.34) 0%, rgba(139, 92, 246, 0) 58%),
            radial-gradient(70% 95% at 94% 6%, rgba(139, 92, 246, 0.18) 0%, rgba(139, 92, 246, 0) 68%),
            linear-gradient(180deg, rgba(13, 13, 17, 0.5) 0%, rgba(13, 13, 17, 0.12) 34%, rgba(13, 13, 17, 0.86) 78%, #0d0d11 100%),
            linear-gradient(90deg, rgba(13, 13, 17, 0.9) 0%, rgba(13, 13, 17, 0.05) 68%);
    }
    div#dialog .dialog-hero-body {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: flex-start;
        gap: 2.2vmax;
        padding: 2.6vmax 3vmax 2.2vmax;
        box-sizing: border-box;
    }
    div#dialog .dialog-hero-logo {
        display: block;
        flex: 0 0 auto;
        height: 7vmax;
        max-height: 10vmax;
        width: auto;
        max-width: 38%;
        object-fit: contain;
        object-position: left center;
        filter: drop-shadow(0 1vmin 2.4vmin rgba(0, 0, 0, 0.8));
    }
    div#dialog .dialog-hero-titles {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        flex: 1 1 auto;
        width: 100%;
        min-width: 0;
    }
    div#dialog .dialog-hero-title {
        display: block;
        max-width: 100%;
        font-size: 2.4vmax;
        font-weight: 700;
        letter-spacing: -0.02em;
        line-height: 1.05;
        color: #ffffff;
        text-align: left;
        text-shadow: 0 1vmin 3vmin rgba(0, 0, 0, 0.85);
        word-break: break-word;
    }
    div#dialog .dialog-hero-subtitle {
        display: flex;
        align-items: center;
        gap: 0.9vmin;
        margin-top: 0.8vmax;
        max-width: 100%;
        min-width: 0;
        color: var(--nf-text-dim);
        font-size: 1.9vmax;
        font-weight: 500;
        line-height: 1.25;
        text-align: left;
        text-shadow: 0 0.6vmin 2vmin rgba(0, 0, 0, 0.85);
    }
    div#dialog .dialog-hero-programme {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    div#dialog .dialog-hero-live {
        flex: 0 0 auto;
        background: linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%);
        color: #ffffff;
        font-size: 0.78em;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding: 0.35em 0.8em;
        border-radius: 999px;
        text-shadow: none;
    }
    div#dialog .dialog-hero-body.art-failed .dialog-hero-logo {
        display: none;
    }
    div#dialog .dialog-hero-body.art-failed .dialog-hero-title {
        font-size: 4.6vmax;
        font-weight: 800;
    }
    div#dialog .dialog-wrap.dialog-hero .dialog-template-options {
        flex-direction: row !important;
        flex-wrap: wrap;
        align-items: center;
        gap: 1.4vmin;
        padding: 0 3vmax 2.2vmax;
        background: #0d0d11;
        border-radius: 0;
        max-height: none;
        overflow: visible;
    }
    div#dialog .dialog-wrap.dialog-hero .dialog-template-option,
    div#dialog .dialog-wrap.dialog-hero .dialog-template-option-detailed {
        width: auto !important;
        max-width: none;
        min-height: 0;
        flex: 0 0 auto;
        justify-content: center;
        margin: 0 !important;
        padding: 0 2vmax !important;
        color: #ffffff !important;
        font-weight: 600;
        box-shadow: none;
        background: transparent;
        border-width: 0;
    }
    div#dialog .dialog-wrap.dialog-hero #dialog-template-option-moreoptions {
        background: transparent !important;
    }
    div#dialog .dialog-wrap.dialog-hero .dialog-template-option:not(#dialog-template-option-moreoptions),
    div#dialog .dialog-wrap.dialog-hero .dialog-template-option-detailed {
        background: rgba(109, 109, 110, 0.7) !important;
        border: 1px solid rgba(255, 255, 255, 0.14) !important;
        border-radius: 999px !important;
    }
    div#dialog .dialog-wrap.dialog-hero .dialog-template-option > div,
    div#dialog .dialog-wrap.dialog-hero .dialog-template-option-detailed > div {
        padding: 1.15vmin 0 !important;
    }
    div#dialog .dialog-wrap.dialog-hero .dialog-template-option i,
    div#dialog .dialog-wrap.dialog-hero .dialog-template-option-detailed i {
        padding-right: 1vmin;
    }
    div#dialog .dialog-wrap.dialog-hero .dialog-template-option.primary {
        background: linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%) !important;
        border-color: rgba(196, 181, 253, 0.9) !important;
        color: #ffffff !important;
        box-shadow: 0 1vmin 2.6vmin rgba(124, 58, 237, 0.35);
    }
    div#dialog .dialog-wrap.dialog-hero .dialog-template-option.primary i {
        color: #ffffff !important;
    }
    /* The pill rules above are more specific than the generic .selected rule,
       so the focused option needs its own hero-scoped highlight. */
    div#dialog .dialog-wrap.dialog-hero .dialog-template-option.selected:not(#dialog-template-option-moreoptions),
    div#dialog .dialog-wrap.dialog-hero .dialog-template-option-detailed.selected,
    div#dialog .dialog-wrap.dialog-hero #dialog-template-option-moreoptions.selected {
        background: linear-gradient(135deg, #c4b5fd 0%, #7c3aed 100%) !important;
        border: 1px solid rgba(196, 181, 253, 0.95) !important;
        border-radius: 999px !important;
        box-shadow: inset 0 0 0 2px #ffffff, 0 1vmin 2.6vmin rgba(124, 58, 237, 0.5) !important;
        color: #ffffff !important;
        transform: scale(1.05);
    }
    div#dialog .dialog-wrap.dialog-hero .dialog-template-option.selected i,
    div#dialog .dialog-wrap.dialog-hero .dialog-template-option-detailed.selected i {
        color: #ffffff !important;
    }
    body.portrait div#dialog .dialog-wrap.dialog-hero > div {
        width: 92vw !important;
    }
    body.portrait div#dialog .dialog-wrap.dialog-hero .dialog-hero-question {
        height: 24vh;
    }
    body.portrait div#dialog .dialog-hero-logo {
        height: 6vmax;
        max-height: 9vmax;
        max-width: 34%;
    }
    body.portrait div#dialog .dialog-wrap.dialog-hero .dialog-hero-body {
        gap: 2vmax;
        padding: var(--padding) calc(var(--padding) * 1.5);
    }
    body.portrait div#dialog .dialog-hero-title {
        font-size: 4.4vmax;
    }
    body.portrait div#dialog .dialog-wrap.dialog-hero .dialog-template-options {
        padding: 0 calc(var(--padding) * 1.5) calc(var(--padding) * 1.5);
    }
    /* ------------------------------------------------------------------
       Premium offer card: purple crest, price chip and a highlighted
       primary action, reusing the same accent palette as the hero card.
    ------------------------------------------------------------------ */
    div#dialog .dialog-wrap.dialog-premium {
        position: relative;
        overflow: hidden;
        border-color: rgba(167, 139, 250, 0.45) !important;
        box-shadow: 0 0 0 1px rgba(167, 139, 250, 0.16), 0 2vmax 6vmax rgba(0, 0, 0, 0.7) !important;
    }
    div#dialog .dialog-wrap.dialog-premium::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 46%;
        pointer-events: none;
        background:
            radial-gradient(70% 130% at 10% 0%, rgba(139, 92, 246, 0.36) 0%, rgba(139, 92, 246, 0) 72%),
            radial-gradient(60% 120% at 92% 0%, rgba(245, 196, 81, 0.14) 0%, rgba(245, 196, 81, 0) 74%);
    }
    div#dialog .dialog-premium-question {
        position: relative;
        display: flex;
        align-items: center;
        gap: 1.8vmax;
        padding: 0 0 1.5vmax 0;
        text-align: left;
        font-weight: normal;
    }
    div#dialog .dialog-premium-crest {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 7vmax;
        height: 7vmax;
        border-radius: 50%;
        color: #ffffff;
        font-size: 2.9vmax;
        background: linear-gradient(140deg, #a78bfa 0%, #7c3aed 62%, #4c1d95 100%);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3), 0 1vmin 2.6vmin rgba(124, 58, 237, 0.45);
    }
    div#dialog .dialog-premium-crest i {
        margin: 0;
        color: #ffffff !important;
    }
    div#dialog .dialog-premium-crest img {
        height: 58%;
        width: auto;
        max-width: 58%;
        margin: 0;
        object-fit: contain;
    }
    div#dialog .dialog-premium-titles {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.7vmax;
        min-width: 0;
    }
    div#dialog .dialog-wrap:not(.dialog-hero) .dialog-premium-title {
        font-size: calc(var(--menu-entry-name-font-size) * 1.22);
        font-weight: 800;
        line-height: 1.2;
        letter-spacing: -0.01em;
        color: #ffffff;
        padding: 0;
    }
    div#dialog .dialog-premium-badge {
        align-self: flex-start;
        padding: 0.26em 0.92em;
        border-radius: 999px;
        color: #1a1206;
        font-size: var(--menu-entry-details-font-size);
        font-weight: 800;
        letter-spacing: 0.01em;
        background: linear-gradient(135deg, #fde68a 0%, #f5c451 100%);
        box-shadow: 0 0.6vmin 1.6vmin rgba(245, 196, 81, 0.28);
    }
    div#dialog .dialog-wrap.dialog-premium .dialog-template-message {
        position: relative;
        padding-top: 0;
        line-height: 170%;
        color: var(--nf-text-dim);
    }
    /* Premium's buy action stays visually primary outside the artwork hero. */
    div#dialog .dialog-wrap.dialog-premium:not(.dialog-hero) .dialog-template-option.primary {
        background: linear-gradient(135deg, rgba(167, 139, 250, 0.95) 0%, rgba(124, 58, 237, 0.95) 100%) !important;
        border-color: rgba(196, 181, 253, 0.85) !important;
        color: #ffffff !important;
        box-shadow: 0 1vmin 2.6vmin rgba(124, 58, 237, 0.3);
    }
    div#dialog .dialog-wrap.dialog-premium:not(.dialog-hero) .dialog-template-option.primary i {
        color: #ffffff !important;
    }
    div#dialog .dialog-wrap.dialog-premium:not(.dialog-hero) .dialog-template-option.primary .dialog-template-option-detailed-details {
        color: #ffffff !important;
        opacity: 0.85;
    }
    div#dialog .dialog-wrap.dialog-premium:not(.dialog-hero) .dialog-template-option.primary.selected {
        border-color: #ffffff !important;
        box-shadow: inset 0 0 0 2px #ffffff, 0 0 2.4vmin rgba(139, 92, 246, 0.45);
    }
    body.portrait div#dialog .dialog-premium-crest {
        width: 11vmax;
        height: 11vmax;
        font-size: 4.6vmax;
    }
    body.portrait div#dialog .dialog-wrap:not(.dialog-hero) .dialog-premium-title {
        font-size: calc(var(--menu-entry-name-font-size) * 1.1);
    }
</style>

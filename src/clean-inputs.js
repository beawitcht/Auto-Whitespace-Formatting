
(function () {
    const defaults = { mode: "all", allowList: [], denyList: [], collapseNewlines: false, applyOnPaste: true };
    let currentSettings = { ...defaults };
    let _initialized = false;

    // Load settings, then initialize
    chrome.storage.sync.get(defaults, (items) => {
        currentSettings = items;
        console.debug('clean-inputs: initial settings', currentSettings);
        if (!shouldRunOnThisHost(currentSettings, location.hostname)) return;
        init();
    });

    // React to live changes
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "sync") return;
        let settingsChanged = false;
        for (const key of Object.keys(changes)) {
            currentSettings[key] = changes[key].newValue;
            settingsChanged = true;
        }
        if (!settingsChanged) return;
        console.debug('clean-inputs: storage.onChanged', changes, 'currentSettings', currentSettings);

        if (!_initialized && shouldRunOnThisHost(currentSettings, location.hostname)) {
            init();
        }
    });

    function shouldRunOnThisHost(settings, hostname) {
        const host = (hostname || "").toLowerCase();

        // Normalize lists
        const normalize = (v) => {
            if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean);
            if (typeof v === 'string') return v.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
            return [];
        };

        const allowList = normalize(settings.allowList);
        const denyList = normalize(settings.denyList);

        // Match full page URL against user-provided patterns supporting '*' wildcards
        const regexCache = new Map();
        const escapeForRegex = (s) => s.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
        const patternToRegex = (pat) => {
            if (regexCache.has(pat)) return regexCache.get(pat);
            const parts = String(pat).split('*').map(escapeForRegex);
            // Match anywhere in the full URL
            const re = new RegExp(parts.join('.*'), 'i');
            regexCache.set(pat, re);
            return re;
        };

        const matchesAny = (list) => {
            const target = location.href || (location.protocol + '//' + location.hostname + location.pathname + location.search + location.hash);
            for (const p of list) {
                if (!p) continue;
                const re = patternToRegex(p);
                if (re.test(target)) return true;
            }
            return false;
        };

        switch (settings.mode) {
            case "allow":
                return allowList.length > 0 && matchesAny(allowList);
            case "deny":
                return !matchesAny(denyList);
            case "all":
            default:
                return true;
        }
    }

    function cleanValue(value) {
        if (typeof value !== "string") return value;
        let result = value.trim();
        if (currentSettings.collapseNewlines) {
            // Collapse sequences of blank (or whitespace-only) lines into a single newline
            const lines = result.split(/\r?\n/);
            const out = [];
            let lastBlank = false;
            const unicodeWS = (() => {
                try {
                    // If engine supports Unicode property escapes, use that
                    return new RegExp('\\p{White_Space}', 'gu');
                } catch (e) {
                    // Fallback class of whitespace characters
                    return /[\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u180E\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/g;
                }
            })();

            const isBlank = (ln) => ln.replace(unicodeWS, '') === '';

            for (const line of lines) {
                if (isBlank(line)) {
                    if (!lastBlank) {
                        out.push('');
                        lastBlank = true;
                    }
                } else {
                    out.push(line);
                    lastBlank = false;
                }
            }
            result = out.join('\n');
        }
        return result;
    }

    function attachTrimListener(el) {
        if (el._trimListenerAttached) return;
        el._trimListenerAttached = true;

        // On blur: format according to current settings and host rules
        el.addEventListener("blur", () => {
            // Use latest settings on each blur
            const runHere = shouldRunOnThisHost(currentSettings, location.hostname);
            console.debug('clean-inputs: blur on', el, { runHere, collapseNewlines: !!currentSettings.collapseNewlines, applyOnPaste: !!currentSettings.applyOnPaste });
            if (!runHere) return;
            console.debug('clean-inputs: TYPE', typeof el.value, el );
            if (typeof el.value === "string") {
                const before = el.value;
                const after = cleanValue(el.value);

                if (after !== before) {
                    console.debug('clean-inputs: changed value', { before, after });
                    document.execCommand("selectAll");
                    document.execCommand("insertText", false, after);
                    el.blur();
                    return;
                }
            }
        });

        // handle paste: clean the pasted text before inserting
        el.addEventListener('paste', (e) => {
            // use latest settings on each blur
            const runHere = shouldRunOnThisHost(currentSettings, location.hostname);
            console.debug('clean-inputs: paste enabled', el, { runHere, collapseNewlines: !!currentSettings.collapseNewlines, applyOnPaste: !!currentSettings.applyOnPaste });
            if (!runHere) return;
            console.debug('clean-inputs: paste event', { target: el, applyOnPaste: !!currentSettings.applyOnPaste });
            if (!currentSettings.applyOnPaste) return;
            const clipboard = (e.clipboardData || window.clipboardData);
            if (!clipboard) {
                console.debug('clean-inputs: no clipboard data');
                return;
            }
            const text = clipboard.getData('text');
            if (!text) return;
            e.preventDefault();

            const cleaned = cleanValue(text);
            console.debug('clean-inputs: paste cleaned', { before: text, after: cleaned });

            // For inputs/textareas, insert at selection
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
                const start = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
                const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : el.value.length;
                try { el.focus(); } catch (e) { /* ignore */ }
                const val = el.value || '';
                const newVal = val.slice(0, start) + cleaned + val.slice(end);
                //el.value = newVal;
                document.execCommand("insertText", false, newVal);
                return;
            }

        });
    }

    function init() {
        // Target common text-like inputs, textareas and contenteditable elements.
        const selector = "input[type='text'], input[type='search'], input[type='url'], input[type='tel'], input[type='email'], textarea, input:not([type]), [contenteditable='true']";

        // Initial pass
        document.querySelectorAll(selector).forEach(attachTrimListener);

        // Watch for dynamically added inputs
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                m.addedNodes.forEach((node) => {
                    if (!(node instanceof HTMLElement)) return;

                    if (node.matches?.(selector)) {
                        attachTrimListener(node);
                    }
                    node.querySelectorAll?.(selector).forEach(attachTrimListener);
                });
            }
        });

        if (document.documentElement) {
            observer.observe(document.documentElement, { childList: true, subtree: true });
        }
        _initialized = true;
    }
})();

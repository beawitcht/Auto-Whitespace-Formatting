
(() => {
  const defaults = { mode: "all", allowList: [], denyList: [], collapseNewlines: false, applyOnPaste: true };
  const statusEl = () => document.getElementById('status');
  let statusTimer = null;

  function setStatus(msg, timeout = 1500) {
    const el = statusEl();
    if (!el) return;
    el.textContent = msg;
    if (statusTimer) clearTimeout(statusTimer);
    if (timeout > 0) statusTimer = setTimeout(() => el.textContent = '', timeout);
  }

  function parseList(text) {
    return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }

  function loadAndPopulate() {
    chrome.storage.sync.get(defaults, (items) => {
      const mode = items.mode || defaults.mode;
      const allow = Array.isArray(items.allowList) ? items.allowList : [];
      const deny = Array.isArray(items.denyList) ? items.denyList : [];
      const collapse = !!items.collapseNewlines;
      const applyOnPaste = items.applyOnPaste !== false; // default true

      // Mode radios
      const radios = document.querySelectorAll('input[name="mode"]');
      radios.forEach(r => r.checked = (r.value === mode));

      // Textareas
      const allowTa = document.getElementById('allowList');
      const denyTa = document.getElementById('denyList');
      if (allowTa) allowTa.value = allow.join('\n');
      if (denyTa) denyTa.value = deny.join('\n');

      // Checkboxes
      const collapseCb = document.getElementById('collapseNewlines');
      if (collapseCb) collapseCb.checked = collapse;
      const pasteCb = document.getElementById('applyOnPaste');
      if (pasteCb) pasteCb.checked = applyOnPaste;

      setStatus('Loaded', 800);
    });
  }

  // Add URL / domain buttons
  function addToList(pattern) {
    // Determine which list to add to based on selected mode
    const selected = document.querySelector('input[name="mode"]:checked');
    const mode = selected ? selected.value : null;
    if (!mode || (mode !== 'allow' && mode !== 'deny')) {
      setStatus('Select "Allow" or "Deny" mode to add to a list', 2000);
      return;
    }

    const key = mode === 'allow' ? 'allowList' : 'denyList';

    // Get current list, append pattern if missing, save and update UI
    chrome.storage.sync.get(defaults, (items) => {
      const list = Array.isArray(items[key]) ? items[key].slice() : [];
      if (!list.includes(pattern)) {
        list.push(pattern);
        const saveObj = {};
        saveObj[key] = list;
        save(saveObj);
        const ta = document.getElementById(key === 'allowList' ? 'allowList' : 'denyList');
        if (ta) ta.value = list.join('\n');
      } else {
        setStatus('Already in list', 1000);
      }
    });
  }

  function save(changes, showStatus = true) {
    chrome.storage.sync.set(changes, () => {
      if (chrome.runtime.lastError) {
        setStatus('Save failed');
        return;
      }
      if (showStatus) setStatus('Saved');
    });
  }

  function wire() {
    // radios
    document.querySelectorAll('input[name="mode"]').forEach(r => {
      r.addEventListener('change', (e) => {
        if (e.target.checked) save({ mode: e.target.value });
      });
    });

    // saves while typing
    const taSave = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      let t = null;
      const doSave = () => {
        save({ [key]: parseList(el.value) });
      };
      el.addEventListener('input', () => {
        if (t) clearTimeout(t);
        t = setTimeout(doSave, 600);
      });
      el.addEventListener('blur', () => doSave());
    };

    taSave('allowList', 'allowList');
    taSave('denyList', 'denyList');

    // Checkbox
    const collapseCb = document.getElementById('collapseNewlines');
    if (collapseCb) collapseCb.addEventListener('change', (e) => {
      save({ collapseNewlines: !!e.target.checked });
    });

    const pasteCb = document.getElementById('applyOnPaste');
    if (pasteCb) pasteCb.addEventListener('change', (e) => {
      save({ applyOnPaste: !!e.target.checked });
    });

    const addUrlBtn = document.getElementById('addUrlBtn');
    const addDomainBtn = document.getElementById('addDomainBtn');
    const withTab = (cb) => {
      // Query active tab in current window
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const t = tabs && tabs[0];
          if (!t || !t.url) {
            setStatus('Cannot read active tab URL', 1500);
            return;
          }
          cb(t.url);
        });
      } catch (e) {
        setStatus('Error accessing tabs API', 1500);
      }
    };

    if (addUrlBtn) addUrlBtn.addEventListener('click', () => {
      withTab((url) => addToList(url));
    });
    if (addDomainBtn) addDomainBtn.addEventListener('click', () => {
      withTab((url) => {
        try {
          const u = new URL(url);
          // Add wildcard pattern for domain
          const pat = '*://' + u.hostname + '/*';
          addToList(pat);
        } catch (e) {
          // fallback: append raw hostname
          const host = url.replace(/https?:\/\//i, '').split(/[\/\?#]/)[0];
          addToList('*://' + host + '/*');
        }
      });
    });
  }

  // Init
  document.addEventListener('DOMContentLoaded', () => {
    loadAndPopulate();
    wire();
  });
})();

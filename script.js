;(() => {
  // ===== Buttons you want to show (labels as seen in header/dropdown) =====
  const BUTTONS = [
    { label: '5 Fast',          fallbacks: ['gpt-5-instant'] },
    { label: '5 Thinking',      fallbacks: ['gpt-5-thinking'] },
    { label: '5 Thinking mini', fallbacks: ['gpt-5-t-mini', 'gpt-5-thinking-mini', 'gpt-5-mini', 'gpt-5-thinking-fast'] },
    { label: 'GPT-4o',          fallbacks: ['gpt-4o'] },
    { label: 'GPT-4.1',         fallbacks: ['gpt-4.1', 'gpt-4-1', 'gpt4.1'] },
    { label: 'o3',              fallbacks: ['o3'] },
    { label: 'o4-mini',         fallbacks: ['o4-mini'] },
  ]

  const STORAGE_MAP  = 'qm_modelKeyByLabel_v2'   // label -> key
  const STORAGE_LAST = 'qm_lastLabel_v2'
  const DEBUG = true

  const log  = (...a) => { if (DEBUG) console.log('[qm]', ...a) }
  const warn = (...a) => console.warn('[qm]', ...a)

  const qs = s => document.querySelector(s)
  const delay = ms => new Promise(r => setTimeout(r, ms))
  const waitFor = async (pred, { timeout = 3500, step = 50 } = {}) => {
    const t0 = performance.now()
    while (performance.now() - t0 < timeout) {
      const v = pred()
      if (v) return v
      await delay(step)
    }
    return null
  }
  const normalize = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()

  const readMap  = () => { try { return JSON.parse(localStorage.getItem(STORAGE_MAP) || '{}') } catch { return {} } }
  const writeMap = m => { try { localStorage.setItem(STORAGE_MAP, JSON.stringify(m)) } catch {} }

  const modelTrigger = () => qs('[data-testid="model-switcher-dropdown-button"]')
  const currentModelLabel = () => {
    const btn = modelTrigger()
    const aria = btn?.getAttribute('aria-label') || ''
    const m = aria.match(/current model is (.+)$/i)
    return m ? m[1].trim() : null
  }

  // Map header text → our canonical button label
  const toButtonLabel = label => {
    if (!label) return null
    const n = normalize(label)
    if (/\bthinking mini\b/.test(n)) return '5 Thinking mini'
    if (/\bthinking\b/.test(n))      return '5 Thinking'
    if (/\bfast\b/.test(n))          return '5 Fast'
    if (/\b4\.?1\b/.test(n))         return 'GPT-4.1'
    if (/\b4o\b/.test(n))            return 'GPT-4o'
    if (/^o3$/i.test(n))            return 'o3'
    if (/^o4[- ]?mini$/i.test(n))   return 'o4-mini'
    return label
  }

  const setButtonsActive = () => {
    const active = toButtonLabel(currentModelLabel())
    document.querySelectorAll('#quick-model-bar .qm-btn').forEach(b => {
      b.classList.toggle('active', normalize(b.dataset.label) === normalize(active))
    })
    log('active=', active, 'header=', currentModelLabel())
  }

  // ---------- Core: change ?model= without reload and wait for header ----------
  let selfNavDepth = 0

  const setModelParamNoReload = async (modelKey, expectedLabel) => {
    const url = new URL(location.href)
    url.searchParams.set('model', modelKey)

    selfNavDepth++
    history.replaceState(history.state, '', url)
    window.dispatchEvent(new Event('popstate'))
    await delay(0)
    window.dispatchEvent(new Event('visibilitychange'))

    const ok = await waitFor(() => {
      const lbl = currentModelLabel()
      if (!lbl) return false
      return normalize(toButtonLabel(lbl)) === normalize(expectedLabel)
    }, { timeout: 3000, step: 50 })
    selfNavDepth--

    log('setModelParamNoReload →', { tryKey: modelKey, expectedLabel, ok })
    return !!ok
  }

  // ---------- Learn mapping ONLY when header label actually changes ----------
  const installHeaderObserver = () => {
    const trig = modelTrigger()
    if (!trig) return
    let last = currentModelLabel()

    const mo = new MutationObserver(() => {
      const lbl = currentModelLabel()
      if (!lbl || lbl === last) return
      last = lbl

      const btnLabel = toButtonLabel(lbl)
      const key = new URL(location.href).searchParams.get('model')
      if (key && selfNavDepth === 0) {
        const map = readMap()
        map[normalize(btnLabel)] = key
        writeMap(map)
        log('learned mapping:', btnLabel, '→', key)
      }

      try { localStorage.setItem(STORAGE_LAST, btnLabel) } catch {}
      setButtonsActive()
    })
    mo.observe(trig, { attributes: true, attributeFilter: ['aria-label'] })
  }

  // ---------- Switching by button label ----------
  const switchByLabel = async label => {
    log('=== switch start ===', label)
    const map = readMap()
    const knownKey = map[normalize(label)]

    if (knownKey) {
      const ok = await setModelParamNoReload(knownKey, label)
      if (ok) {
        try { localStorage.setItem(STORAGE_LAST, label) } catch {}
        setButtonsActive()
        log('=== switch end (known key) ===')
        return
      } else {
        warn('known key did not update header, will try fallbacks', knownKey)
      }
    }

    const cfg = BUTTONS.find(b => normalize(b.label) === normalize(label))
    const candidates = cfg?.fallbacks || []
    for (const k of candidates) {
      const ok = await setModelParamNoReload(k, label)
      if (ok) {
        const m = readMap()
        m[normalize(label)] = k
        writeMap(m)
        try { localStorage.setItem(STORAGE_LAST, label) } catch {}
        setButtonsActive()
        log('learned via fallback:', label, '→', k)
        log('=== switch end (fallback) ===')
        return
      }
    }

    warn('Could not switch to', label, '— pick it once from the native dropdown to teach me its key')
    log('=== switch end (unresolved) ===')
  }

  // ---------- UI injection ----------
  const insertBar = async () => {
    if (qs('#quick-model-bar')) return
    const header = await waitFor(() => qs('#page-header'), { timeout: 6000 })
    if (!header) { warn('header not found'); return }

    const bar = document.createElement('div')
    bar.id = 'quick-model-bar'

    BUTTONS.forEach(m => {
      const btn = document.createElement('button')
      btn.className = 'qm-btn'
      btn.textContent = m.label
      btn.dataset.label = m.label
      btn.addEventListener('click', () => switchByLabel(m.label))
      bar.appendChild(btn)
    })

    const actions = header.querySelector('#conversation-header-actions')?.parentElement
    if (actions) header.insertBefore(bar, actions)
    else header.appendChild(bar)

    installHeaderObserver()
    setButtonsActive()
    log('bar inserted')
  }

  insertBar()
  setInterval(() => { if (!qs('#quick-model-bar')) insertBar() }, 1500)

  // ---------- Apply last on home (no reload) ----------
  const applyLastOnHome = async () => {
    if (location.pathname !== '/') return
    const last = localStorage.getItem(STORAGE_LAST)
    if (!last) return
    const visible = toButtonLabel(currentModelLabel())
    if (normalize(visible) === normalize(last)) return
    await switchByLabel(last)
  }

  window.addEventListener('pageshow', () => {
    setButtonsActive()
    applyLastOnHome()
  })
  window.addEventListener('popstate', setButtonsActive)

  // ---------- Debug helpers ----------
  window.__qm = {
    map:   () => { const m = readMap(); console.log('[qm] map', m); return m },
    clear: () => { localStorage.removeItem(STORAGE_MAP); console.log('[qm] map cleared') },
    select: lbl => switchByLabel(lbl),
    state: () => ({
      headerLabel: currentModelLabel(),
      buttonLabel: toButtonLabel(currentModelLabel()),
      urlModel: new URL(location.href).searchParams.get('model'),
      selfNavDepth
    })
  }
})()


;(() => {
  const TOGGLE_KEY = 'qm_show_native_picker'
  const DEFAULT_SHOW = true

  const headerEl = () => document.getElementById('page-header')
  const barEl    = () => document.getElementById('quick-model-bar')
  const toggleEl = () => document.getElementById('qm-native-toggle')

  const getPref = () => {
    const v = localStorage.getItem(TOGGLE_KEY)
    return v == null ? DEFAULT_SHOW : v === '1'
  }
  const setPref = show => {
    try { localStorage.setItem(TOGGLE_KEY, show ? '1' : '0') } catch {}
  }

  // NEW: apply class on <html>, not on #page-header
  const applyRootClass = show => {
    document.documentElement.classList.toggle('qm-hide-native', !show)
  }

  const insertNativeToggle = () => {
    if (toggleEl()) return
    const h = headerEl()
    if (!h) return

    const wrap = document.createElement('label')
    wrap.id = 'qm-native-toggle'
    wrap.title = 'Show dropdown model picker'

    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = getPref()
    wrap.appendChild(input)

    // place just before your quick bar if present, else next to native button
    const bar = barEl()
    if (bar && bar.parentElement === h) h.insertBefore(wrap, bar)
    else (h.querySelector('[data-testid="model-switcher-dropdown-button"]')?.parentElement || h).appendChild(wrap)

    input.addEventListener('change', () => {
      setPref(input.checked)
      applyRootClass(input.checked)
    })

    // initial apply
    applyRootClass(input.checked)
  }

  const ensureToggle = () => {
    if (!toggleEl()) insertNativeToggle()
    // ensure class sticks even if header is replaced
    applyRootClass(getPref())
  }

  ensureToggle()
  // keep-alive is fine, but now the class is on <html> so flashes should be gone
  const id = setInterval(ensureToggle, 1200)
  window.addEventListener('beforeunload', () => clearInterval(id))
})()

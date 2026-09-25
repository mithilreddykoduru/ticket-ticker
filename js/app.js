(function () {
  const { HALLS, STATES, TIERS, ALARM, store } = TT
  const $ = id => document.getElementById(id)
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

  // ---- data ----
  let tickets = TT.buildSample()
  let source = 'sample'
  const saved = store.get('tickets')
  if (Array.isArray(saved) && saved.length) {
    try { tickets = TT.normalize(saved); source = 'imported' } catch (e) { store.set('tickets', null) }
  }
  const notes = store.get('notes', {})

  const ui = {
    halls: new Set(store.get('halls', ['DH B', 'NS 1'])),
    states: new Set(),
    tiers: new Set(),
    posts: new Set(),
    row: '',
    fcan: false,
    q: '',
    current: null
  }

  const byId = id => tickets.find(t => t.id === id)
  const inHalls = () => tickets.filter(t => ui.halls.has(t.hall))

  function matches(t) {
    if (ui.states.size && !t.links.some(l => ui.states.has(TT.linkState(l)))) return false
    if (ui.tiers.size && !t.links.some(l => ui.tiers.has(TT.tierOf(l.a.host)) || ui.tiers.has(TT.tierOf(l.b.host)))) return false
    if (ui.row && String(t.row) !== ui.row) return false
    if (ui.posts.size && !ui.posts.has(t.post)) return false
    if (ui.fcan && !TT.isFcan(t)) return false
    const q = ui.q.trim().toLowerCase()
    if (q) {
      const hay = [t.id, t.work, t.hall, TT.locText(t), notes[t.id] || '',
        ...t.links.flatMap(l => [l.a.host, l.a.port, l.b.host, l.b.port])].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }

  const sortOrder = { bad: 0, warn: 1, idle: 2, ok: 3 }
  const clsOf = t => TT.stateInfo(TT.ticketState(t)).cls || 'idle'

  function visible() {
    return inHalls().filter(matches).sort((a, b) =>
      sortOrder[clsOf(a)] - sortOrder[clsOf(b)] ||
      a.hall.localeCompare(b.hall) || a.row - b.row || a.rack - b.rack)
  }

  // ---- halls, tiles, filters ----
  function renderHalls() {
    const counts = {}
    for (const t of tickets) counts[t.hall] = (counts[t.hall] || 0) + 1
    const btn = h => `<button class="hall" data-hall="${h.id}" aria-pressed="${ui.halls.has(h.id)}">
      ${h.id}<span class="n">${counts[h.id] || 0}</span></button>`
    $('nsRow').innerHTML = HALLS.filter(h => h.type === 'NS').map(btn).join('')
    $('dhRow').innerHTML = HALLS.filter(h => h.type === 'DH').map(btn).join('')
  }

  function renderTiles() {
    const count = Object.fromEntries(STATES.map(s => [s.k, 0]))
    for (const t of inHalls()) for (const l of t.links) count[TT.linkState(l)]++
    $('tiles').innerHTML = STATES.map(s => `
      <button class="tile ${s.cls} ${count[s.k] ? '' : 'zero'}" data-state="${s.k}" aria-pressed="${ui.states.has(s.k)}">
        <span class="v">${count[s.k]}</span><span class="k">${s.name}</span>
      </button>`).join('')
  }

  function renderFilters() {
    $('tierSeg').innerHTML = TIERS.map(t => `<button data-v="${t}" aria-pressed="${ui.tiers.has(t)}">${t}</button>`).join('')

    const rows = [...new Set(inHalls().map(t => t.row))].sort((a, b) => a - b)
    if (ui.row && !rows.includes(+ui.row)) ui.row = ''
    $('rowSel').innerHTML = '<option value="">All rows</option>' +
      rows.map(r => `<option value="${r}" ${String(r) === ui.row ? 'selected' : ''}>Row ${r}</option>`).join('')

    for (const b of $('sideSeg').children) b.setAttribute('aria-pressed', ui.posts.has(b.dataset.v))
    $('fcan').setAttribute('aria-pressed', ui.fcan)
  }

  // ---- ticket list ----
  function renderList() {
    if (!ui.halls.size) {
      $('list').innerHTML = '<div class="empty">Pick one or more halls above to load their tickets.</div>'
      return
    }
    const list = visible()
    const head = `<div class="list-head"><span class="label">Tickets</span><span>${list.length} of ${inHalls().length}</span></div>`
    if (!list.length) {
      $('list').innerHTML = head + '<div class="empty">No tickets match these filters.</div>'
      return
    }
    $('list').innerHTML = head + list.map(t => {
      const st = TT.stateInfo(TT.ticketState(t))
      const tiers = [...new Set(t.links.flatMap(l => [TT.tierOf(l.a.host), TT.tierOf(l.b.host)]))].join(' › ')
      return `<button class="tk ${st.cls || 'idle'}" data-id="${esc(t.id)}" aria-current="${ui.current === t.id}">
        <span class="stripe"></span>
        <span>
          <div class="t1">${esc(t.work)}</div>
          <div class="t2">${esc(t.id)} · ${esc(TT.locText(t))}</div>
          <div class="t3">
            <span class="tag ${st.cls}">${st.name}</span>
            ${tiers ? `<span class="tag">${tiers}</span>` : ''}
            ${TT.isFcan(t) ? '<span class="tag acc">FCAN</span>' : ''}
            ${t.linked.length ? `<span class="tag acc">↔ ${t.linked.length} linked</span>` : ''}
            ${notes[t.id] ? '<span class="tag">note</span>' : ''}
          </div>
        </span>
        <span class="hl">${esc(t.hall)}<br>${t.post ? esc(t.post) + ' post' : ''}</span>
      </button>`
    }).join('')
  }

  // ---- detail ----
  function optics(vals, lo, hi, dir) {
    return vals.map(v => {
      let cls = TT.opticClass(v, lo, hi)
      if (dir === 'tx' && cls === 'ok') cls = ''
      return `<span class="c ${cls}">${dir}: ${v}</span>`
    }).join('')
  }

  function sideBlock(label, s) {
    if (!s) return `<div class="sec"><span class="nm">${label}</span><div class="chips"><span class="c">no data yet</span></div></div>`
    const [lo, hi] = s.alarm || ALARM
    const stat = (k, v, good) => `<span class="c ${good ? 'ok' : 'bad'}">${k} = ${esc(v)}</span>`
    return `
      <div class="sec"><span class="nm">${label} Optics</span><div class="chips">
        ${optics(s.rx, lo, hi, 'rx')}${optics(s.tx, lo, hi, 'tx')}
        <span class="c">[alrm_lo, alrm_hi] ~ [${lo.toFixed(2)}, ${hi.toFixed(2)}]</span>
        ${s.vendor ? `<span class="c">Vendor/ID: ${esc(s.vendor)}</span>` : ''}
      </div></div>
      <div class="sec"><span class="nm">${label} Iface Stat</span><div class="chips">
        ${stat('admin_status', s.admin, s.admin === 'up')}
        ${stat('in_errors', s.inErr, !s.inErr)}
        ${stat('oper_status', s.oper, s.oper === 'up')}
        ${stat('out_errors', s.outErr, !s.outErr)}
      </div></div>`
  }

  function pathHtml(t) {
    const chain = [t, ...t.linked.map(byId).filter(Boolean)]
    const hops = new Map()
    for (const tk of chain) {
      for (const l of tk.links) {
        for (const e of [l.a, l.b]) {
          const hop = hops.get(e.host) || { tier: TT.tierOf(e.host), host: e.host, here: false }
          if (tk === t) hop.here = true
          hops.set(e.host, hop)
        }
      }
    }
    const rank = tier => (TIERS.indexOf(tier) + 1) || 99
    return [...hops.values()]
      .sort((a, b) => rank(a.tier) - rank(b.tier))
      .map(h => `<div class="hop ${h.here ? 'here' : ''}"><span class="tier">${h.tier}</span><span class="h">${esc(h.host)}</span></div>`)
      .join('<span class="arrow">›</span>')
  }

  function renderDetail() {
    const box = $('detail')
    const t = byId(ui.current)
    if (!t) {
      box.innerHTML = '<div class="placeholder">Select a ticket to see its path, optics and interface stats.</div>'
      return
    }

    const count = Object.fromEntries(STATES.map(s => [s.k, 0]))
    t.links.forEach(l => count[TT.linkState(l)]++)
    const mini = s => !count[s.k] ? '' : ({ ok: 'on', warn: 'onw', bad: 'onb' }[s.cls] || '')
    const otherSide = TT.hallOf(t.hall).type === 'NS' ? 'data hall' : 'network suite'

    box.innerHTML = `
      <div class="d-head">
        <button class="back" id="back" aria-label="Back to list">‹</button>
        <div>
          <h2>${esc(t.work)}</h2>
          <div class="loc">${esc(t.id)} · ${esc(TT.locText(t))}</div>
        </div>
      </div>
      <div class="d-body">
        <div class="facts">
          <div class="fact"><div class="k">Hall</div><div class="v">${esc(t.hall)}</div></div>
          <div class="fact"><div class="k">Row</div><div class="v">${t.row}</div></div>
          <div class="fact"><div class="k">Rack</div><div class="v">${t.rack}</div></div>
          <div class="fact"><div class="k">Elev</div><div class="v">${Number(t.elev).toFixed(2)}${TT.isFcan(t) ? ' FCAN' : ''}</div></div>
          <div class="fact"><div class="k">Post</div><div class="v">${esc(t.post) || '–'}</div></div>
        </div>

        <div class="mini">${STATES.map(s => `<div class="${mini(s)}"><b>${count[s.k]}</b> ${s.name}</div>`).join('')}</div>

        ${t.links.length ? `<div><div class="label" style="margin-bottom:6px">Fiber path</div><div class="path">${pathHtml(t)}</div></div>` : ''}

        ${t.linked.length ? `<div>
          <div class="label" style="margin-bottom:6px">Linked ${otherSide} tickets</div>
          <div class="linked">${t.linked.map(id => {
            const o = byId(id)
            return `<button data-jump="${esc(id)}">${esc(id)}${o ? ' · ' + esc(o.hall) : ''}</button>`
          }).join('')}</div>
        </div>` : ''}

        ${t.links.map((l, i) => {
          const k = TT.linkState(l)
          const s = TT.stateInfo(k)
          const lldpCls = k === 'loop' || k === 'mismatch' ? 'warn' : 'ok'
          return `<details class="lk" ${i === 0 ? 'open' : ''}>
            <summary>
              <div><div class="hosts">${esc(l.a.host)} &gt; ${esc(l.b.host)}</div><div class="ports">${esc(l.a.port)} &gt; ${esc(l.b.port)}</div></div>
              <span class="tag ${s.cls}" style="align-self:flex-start">${s.name}</span>
            </summary>
            <div class="inner">
              ${sideBlock('Local', l.local)}
              <div class="sec"><span class="nm">Local LLDP</span><div class="chips">
                ${l.local ? `<span class="c ${lldpCls}">${esc(l.local.lldp || 'none')}</span>` : '<span class="c">no data yet</span>'}
              </div></div>
              ${sideBlock('Remote', l.remote)}
              <div class="sec"><span class="nm">Remote LLDP</span><div class="chips">
                ${l.remote ? `<span class="c ok">${esc(l.remote.lldp || 'none')}</span>` : '<span class="c">no data yet</span>'}
              </div></div>
            </div>
          </details>`
        }).join('')}

        <div class="notes">
          <label class="label" for="note">My notes</label>
          <textarea id="note" placeholder="Cleaned both ends, reseated optic…">${esc(notes[t.id] || '')}</textarea>
          <div class="saved" id="noteSaved"></div>
        </div>
      </div>`
  }

  function renderSource() {
    $('src').innerHTML = source === 'sample'
      ? 'Showing <b>sample tickets</b>'
      : `Showing <b>${tickets.length} imported tickets</b>`
  }

  function render() {
    renderHalls()
    renderTiles()
    renderFilters()
    renderList()
    renderDetail()
    renderSource()
    $('work').classList.toggle('open', !!ui.current)
  }

  function open(id) {
    const t = byId(id)
    if (!t) return
    ui.halls.add(t.hall)
    ui.current = id
    render()
  }

  // ---- events ----
  document.querySelector('.halls').addEventListener('click', e => {
    const b = e.target.closest('[data-hall]')
    if (b) {
      const h = b.dataset.hall
      ui.halls.has(h) ? ui.halls.delete(h) : ui.halls.add(h)
    } else if (e.target.id === 'allHalls') {
      ui.halls = new Set(HALLS.map(h => h.id))
    } else if (e.target.id === 'noHalls') {
      ui.halls.clear()
    } else return
    store.set('halls', [...ui.halls])
    const cur = byId(ui.current)
    if (cur && !ui.halls.has(cur.hall)) ui.current = null
    render()
  })

  const toggle = (set, v) => (set.has(v) ? set.delete(v) : set.add(v))

  $('tiles').addEventListener('click', e => {
    const b = e.target.closest('[data-state]')
    if (b) { toggle(ui.states, b.dataset.state); render() }
  })
  $('tierSeg').addEventListener('click', e => {
    if (e.target.dataset.v) { toggle(ui.tiers, e.target.dataset.v); render() }
  })
  $('sideSeg').addEventListener('click', e => {
    if (e.target.dataset.v) { toggle(ui.posts, e.target.dataset.v); render() }
  })
  $('fcan').addEventListener('click', () => { ui.fcan = !ui.fcan; render() })
  $('rowSel').addEventListener('change', e => { ui.row = e.target.value; render() })
  $('q').addEventListener('input', e => { ui.q = e.target.value; renderList() })
  $('resetFilters').addEventListener('click', () => {
    ui.states.clear(); ui.tiers.clear(); ui.posts.clear()
    ui.row = ''; ui.fcan = false; ui.q = ''; $('q').value = ''
    render()
  })

  $('list').addEventListener('click', e => {
    const b = e.target.closest('[data-id]')
    if (b) open(b.dataset.id)
  })

  $('detail').addEventListener('click', e => {
    if (e.target.id === 'back') { ui.current = null; render(); return }
    const j = e.target.closest('[data-jump]')
    if (j) open(j.dataset.jump)
  })

  let noteTimer
  $('detail').addEventListener('input', e => {
    if (e.target.id !== 'note') return
    const id = ui.current
    const text = e.target.value
    clearTimeout(noteTimer)
    noteTimer = setTimeout(() => {
      if (text.trim()) notes[id] = text
      else delete notes[id]
      store.set('notes', notes)
      const s = $('noteSaved')
      if (s) s.textContent = 'Saved on this device'
      renderList()
    }, 400)
  })

  document.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)
    if (e.key === '/' && !typing) { e.preventDefault(); $('q').focus() }
    if (e.key === 'Escape' && ui.current && !$('dlg').open) { ui.current = null; render() }
  })

  // theme: system → dark → light → system
  const applyTheme = t => {
    if (t) document.documentElement.dataset.theme = t
    else delete document.documentElement.dataset.theme
  }
  applyTheme(store.get('theme'))
  $('btnTheme').addEventListener('click', () => {
    const next = { null: 'dark', dark: 'light', light: null }[store.get('theme')]
    store.set('theme', next)
    applyTheme(next)
  })

  $('btnExport').addEventListener('click', () => {
    const rows = ui.halls.size ? visible() : tickets
    const blob = new Blob([TT.toCsv(rows)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `tickets-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  })

  // ---- import dialog ----
  const dlg = $('dlg')
  $('btnImport').addEventListener('click', () => { $('dlgErr').textContent = ''; dlg.showModal() })
  $('dlgCancel').addEventListener('click', () => dlg.close())
  $('dlgTemplate').addEventListener('click', () => {
    $('dlgText').value = JSON.stringify(TT.template(), null, 2)
  })
  $('dlgSample').addEventListener('click', () => {
    tickets = TT.buildSample()
    source = 'sample'
    store.set('tickets', null)
    ui.current = null
    dlg.close()
    render()
  })
  $('dlgFile').addEventListener('change', e => {
    const f = e.target.files[0]
    if (!f) return
    const r = new FileReader()
    r.onload = () => { $('dlgText').value = r.result }
    r.readAsText(f)
  })
  $('dlgOk').addEventListener('click', () => {
    try {
      const next = TT.normalize(JSON.parse($('dlgText').value))
      if (!next.length) throw new Error('The list is empty.')
      tickets = next
      source = 'imported'
      ui.current = null
      ui.halls = new Set(next.map(t => t.hall))
      store.set('tickets', next)
      store.set('halls', [...ui.halls])
      dlg.close()
      render()
    } catch (err) {
      $('dlgErr').textContent = err instanceof SyntaxError
        ? "That isn't valid JSON. Check for a missing comma or bracket."
        : err.message
    }
  })

  if (window.matchMedia('(min-width: 861px)').matches && source === 'sample') ui.current = 'tkt26826746'
  render()
})()

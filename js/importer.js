// Turns whatever JSON the ticketing export gives us into the shape the board uses,
// and back out to CSV.
window.TT = window.TT || {}

function num(v, fallback = 0) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

function cleanSide(s) {
  if (!s) return null
  const list = v => (Array.isArray(v) ? v.map(x => num(x, -40)) : [])
  return {
    rx: list(s.rx),
    tx: list(s.tx),
    alarm: Array.isArray(s.alarm) && s.alarm.length === 2 ? s.alarm.map(Number) : TT.ALARM,
    vendor: s.vendor || '',
    admin: s.admin || s.admin_status || 'up',
    oper: s.oper || s.oper_status || 'up',
    inErr: num(s.inErr ?? s.in_errors),
    outErr: num(s.outErr ?? s.out_errors),
    lldp: s.lldp || ''
  }
}

function endpoint(e) {
  if (typeof e === 'string') {
    const [host, port] = e.split(':')
    return { host, port: port || '' }
  }
  return { host: e?.host || '', port: e?.port || '' }
}

TT.fromCsv = function (text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row.')

  const parseLine = line => {
    const res = []
    let cur = '', inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
        else { inQuotes = !inQuotes }
      } else if (c === ',' && !inQuotes) {
        res.push(cur.trim())
        cur = ''
      } else {
        cur += c
      }
    }
    res.push(cur.trim())
    return res
  }

  const headers = parseLine(lines[0]).map(h => h.toLowerCase())
  const ticketIdx = headers.indexOf('ticket') !== -1 ? headers.indexOf('ticket') : headers.indexOf('id')
  if (ticketIdx === -1) throw new Error('CSV is missing a "ticket" or "id" header column.')

  const getCol = (cols, name) => {
    const idx = headers.indexOf(name)
    return idx !== -1 ? cols[idx] : ''
  }

  const map = new Map()
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i])
    const id = cols[ticketIdx]
    if (!id) continue

    let t = map.get(id)
    if (!t) {
      const hall = getCol(cols, 'hall')
      const work = getCol(cols, 'work') || 'Open'
      const site = getCol(cols, 'site')
      const room = getCol(cols, 'room')
      const row = getCol(cols, 'row')
      const rack = getCol(cols, 'rack')
      const elev = getCol(cols, 'elev')
      const post = getCol(cols, 'post')
      const linkedStr = getCol(cols, 'linked')
      const linked = linkedStr ? linkedStr.split(/\s+/).filter(Boolean) : []

      t = { id, hall, work, site, room, row, rack, elev, post, linked, links: [] }
      map.set(id, t)
    }

    const aHost = getCol(cols, 'a_host') || getCol(cols, 'host_a')
    const aPort = getCol(cols, 'a_port') || getCol(cols, 'port_a')
    const bHost = getCol(cols, 'b_host') || getCol(cols, 'host_b')
    const bPort = getCol(cols, 'b_port') || getCol(cols, 'port_b')

    if (aHost || bHost) {
      t.links.push({
        a: { host: aHost, port: aPort },
        b: { host: bHost, port: bPort },
        local: null,
        remote: null
      })
    }
  }

  return [...map.values()]
}

TT.normalize = function (raw) {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      raw = JSON.parse(trimmed)
    } else {
      raw = TT.fromCsv(trimmed)
    }
  }
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.tickets) ? raw.tickets : null
  if (!arr) throw new Error('Expected a list of tickets, an object with a "tickets" list, or a CSV export.')

  const tickets = arr.map((t, i) => {
    if (!t || !t.id) throw new Error(`Ticket ${i + 1} has no "id".`)

    // "MCA1, 1B, 10, 38, 22.00" is how the ticket header reads, so take that too
    let { site, room, row, rack, elev } = t
    if (t.location) {
      const parts = String(t.location).split(',').map(s => s.trim())
      ;[site, room, row, rack, elev] = [parts[0], parts[1], parts[2], parts[3], parts[4]]
    }

    let hall = t.hall
    if (!hall && room) hall = (TT.HALLS.find(h => h.room.toLowerCase() === String(room).toLowerCase()) || {}).id
    if (!TT.hallOf(hall)) {
      throw new Error(`${t.id}: hall "${hall ?? ''}" isn't one of ${TT.HALLS.map(h => h.id).join(', ')}.`)
    }

    return {
      id: String(t.id),
      hall,
      work: t.work || t.status || 'Open',
      site: site || '',
      room: room || TT.hallOf(hall).room,
      row: num(row),
      rack: num(rack),
      elev: num(elev),
      post: String(t.post || '').toUpperCase(),
      linked: Array.isArray(t.linked) ? t.linked.map(String) : [],
      patchText: t.patchText || '',
      links: (t.links || []).map(l => ({
        a: endpoint(l.a), b: endpoint(l.b),
        local: cleanSide(l.local), remote: cleanSide(l.remote)
      }))
    }
  })

  TT.autoLink(tickets)
  return tickets
}

// NS fiber ends on the DH switch, so an NS ticket and a DH ticket that
// touch the same SSW belong together even if the export didn't say so.
TT.autoLink = function (tickets) {
  const byId = new Map(tickets.map(t => [t.id, t]))
  const sswOf = t => new Set(t.links.flatMap(l => [l.a.host, l.b.host]).filter(h => TT.tierOf(h) === 'SSW'))
  const ns = tickets.filter(t => TT.hallOf(t.hall).type === 'NS')
  const dh = tickets.filter(t => TT.hallOf(t.hall).type === 'DH')

  for (const n of ns) {
    const mine = sswOf(n)
    if (!mine.size) continue
    for (const d of dh) {
      if ([...sswOf(d)].some(h => mine.has(h))) {
        if (!n.linked.includes(d.id)) n.linked.push(d.id)
      }
    }
  }
  // make every link two-way
  for (const t of tickets) {
    for (const id of t.linked) {
      const other = byId.get(id)
      if (other && !other.linked.includes(t.id)) other.linked.push(t.id)
    }
  }
}

TT.template = function () {
  return {
    tickets: [{
      id: 'tkt26826746',
      hall: 'DH B',
      work: 'Cable - Cleaned',
      location: 'MCA1, 1B, 10, 38, 22.00',
      post: 'O',
      linked: [],
      links: [{
        a: 'ssw014.s001.m011.mca1:eth1/40/1',
        b: 'fsw005.p004.m011.mca1:eth1/29/1',
        local: {
          rx: [0.61, 1.36, 0.94, 1.84], tx: [2.5, 1.75, 2.28, 1.97], alarm: [-7.2, 4.5],
          vendor: 'Finisar / FTCE4717E1PCB-FB',
          admin_status: 'up', oper_status: 'up', in_errors: 0, out_errors: 0,
          lldp: 'fsw005.p004.m011.mca1:eth1/29/1'
        },
        remote: {
          rx: [-6.88, -6.35, -6.63, -6.95], tx: [1.85, 2.12, 1.81, 1.9], alarm: [-7.2, 4.5],
          vendor: 'FINISAR / FTCE4717E1PCBFB1',
          admin_status: 'up', oper_status: 'up', in_errors: 0, out_errors: 0,
          lldp: 'ssw014.s001.m011.mca1:eth1/40/1'
        }
      }]
    }]
  }
}

TT.toCsv = function (tickets) {
  const head = ['ticket', 'hall', 'work', 'site', 'room', 'row', 'rack', 'elev', 'post', 'fcan',
    'a_host', 'a_port', 'b_host', 'b_port', 'link_state', 'local_rx_min', 'remote_rx_min', 'linked']
  const q = v => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const rows = [head]
  for (const t of tickets) {
    const links = t.links.length ? t.links : [null]
    for (const l of links) {
      rows.push([
        t.id, t.hall, t.work, t.site, t.room, t.row, t.rack, Number(t.elev).toFixed(2), t.post,
        TT.isFcan(t) ? 'yes' : '',
        l?.a.host, l?.a.port, l?.b.host, l?.b.port,
        l ? TT.stateInfo(TT.linkState(l)).name : '',
        l?.local?.rx.length ? Math.min(...l.local.rx) : '',
        l?.remote?.rx.length ? Math.min(...l.remote.rx) : '',
        t.linked.join(' ')
      ])
    }
  }
  return rows.map(r => r.map(q).join(',')).join('\n')
}

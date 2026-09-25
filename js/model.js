window.TT = window.TT || {}

TT.HALLS = [
  { id: 'NS 1', type: 'NS', room: 'NS1' },
  { id: 'NS 2', type: 'NS', room: 'NS2' },
  { id: 'NS 3', type: 'NS', room: 'NS3' },
  { id: 'NS 4', type: 'NS', room: 'NS4' },
  { id: 'DH A', type: 'DH', room: '1A' },
  { id: 'DH B', type: 'DH', room: '1B' },
  { id: 'DH C', type: 'DH', room: '1C' },
  { id: 'DH D', type: 'DH', room: '1D' }
]

TT.STATES = [
  { k: 'pending',  name: 'Pending',        cls: '' },
  { k: 'up',       name: 'Circuit Up',     cls: 'ok' },
  { k: 'loop',     name: 'Local Loop',     cls: 'warn' },
  { k: 'mismatch', name: 'Mismatched Int', cls: 'warn' },
  { k: 'norx',     name: 'No RX',          cls: 'bad' },
  { k: 'notx',     name: 'No TX',          cls: 'bad' },
  { k: 'failed',   name: 'Failed',         cls: 'bad' }
]

TT.TIERS = ['XSW', 'SSW', 'FSW']
TT.ALARM = [-7.2, 4.5]

const RANK = { up: 0, pending: 1, loop: 2, mismatch: 2, norx: 3, notx: 3, failed: 3 }

// Order matters here: a looped or mis-patched fiber will usually also show
// odd light levels, so the patching problems get reported first.
TT.linkState = function (l) {
  if (!l.local || !l.remote) return 'pending'
  const lo = (l.local.alarm || TT.ALARM)[0]
  const peer = l.local.lldp || ''

  if (peer && peer.split(':')[0] === l.a.host) return 'loop'
  if (peer && peer !== `${l.b.host}:${l.b.port}`) return 'mismatch'
  if (l.local.tx.some(v => v < lo) || l.remote.rx.some(v => v < lo - 10)) return 'notx'
  if (l.local.rx.some(v => v < lo)) return 'norx'

  const down = l.local.oper !== 'up' || l.remote.oper !== 'up'
  const errs = l.local.inErr || l.local.outErr || l.remote.inErr || l.remote.outErr
  if (down || errs) return 'failed'
  return 'up'
}

TT.ticketState = function (t) {
  let worst = 'up'
  for (const l of t.links) {
    const s = TT.linkState(l)
    if (RANK[s] > RANK[worst]) worst = s
  }
  return t.links.length ? worst : 'pending'
}

TT.stateInfo = k => TT.STATES.find(s => s.k === k)
TT.tierOf = host => ((host || '').match(/^[a-z]+/i) || [''])[0].toUpperCase()
TT.isFcan = t => [46, 47].includes(Math.floor(t.elev))
TT.locText = t => `${t.site}, ${t.room}, ${t.row}, ${t.rack}, ${Number(t.elev).toFixed(2)}`
TT.hallOf = id => TT.HALLS.find(h => h.id === id)

// green inside the alarm window, amber within 1 dB of the low alarm, red outside
TT.opticClass = function (v, lo, hi) {
  if (v < lo || v > hi) return 'bad'
  if (v < lo + 1 || v > hi - 0.5) return 'warn'
  return 'ok'
}

// Fake but realistic tickets so the board has something to show before an import.
// Seeded, so every reload gives the same set.
window.TT = window.TT || {}

TT.buildSample = function () {
  let seed = 26826746
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1))
  const pick = arr => arr[Math.floor(rnd() * arr.length)]
  const between = (a, b) => +(a + rnd() * (b - a)).toFixed(2)
  const pad = n => String(n).padStart(3, '0')
  const lanes = (a, b) => [0, 0, 0, 0].map(() => between(a, b))

  const vendors = ['Finisar / FTCE4717E1PCB-FB', 'FINISAR / FTCE4717E1PCBFB1', 'Innolight / T-DQ4CNT-N00']
  const work = ['Cable - Cleaned', 'Cable - Replaced', 'Optic - Reseated', 'Optic - Replaced', 'Needs Cleaning', 'Open', 'Awaiting Parts']
  const faults = ['up', 'up', 'up', 'up', 'norx', 'notx', 'mismatch', 'loop', 'failed', 'pending']

  function side(host, port, peer, fault) {
    const s = {
      rx: lanes(-3.5, 1.9), tx: lanes(1.5, 2.6), alarm: TT.ALARM, vendor: pick(vendors),
      admin: 'up', oper: 'up', inErr: 0, outErr: 0, lldp: peer
    }
    if (fault === 'norx') s.rx = [-40, -40, -40, -40]
    if (fault === 'notx') s.tx = [-40, -40, -40, -40]
    if (fault === 'loop') s.lldp = host + ':' + port
    if (fault === 'mismatch') s.lldp = peer.replace(/(\d+)\/1$/, (m, p) => (+p + 2) + '/1')
    if (fault === 'failed') { s.oper = 'down'; s.inErr = int(200, 4000) }
    return s
  }

  function link(aHost, aPort, bHost, bPort, fault) {
    const a = { host: aHost, port: aPort }
    const b = { host: bHost, port: bPort }
    if (fault === 'pending') return { a, b, local: null, remote: null }
    const flip = fault === 'norx' ? 'notx' : fault === 'notx' ? 'norx' : null
    return {
      a, b,
      local: side(aHost, aPort, `${bHost}:${bPort}`, fault),
      remote: side(bHost, bPort, `${aHost}:${aPort}`, flip)
    }
  }

  const out = []
  let tid = 26826700

  // straight from the phone screenshot
  out.push({
    id: 'tkt26826746', hall: 'DH B', work: 'Cable - Cleaned', site: 'MCA1', room: '1B',
    row: 10, rack: 38, elev: 22, post: 'O', linked: [],
    links: [{
      a: { host: 'ssw014.s001.m011.mca1', port: 'eth1/40/1' },
      b: { host: 'fsw005.p004.m011.mca1', port: 'eth1/29/1' },
      local: {
        rx: [0.61, 1.36, 0.94, 1.84], tx: [2.5, 1.75, 2.28, 1.97], alarm: TT.ALARM,
        vendor: 'Finisar / FTCE4717E1PCB-FB', admin: 'up', oper: 'up', inErr: 0, outErr: 0,
        lldp: 'fsw005.p004.m011.mca1:eth1/29/1'
      },
      remote: {
        rx: [-6.88, -6.35, -6.63, -6.95], tx: [1.85, 2.12, 1.81, 1.9], alarm: TT.ALARM,
        vendor: 'FINISAR / FTCE4717E1PCBFB1', admin: 'up', oper: 'up', inErr: 0, outErr: 0,
        lldp: 'ssw014.s001.m011.mca1:eth1/40/1'
      }
    }]
  })

  for (const hall of TT.HALLS.filter(h => h.type === 'DH')) {
    const count = hall.id === 'DH B' ? 7 : int(5, 8)
    for (let i = 0; i < count; i++) {
      const pod = pad(int(1, 8))
      const ssw = `ssw${pad(int(1, 24))}.s00${int(1, 4)}.m011.mca1`
      const links = []
      for (let j = 0, n = int(1, 3); j < n; j++) {
        const fsw = `fsw${pad(int(1, 16))}.p${pod}.m011.mca1`
        links.push(link(ssw, `eth1/${int(1, 64)}/1`, fsw, `eth1/${int(1, 48)}/1`, pick(faults)))
      }
      const fcan = rnd() < 0.3
      out.push({
        id: 'tkt' + (tid += int(7, 96)), hall: hall.id, work: pick(work), site: 'MCA1', room: hall.room,
        row: int(1, 18), rack: int(1, 48), elev: fcan ? pick([46, 47]) : int(4, 42),
        post: pick(['O', 'C']), linked: [], links
      })
    }
  }

  // NS side: each ticket lands on the SSW of some DH ticket
  const dh = out.slice()
  for (const hall of TT.HALLS.filter(h => h.type === 'NS')) {
    for (let i = 0, n = int(3, 5); i < n; i++) {
      const target = hall.id === 'NS 1' && i === 0 ? dh[0] : pick(dh)
      const ssw = target.links[0].a.host
      const xsw = `xsw${pad(int(1, 8))}.x00${int(1, 2)}.m011.mca1`
      const t = {
        id: 'tkt' + (tid += int(5, 64)), hall: hall.id, work: pick(work), site: 'MCA1', room: hall.room,
        row: int(1, 6), rack: int(1, 30), elev: rnd() < 0.35 ? pick([46, 47]) : int(4, 42),
        post: pick(['O', 'C']), linked: [target.id],
        links: [link(xsw, `eth1/${int(1, 32)}/1`, ssw, `eth1/${int(49, 64)}/1`, pick(faults))]
      }
      target.linked.push(t.id)
      out.push(t)
    }
  }

  return out
}

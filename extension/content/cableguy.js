// Content script injected into every metaenterprise.com page.
// Tuned to the real Cableguy output format observed on the live page:
//
//   fsw004.p002.m014.mca1
//   eth1/44/1
//   Local Optics: rx:-7.24  rx:-6.62  rx:-6.56  rx:-6.55
//                 tx:2.25   tx:2.42   tx:2.03   tx:1.91
//   [alrm_lo, warn_lo, warn_hi, alrm_hi] = [-40.00, -40.00, 6.50, 6.50]
//   Vendor/ID: Source Photonics / SPQ28E2BF0C0AFB1
//   Local Iface Stat: admin_status = up  in_errors = 0
//                     oper_status = up   out_errors = 0
//   Local LLDP: LOOPED   (or a host:port when not looped)

;(function () {
  'use strict'

  const TAG = '[TT-Bridge]'

  // ---- helpers ----

  const txt = () => document.body ? (document.body.innerText || document.body.textContent || '') : ''

  // Extract ticket id from the URL (/execute/NNNN/) or from page text (tktNNNN)
  function getTicketId (body) {
    const pageM = body.match(/\btkt(\d{5,})\b/i)
    if (pageM) return 'tkt' + pageM[1]
    const urlM = location.pathname.match(/\/execute\/(\d+)/)
    return urlM ? 'tkt' + urlM[1] : null
  }

  // Extract 4 lane values from "rx:-7.24  rx:-6.62  rx:-6.56  rx:-6.55" format
  // label is 'rx' or 'tx'
  function extractLanes (body, label) {
    // Match anything after the colon until the number ends, to handle any weird unicode dashes/spaces
    const re = new RegExp(label + '\\s*:\\s*([^\\d\\s]*\\s*\\d+\\.?\\d*)', 'gi')
    const vals = []
    for (const m of body.matchAll(re)) {
      let str = m[1].replace(/\s+/g, '')
      let isNeg = /[^0-9.]/.test(str)
      let numM = str.match(/\d+\.?\d*/)
      if (numM) {
        let val = Number(numM[0])
        vals.push(isNeg ? -val : val)
      }
    }
    return vals.length > 0 ? vals.slice(0, 4) : null
  }

  // Extract alarm window from "[alrm_lo, warn_lo, warn_hi, alrm_hi] = [v1, v2, v3, v4]"
  // The app uses [lo, hi] = [alrm_lo, alrm_hi]
  function extractAlarm (body) {
    const parse = str => {
      let isNeg = /[^0-9.]/.test(str)
      let numM = str.match(/\d+\.?\d*/)
      if (numM) {
        let val = Number(numM[0])
        return isNeg ? -val : val
      }
      return 0
    }
    const m4 = body.match(/\[alrm_lo[^\]]*\]\s*=\s*\[\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^\]]+)\s*\]/)
    if (m4) return [parse(m4[1]), parse(m4[4])]
    const m2 = body.match(/\[\s*([^,]+)\s*,\s*([^\]]+)\s*\]/)
    if (m2) return [parse(m2[1]), parse(m2[2])]
    return [-7.2, 4.5]
  }

  // Extract a field like "admin_status = up"
  function field (body, name) {
    const m = body.match(new RegExp(name + '\\s*=\\s*(\\w+)', 'i'))
    return m ? m[1] : ''
  }

  // Extract vendor from "Vendor/ID: Source Photonics / SPQ28E..."
  function extractVendor (body) {
    const m = body.match(/Vendor\s*\/\s*ID\s*:\s*(.+?)(?:\n|$)/i)
    return m ? m[1].trim() : ''
  }

  // Extract LLDP neighbor from "Local LLDP: LOOPED" or "Local LLDP: host:port"
  function extractLldp (body, fallbackHostPort) {
    const m = body.match(/Local\s+LLDP\s*:\s*(.+?)(?:\n|$)/i)
    if (!m) return ''
    const val = m[1].trim()
    if (/LOOPED/i.test(val)) return fallbackHostPort  // looped = LLDP sees itself
    return val.toLowerCase()
  }

  // Broad hostname pattern
  const HOST_RE = /\b([a-z]{2,5}\d{1,4}(?:\.[a-z0-9]\d{0,4}){1,4})\b/gi
  const PORT_RE = /\beth\d+\/\d+\/\d+\b/gi

  function extractHosts (body) {
    const seen = new Set()
    const out = []
    for (const m of body.matchAll(new RegExp(HOST_RE.source, 'gi'))) {
      const h = m[1].toLowerCase()
      if (!seen.has(h) && h.includes('.')) { seen.add(h); out.push(h) }
    }
    return out
  }

  function extractPorts (body) {
    return [...body.matchAll(new RegExp(PORT_RE.source, 'gi'))].map(m => m[0].toLowerCase())
  }

  // ---- build a side (local or remote) from the full body text ----
  // sideLabel is 'Local' or 'Remote'
  function buildSide (body, sideLabel, aHost, aPort) {
    // Find the section starting from the label
    const re = new RegExp(sideLabel + '\\s+Optics', 'i')
    const idx = body.search(re)
    if (idx === -1) return null

    const section = body.slice(idx, idx + 800) // take a 800-char chunk

    const rx     = extractLanes(section, 'rx')
    const tx     = extractLanes(section, 'tx')
    const alarm  = extractAlarm(section)
    const vendor = extractVendor(section)
    const admin  = field(section, 'admin_status') || field(section, 'admin') || 'up'
    const oper   = field(section, 'oper_status')  || field(section, 'oper')  || 'up'
    const inErr  = Number(field(section, 'in_errors')  || field(section, 'inErr')  || 0)
    const outErr = Number(field(section, 'out_errors') || field(section, 'outErr') || 0)
    const lldp   = extractLldp(section, aHost + ':' + aPort)

    if (!rx && !tx && !vendor && !lldp && !field(section, 'oper_status')) return null
    return {
      rx:     rx    || [0, 0, 0, 0],
      tx:     tx    || [0, 0, 0, 0],
      alarm,
      vendor,
      admin,
      oper,
      inErr,
      outErr,
      lldp
    }
  }

  // Get all unique ticket IDs on the page
  function getTicketIds (body) {
    const titleMatch = document.title.match(/tkt\d{5,9}/i)
    if (titleMatch) return [titleMatch[0].toLowerCase()] // We are on a detail page

    const matches = [...body.matchAll(/tkt\d{5,9}/gi)]
    if (!matches.length) return []
    return Array.from(new Set(matches.map(m => m[0].toLowerCase())))
  }

  // Extract location fields from a block of text
  function extractLoc(text) {
    let site = '', room = '', row = 0, rack = 0, elev = 0, post = ''
    const locM = text.match(/\\b(MCA\\d)\\s*[,·-]\\s*([12][A-Da-d]|NS\\d)\\s*[,·-]\\s*(\\d+)\\s*[,·-]\\s*(\\d+)\\s*[,·-]\\s*([\\d.]+)/i)
    if (locM) {
      [, site, room, row, rack, elev] = locM
      row = Number(row); rack = Number(rack); elev = parseFloat(elev)
    } else {
      const siteM = text.match(/·\\s*(MCA\\d+)/i) || text.match(/\\b(MCA\\d+)\\b/i)
      if (siteM) site = siteM[1].toUpperCase()
    }
    const postM = text.match(/\\bpost\\s*[:\=]\\s*([OC])\\b/i) || text.match(/\\b([OC])\\s*(?:post|side)\\b/i)
    if (postM) post = postM[1].toUpperCase()
    
    return { site, room, row, rack, elev, post }
  }

  // Extract work status
  function extractWork(text) {
    const workM = text.match(/\\b(Circuit\\s+Audit|Cable\\s*-\\s*\\w+|Optic\\s*-\\s*\\w+|Needs\\s+Cleaning|Awaiting\\s+Parts|Open|check[-\\s]?in|check[-\\s]?out)\\b/i)
    return workM ? workM[1].replace(/\\s+/g, ' ').trim() : 'Open'
  }

  // ---- main scrape ----
  function scrape () {
    const body = txt()
    if (body.length < 20) return null

    console.log(TAG, 'Scraping', location.href, '— body length:', body.length)

    const ids = getTicketIds(body)
    if (!ids.length) { console.log(TAG, 'No ticket ids'); return null }

    if (ids.length > 1 && !document.title.toLowerCase().includes(ids[0])) {
      // Home page list view - extract all basic tickets
      console.log(TAG, 'List page detected, found', ids.length, 'tickets')
      const list = []
      for (const id of ids) {
        // Find text near this ticket ID to extract its basic location
        const start = Math.max(0, body.toLowerCase().indexOf(id) - 100)
        const context = body.slice(start, start + 300)
        const loc = extractLoc(context)
        const work = extractWork(context)
        
        // Hall mapping
        const roomHallMap = { '1A': 'DH A', '1B': 'DH B', '1C': 'DH C', '1D': 'DH D',
          'NS1': 'NS 1', 'NS2': 'NS 2', 'NS3': 'NS 3', 'NS4': 'NS 4' }
        const hall = roomHallMap[loc.room.toUpperCase()] || ''

        list.push({
          id, hall, work,
          site: loc.site, room: loc.room, row: loc.row, rack: loc.rack, elev: loc.elev, post: loc.post,
          _scraped: Date.now()
        })
      }
      return list
    }

    const id = ids[0]
    console.log(TAG, 'Ticket id:', id)

    // Location
    const loc = extractLoc(body)
    const work = extractWork(body)
    const { site, room, row, rack, elev, post } = loc



    // Hall: derive from room mapping or fsw/xsw/ssw hostname
    const roomHallMap = { '1A': 'DH A', '1B': 'DH B', '1C': 'DH C', '1D': 'DH D',
      'NS1': 'NS 1', 'NS2': 'NS 2', 'NS3': 'NS 3', 'NS4': 'NS 4' }
    let hall = ''
    if (room) hall = roomHallMap[room.toUpperCase()] || ''

    // Hosts and ports
    const allHosts = extractHosts(body)
    const allPorts = extractPorts(body)
    // Prefer switch hostnames (xsw/ssw/fsw)
    const switchHosts = allHosts.filter(h => /^(xsw|ssw|fsw|ysw)/.test(h))
    const usableHosts = switchHosts.length ? switchHosts : allHosts.filter(h => h.includes('.'))
    const usablePorts = allPorts

    console.log(TAG, 'Hosts found:', usableHosts)
    console.log(TAG, 'Ports found:', usablePorts)

    // Build links
    const links = []

    // Try arrow pairs: "hostA > hostB"
    const arrowRe = /\b([a-z]{2,5}\d{1,4}(?:\.[a-z0-9]\d{0,4}){1,4})\s*[>→]\s*([a-z]{2,5}\d{1,4}(?:\.[a-z0-9]\d{0,4}){1,4})/gi
    const arrowPairs = [...body.matchAll(arrowRe)]
    console.log(TAG, 'Arrow pairs:', arrowPairs.length)

    if (arrowPairs.length) {
      for (const m of arrowPairs) {
        const aHost = m[1].toLowerCase()
        const bHost = m[2].toLowerCase()
        const near = body.slice(Math.max(0, body.indexOf(m[0]) - 200), body.indexOf(m[0]) + 1000)
        const ports = extractPorts(near)
        const local  = buildSide(body, 'Local',  aHost, ports[0] || '')
        const remote = buildSide(body, 'Remote', bHost, ports[1] || '')
        links.push({
          a: { host: aHost, port: ports[0] || '' },
          b: { host: bHost, port: ports[1] || '' },
          local, remote
        })
      }
    } else if (usableHosts.length >= 1) {
      // Single-ended view: one host shown, build link with what we have
      const aHost = usableHosts[0]
      const aPort = usablePorts[0] || ''
      // B side: use second host if available, else empty
      const bHost = usableHosts[1] || ''
      const bPort = usablePorts[1] || ''

      const local  = buildSide(body, 'Local',  aHost, aPort)
      const remote = buildSide(body, 'Remote', bHost, bPort)

      console.log(TAG, 'Single-ended link:', aHost, aPort, '→', bHost || '(unknown)')
      links.push({
        a: { host: aHost, port: aPort },
        b: { host: bHost, port: bPort },
        local,
        remote
      })
    }

    console.log(TAG, 'Links built:', links.length)

    // Check if the Channel Details (FIMspect / patches) modal is open
    let patchText = ''
    const chanMatch = body.match(/Channel Details/i)
    if (chanMatch) {
      // Grab a chunk of text that likely contains all the CAS and port info
      patchText = body.slice(chanMatch.index, chanMatch.index + 1500)
    }

    const ticket = {
      id,
      hall,
      work,
      site,
      room,
      row:  Number(row)        || 0,
      rack: Number(rack)       || 0,
      elev: parseFloat(elev)   || 0,
      post,
      linked: [],
      links,
      patchText,
      _scraped: Date.now()
    }
    console.log(TAG, 'Ticket to send:', ticket)
    return ticket
  }

  // ---- send to background ----
  function sendTicket (payload) {
    if (!payload) return
    const msg = Array.isArray(payload) ? { type: 'TT_TICKETS', tickets: payload } : { type: 'TT_TICKET', ticket: payload }
    
    try {
      chrome.runtime.sendMessage(msg, resp => {
        if (chrome.runtime.lastError) {
          // Extension was reloaded — disconnect so the old observer stops firing
          obs.disconnect()
          return
        }
        if (resp && resp.ok) {
          console.log(TAG, 'Sent OK, total captured:', resp.count)
          showBanner(`Ticket Ticker: captured ${Array.isArray(payload) ? payload.length + ' tickets' : payload.id} (${resp.count} total)`)
        }
      })
    } catch (e) {
      // Extension context invalidated after a reload — stop the observer
      obs.disconnect()
    }
  }

  // ---- page banner ----
  let banner
  function showBanner (msg) {
    if (!banner) {
      banner = document.createElement('div')
      banner.id = 'tt-banner'
      Object.assign(banner.style, {
        position: 'fixed', top: '8px', right: '12px', zIndex: '999999',
        background: '#1a1a2e', color: '#4f8ef7', border: '1px solid #4f8ef7',
        padding: '6px 12px', borderRadius: '6px', fontSize: '12px',
        fontFamily: 'monospace', pointerEvents: 'none', opacity: '0',
        transition: 'opacity 0.3s'
      })
      document.body.appendChild(banner)
    }
    banner.textContent = msg
    banner.style.opacity = '1'
    clearTimeout(banner._t)
    banner._t = setTimeout(() => { banner.style.opacity = '0' }, 2500)
  }

  // ---- debounced scrape ----
  let timer = null
  function schedule () {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const ticket = scrape()
      if (ticket) sendTicket(ticket)
    }, 600)
  }

  console.log(TAG, 'Content script loaded on', location.href)
  schedule()

  const obs = new MutationObserver(schedule)
  obs.observe(document.body, { childList: true, subtree: true, characterData: true })

})()

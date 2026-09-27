// Content script injected into every Cableguy ticket page:
//   https://www.metaenterprise.com/ticketing/execute/{id}/?repair_phase=check-in
//
// Since we can't inspect the live page in advance, this script:
//   1. Dumps the full page text to the console so you can see what patterns exist
//   2. Tries several scraping strategies with broad regex patterns
//   3. Sends whatever it finds — even partial tickets — to the background
//   4. Shows a banner on-page when it captures something

;(function () {
  'use strict'

  const PREFIX = '[TT-Bridge]'

  // ---- text helpers ----

  const bodyText = () => document.body ? (document.body.innerText || document.body.textContent || '') : ''
  const floats = str => (str.match(/-?\d+\.?\d*/g) || []).map(Number)

  // ---- ID from URL ----
  // URL: /ticketing/execute/1072655358699871/
  // Treat the numeric ID as the ticket id (tkt + number)
  function ticketIdFromUrl () {
    const m = location.pathname.match(/\/execute\/(\d+)/)
    return m ? 'tkt' + m[1] : null
  }

  // ---- broad hostname pattern ----
  // Matches: ssw014.s001.m011.mca1, xsw001.x001.m011.mca1, fsw005.p004.m011.mca1
  const HOST_RE = /\b([a-z]{2,5}\d{1,4}(?:\.[a-z]\d{1,4}){1,3}(?:\.\w+)?)\b/gi
  const PORT_RE = /\beth\d+\/\d+\/\d+\b/gi

  function extractHosts (str) {
    const seen = new Set()
    const out = []
    for (const m of str.matchAll(new RegExp(HOST_RE.source, 'gi'))) {
      const h = m[1].toLowerCase()
      if (!seen.has(h) && h.includes('.')) { seen.add(h); out.push(h) }
    }
    return out
  }

  function extractPorts (str) {
    return [...str.matchAll(new RegExp(PORT_RE.source, 'gi'))].map(m => m[0].toLowerCase())
  }

  // ---- extract 4 float lanes near a label keyword ----
  function extractLanes (text, labelRe) {
    const lines = text.split(/\n/)
    for (let i = 0; i < lines.length; i++) {
      if (labelRe.test(lines[i])) {
        const chunk = lines.slice(i, i + 8).join(' ')
        const vals = floats(chunk).filter(v => v >= -50 && v <= 10)
        if (vals.length >= 4) return vals.slice(0, 4)
      }
    }
    return null
  }

  // ---- iface stats ----
  function extractIfaceStat (block) {
    const adminM  = block.match(/admin[_\s]?status\s*[=:]\s*(\w+)/i)
    const operM   = block.match(/oper[_\s]?status\s*[=:]\s*(\w+)/i)
    const inErrM  = block.match(/in[_\s]?errors?\s*[=:]\s*(\d+)/i)
    const outErrM = block.match(/out[_\s]?errors?\s*[=:]\s*(\d+)/i)
    return {
      admin:  adminM  ? adminM[1]           : 'up',
      oper:   operM   ? operM[1]            : 'up',
      inErr:  inErrM  ? Number(inErrM[1])  : 0,
      outErr: outErrM ? Number(outErrM[1]) : 0
    }
  }

  // ---- build a side object from a text block ----
  function buildSide (block) {
    if (!block || block.length < 10) return null
    const rxLanes = extractLanes(block, /\bRX\b/i)  || extractLanes(block, /receive/i)
    const txLanes = extractLanes(block, /\bTX\b/i)  || extractLanes(block, /transmit/i)
    const alarmM  = block.match(/\[\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*\]/)
    const alarm   = alarmM ? [Number(alarmM[1]), Number(alarmM[2])] : [-7.2, 4.5]
    const vendorM = block.match(/([A-Za-z]{3,}\s*\/\s*[A-Z0-9][A-Z0-9\-]+)/)
    const lldpM   = block.match(/([a-z]{2,5}\d{1,4}\.[a-z]\d{1,4}(?:\.\w+)+:\w+\/\d+\/\d+)/i)
    const iface   = extractIfaceStat(block)
    if (!rxLanes && !txLanes) return null
    return {
      rx:     rxLanes || [0, 0, 0, 0],
      tx:     txLanes || [0, 0, 0, 0],
      alarm,
      vendor: vendorM ? vendorM[1] : '',
      admin:  iface.admin,
      oper:   iface.oper,
      inErr:  iface.inErr,
      outErr: iface.outErr,
      lldp:   lldpM ? lldpM[1].toLowerCase() : ''
    }
  }

  // ---- find a text block for a given label in the DOM ----
  function blockForLabel (labelRe) {
    const elements = document.body.querySelectorAll('*')
    for (const el of elements) {
      const t = el.innerText || el.textContent || ''
      if (labelRe.test(t) && el.children.length < 20 && t.length < 4000 && t.length > 20) {
        return t
      }
    }
    return ''
  }

  // ---- main scrape ----
  function scrape () {
    const txt = bodyText()
    if (txt.length < 20) return null

    // Always log a snapshot to console so we can diagnose
    console.log(PREFIX, '--- PAGE SNAPSHOT ---')
    console.log(PREFIX, 'URL:', location.href)
    console.log(PREFIX, 'Body text (first 2000 chars):\n', txt.slice(0, 2000))

    // 1. Ticket id — prefer visible tktXXXX, fall back to URL numeric id
    const tktMatch = txt.match(/\btkt(\d{5,})\b/i)
    const id = tktMatch ? 'tkt' + tktMatch[1] : ticketIdFromUrl()
    if (!id) { console.log(PREFIX, 'No ticket id found'); return null }
    console.log(PREFIX, 'Ticket id:', id)

    // 2. Location — "MCA1, 1B, 10, 38, 22.00" or labelled fields
    let site = '', room = '', row = 0, rack = 0, elev = 0, post = ''
    const locM = txt.match(/\b(MCA\d)\s*[,·]\s*([12][A-D]|NS\d)\s*[,·]\s*(\d+)\s*[,·]\s*(\d+)\s*[,·]\s*([\d.]+)/i)
    if (locM) {
      [, site, room, row, rack, elev] = locM
      row = Number(row); rack = Number(rack); elev = parseFloat(elev)
    } else {
      const siteM = txt.match(/site\s*[:\=]\s*([A-Z]+\d+)/i)
      const roomM = txt.match(/room\s*[:\=]\s*(\w+)/i)
      const rowM  = txt.match(/row\s*[:\=]\s*(\d+)/i)
      const rackM = txt.match(/rack\s*[:\=]\s*(\d+)/i)
      const elevM = txt.match(/elev\w*\s*[:\=]\s*([\d.]+)/i)
      if (siteM) site = siteM[1]
      if (roomM) room = roomM[1]
      if (rowM)  row  = Number(rowM[1])
      if (rackM) rack = Number(rackM[1])
      if (elevM) elev = parseFloat(elevM[1])
    }
    console.log(PREFIX, 'Location:', { site, room, row, rack, elev })

    // 3. Post
    const postM = txt.match(/\bpost\s*[:\=]\s*([OC])\b/i) ||
                  txt.match(/\b([OC])\s*(?:post|side)\b/i) ||
                  txt.match(/\b(?:goal\s*post|side)\s*[:\=]?\s*([OC])\b/i)
    if (postM) post = postM[1].toUpperCase()

    // 4. Work status
    const workM = txt.match(/\b(Cable\s*-\s*\w+|Optic\s*-\s*\w+|Needs\s+Cleaning|Awaiting\s+Parts|Open|check[-\s]?in|check[-\s]?out)\b/i)
    const work = workM ? workM[1] : 'Open'

    // 5. Hall: from room mapping if possible
    const roomHallMap = { '1A': 'DH A', '1B': 'DH B', '1C': 'DH C', '1D': 'DH D',
      'NS1': 'NS 1', 'NS2': 'NS 2', 'NS3': 'NS 3', 'NS4': 'NS 4' }
    let hall = ''
    const hallM = txt.match(/\bhall\s*[:\=]\s*((?:DH|NS)\s*\w+)/i)
    if (hallM) hall = hallM[1].trim()
    if (!hall && room) hall = roomHallMap[room.toUpperCase()] || ''

    // 6. Hosts and ports
    const allHosts = extractHosts(txt)
    const allPorts = extractPorts(txt)
    console.log(PREFIX, 'Hosts found:', allHosts)
    console.log(PREFIX, 'Ports found:', allPorts)

    // 7. Build links — try arrow separator first, then just pair first two hosts
    const links = []

    // Arrow pairs: "hostA > hostB" or "hostA → hostB"
    const arrowRe = /\b([a-z]{2,5}\d{1,4}(?:\.[a-z]\d{1,4}){1,3}(?:\.\w+)?)\s*[>→]\s*([a-z]{2,5}\d{1,4}(?:\.[a-z]\d{1,4}){1,3}(?:\.\w+)?)/gi
    const arrowPairs = [...txt.matchAll(arrowRe)]
    console.log(PREFIX, 'Arrow pairs:', arrowPairs.length)

    for (const m of arrowPairs) {
      const aHost = m[1].toLowerCase()
      const bHost = m[2].toLowerCase()
      const startIdx = txt.indexOf(m[0])
      const nearby = txt.slice(Math.max(0, startIdx - 300), startIdx + m[0].length + 800)
      const ports = extractPorts(nearby)

      const localBlock  = blockForLabel(/local/i)
      const remoteBlock = blockForLabel(/remote/i)
      links.push({
        a: { host: aHost, port: ports[0] || '' },
        b: { host: bHost, port: ports[1] || '' },
        local:  buildSide(localBlock),
        remote: buildSide(remoteBlock)
      })
    }

    // Fallback: pair unique hosts without arrows
    if (!links.length && allHosts.length >= 2) {
      // Filter to known switch tiers (xsw, ssw, fsw)
      const switchHosts = allHosts.filter(h => /^(xsw|ssw|fsw)/.test(h))
      const usable = switchHosts.length >= 2 ? switchHosts : allHosts
      console.log(PREFIX, 'Using fallback host pairing:', usable.slice(0, 4))
      for (let i = 0; i + 1 < usable.length; i += 2) {
        links.push({
          a: { host: usable[i],     port: allPorts[i]     || '' },
          b: { host: usable[i + 1], port: allPorts[i + 1] || '' },
          local:  buildSide(blockForLabel(/local/i)),
          remote: buildSide(blockForLabel(/remote/i))
        })
      }
    }

    console.log(PREFIX, 'Links built:', links.length, links)

    // Send even if no links found — the ticket ID + location is still useful
    const ticket = {
      id, hall, work, site, room,
      row: Number(row) || 0,
      rack: Number(rack) || 0,
      elev: parseFloat(elev) || 0,
      post,
      linked: [],
      links,
      _scraped: Date.now()
    }
    console.log(PREFIX, 'Ticket to send:', ticket)
    return ticket
  }

  // ---- send to background ----
  function sendTicket (ticket) {
    if (!ticket) return
    chrome.runtime.sendMessage({ type: 'TT_TICKET', ticket }, resp => {
      if (chrome.runtime.lastError) {
        console.log(PREFIX, 'Send error:', chrome.runtime.lastError.message)
        return
      }
      if (resp && resp.ok) {
        console.log(PREFIX, 'Sent OK, total captured:', resp.count)
        showBanner(`Ticket Ticker: captured ${ticket.id} (${resp.count} total)`)
      }
    })
  }

  // ---- on-page banner ----
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

  // ---- debounced scrape on DOM changes ----
  let scrapeTimer = null
  function scheduleScrape () {
    clearTimeout(scrapeTimer)
    scrapeTimer = setTimeout(() => {
      const ticket = scrape()
      // Send even with no links — we want to capture as much as possible
      if (ticket) sendTicket(ticket)
    }, 600)
  }

  console.log(PREFIX, 'Content script loaded on', location.href)
  scheduleScrape()

  const observer = new MutationObserver(scheduleScrape)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })

})()

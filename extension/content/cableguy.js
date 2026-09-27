// Content script injected into every Cableguy ticket page:
//   https://www.metaenterprise.com/ticketing/execute/{id}/?repair_phase=check-in
//
// Strategy: the page renders plain text that updates live. We extract what we can
// from the DOM using text patterns, then watch for mutations to re-scrape on any change.
// The ticket id comes from the URL; everything else is scraped from visible text.

;(function () {
  'use strict'

  // ---- helpers ----

  // Get all visible text in a node, condensed to single spaces
  const text = el => (el ? el.innerText || el.textContent || '' : '')

  // Pull every float from a string (used for dBm lane values)
  const floats = str => (str.match(/-?\d+\.?\d*/g) || []).map(Number)

  // Grab the numeric ticket URL id and convert to a tktXXX id.
  // The page may also show a separate "tkt" reference — we prefer that.
  function ticketIdFromUrl () {
    const m = location.pathname.match(/\/execute\/(\d+)/)
    return m ? 'tkt' + m[1] : null
  }

  // Find the first text node or element whose text matches a regex
  function findText (root, re) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      if (re.test(node.nodeValue)) return node.nodeValue
    }
    return null
  }

  // Return text content of the nearest ancestor that contains the label
  function sectionAfter (root, labelRe) {
    const all = root.querySelectorAll('*')
    for (const el of all) {
      if (labelRe.test(text(el)) && el.children.length === 0) {
        // Walk up until we find a sibling or parent block with the data
        let cur = el.parentElement
        for (let i = 0; i < 5 && cur; i++, cur = cur.parentElement) {
          const t = text(cur)
          if (t.length > text(el).length + 5) return t
        }
      }
    }
    return ''
  }

  // Extract 4 dBm lane values from a text block near a label
  function extractLanes (body, labelRe) {
    const lines = body.split(/\n/)
    for (let i = 0; i < lines.length; i++) {
      if (labelRe.test(lines[i])) {
        // Collect numbers from this line and the next few
        const chunk = lines.slice(i, i + 6).join(' ')
        const vals = floats(chunk).filter(v => v >= -50 && v <= 10)
        if (vals.length >= 4) return vals.slice(0, 4)
      }
    }
    return null
  }

  // Pull admin/oper/errors from a block of text
  function extractIfaceStat (block) {
    const adminM = block.match(/admin[_\s]?status\s*[=:]\s*(\w+)/i)
    const operM  = block.match(/oper[_\s]?status\s*[=:]\s*(\w+)/i)
    const inErrM = block.match(/in[_\s]?errors?\s*[=:]\s*(\d+)/i)
    const outErrM= block.match(/out[_\s]?errors?\s*[=:]\s*(\d+)/i)
    return {
      admin: adminM ? adminM[1] : 'up',
      oper:  operM  ? operM[1]  : 'up',
      inErr:  inErrM  ? Number(inErrM[1])  : 0,
      outErr: outErrM ? Number(outErrM[1]) : 0
    }
  }

  // Hostname pattern: letters + digits . letter + digits . m + digits . suffix
  const HOST_RE = /\b([a-z]{2,5}\d{2,4}\.[a-z]\d{2,4}\.m\d{2,4}\.\w+)\b/gi
  const PORT_RE = /\beth\d+\/\d+\/\d+\b/gi

  function extractHosts (str) {
    return [...str.matchAll(HOST_RE)].map(m => m[1].toLowerCase())
  }

  function extractPorts (str) {
    return [...str.matchAll(PORT_RE)].map(m => m[0].toLowerCase())
  }

  // ---- main scrape ----

  function scrape () {
    const body = document.body
    const bodyText = text(body)

    // Ticket id: prefer "tktXXXXX" pattern visible on page, fallback to URL
    const tktMatch = bodyText.match(/\btkt(\d{6,})\b/i)
    const id = tktMatch ? 'tkt' + tktMatch[1] : ticketIdFromUrl()
    if (!id) return null

    // Location: "MCA1, 1B, 10, 38, 22.00" or "site: MCA1  room: 1B  row: 10 ..."
    let site = '', room = '', row = 0, rack = 0, elev = 0, post = ''

    const locMatch = bodyText.match(/\b(MCA\d)\s*[,·]\s*([12][A-D]|NS\d)\s*[,·]\s*(\d+)\s*[,·]\s*(\d+)\s*[,·]\s*([\d.]+)/i)
    if (locMatch) {
      ;[, site, room, row, rack, elev] = locMatch
      row = Number(row); rack = Number(rack); elev = parseFloat(elev)
    } else {
      const siteM = bodyText.match(/\bsite\b[:\s]+([A-Z]+\d)/i)
      const roomM = bodyText.match(/\broom\b[:\s]+(\w+)/i)
      const rowM  = bodyText.match(/\brow\b[:\s]+(\d+)/i)
      const rackM = bodyText.match(/\brack\b[:\s]+(\d+)/i)
      const elevM = bodyText.match(/\belev(?:ation)?\b[:\s]+([\d.]+)/i)
      if (siteM) site = siteM[1]
      if (roomM) room = roomM[1]
      if (rowM)  row  = Number(rowM[1])
      if (rackM) rack = Number(rackM[1])
      if (elevM) elev = parseFloat(elevM[1])
    }

    // Post (goal post O or C)
    const postM = bodyText.match(/\bpost\b[:\s]+([OC])\b/i) || bodyText.match(/\b([OC])\s+(?:post|side)\b/i)
    if (postM) post = postM[1].toUpperCase()

    // Hall: derive from room if not explicit
    let hall = ''
    const hallM = bodyText.match(/\bhall\b[:\s]+((?:DH|NS)\s*\w+)/i)
    if (hallM) hall = hallM[1]

    // Work status
    const workM = bodyText.match(/\b(Cable\s*-\s*\w+|Optic\s*-\s*\w+|Needs\s+Cleaning|Awaiting\s+Parts|Open)\b/i)
    const work = workM ? workM[1] : 'Open'

    // Hosts and ports on the page
    const allHosts = extractHosts(bodyText)
    const allPorts = extractPorts(bodyText)

    // Pair up hosts and ports into links.
    // Cableguy shows "A host > B host" and "A port > B port"
    // We look for arrow/chevron separators in text nodes
    const links = []

    // Try to find link blocks: text like "ssw014... > fsw005..."
    const arrowPairs = [...bodyText.matchAll(
      /\b([a-z]{2,5}\d{2,4}\.[a-z]\d{2,4}\.m\d{2,4}\.\w+)\s*[>→]\s*([a-z]{2,5}\d{2,4}\.[a-z]\d{2,4}\.m\d{2,4}\.\w+)/gi
    )]

    for (const m of arrowPairs) {
      const aHost = m[1].toLowerCase()
      const bHost = m[2].toLowerCase()
      // Find ports near this text (within the same block)
      const startIdx = bodyText.indexOf(m[0])
      const nearby = bodyText.slice(Math.max(0, startIdx - 200), startIdx + m[0].length + 500)
      const ports = extractPorts(nearby)

      // Attempt to pull local and remote optic/iface/lldp data
      const localBlock  = extractBlock(body, 'Local',  aHost)
      const remoteBlock = extractBlock(body, 'Remote', bHost)

      const link = {
        a: { host: aHost, port: ports[0] || '' },
        b: { host: bHost, port: ports[1] || '' },
        local:  buildSide(localBlock,  aHost, bHost, ports[0], ports[1]),
        remote: buildSide(remoteBlock, bHost, aHost, ports[1], ports[0])
      }
      links.push(link)
    }

    // Fallback: if no arrow pairs found, pair first two unique hosts
    if (!links.length && allHosts.length >= 2) {
      const unique = [...new Set(allHosts)]
      links.push({
        a: { host: unique[0], port: allPorts[0] || '' },
        b: { host: unique[1], port: allPorts[1] || '' },
        local: null,
        remote: null
      })
    }

    const ticket = { id, hall, work, site, room, row, rack, elev, post, linked: [], links }

    // Mark capture time so bridge can detect fresh data
    ticket._scraped = Date.now()
    return ticket
  }

  // Find a text block on the page that is associated with a side label (Local/Remote)
  // and contains the given hostname, then return its text content.
  function extractBlock (root, sideLabel, hostname) {
    const labelRe = new RegExp(sideLabel, 'i')
    const hostRe  = new RegExp(hostname.replace(/\./g, '\\.'), 'i')
    const elements = root.querySelectorAll('*')
    for (const el of elements) {
      const t = text(el)
      if (labelRe.test(t) && (hostRe.test(t) || el.children.length < 10)) {
        if (el.children.length < 20 && t.length < 3000) return t
      }
    }
    return ''
  }

  // Build a side object (local or remote) from a block of text
  function buildSide (block, myHost, peerHost, myPort, peerPort) {
    if (!block) return null

    const rxLanes  = extractLanes(block, /\bRX\b/i) || extractLanes(block, /receive/i)
    const txLanes  = extractLanes(block, /\bTX\b/i) || extractLanes(block, /transmit/i)
    if (!rxLanes && !txLanes) return null

    const alarmM = block.match(/\[\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*\]/)
    const alarm  = alarmM ? [Number(alarmM[1]), Number(alarmM[2])] : [-7.2, 4.5]

    const vendorM = block.match(/([A-Za-z]+\s*\/\s*[A-Z0-9\-]+)/)
    const vendor  = vendorM ? vendorM[1] : ''

    const iface = extractIfaceStat(block)

    const lldpM = block.match(/([a-z]{2,5}\d{2,4}\.[a-z]\d{2,4}\.m\d{2,4}\.\w+:\w+\/\d+\/\d+)/i)
    const lldp  = lldpM ? lldpM[1].toLowerCase() : (peerHost && peerPort ? peerHost + ':' + peerPort : '')

    return {
      rx:     rxLanes  || [0, 0, 0, 0],
      tx:     txLanes  || [0, 0, 0, 0],
      alarm,
      vendor,
      admin:  iface.admin,
      oper:   iface.oper,
      inErr:  iface.inErr,
      outErr: iface.outErr,
      lldp
    }
  }

  // ---- send to background ----

  function sendTicket (ticket) {
    if (!ticket) return
    chrome.runtime.sendMessage({ type: 'TT_TICKET', ticket }, resp => {
      if (chrome.runtime.lastError) return // extension context invalidated, ignore
      if (resp && resp.ok) {
        showBanner(`Ticket Ticker: captured ${ticket.id} (${resp.count} total)`)
      }
    })
  }

  // ---- small page banner (non-intrusive, top-right) ----

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

  // ---- MutationObserver for live-updating values ----

  let scrapeTimer = null
  function scheduleScrape () {
    clearTimeout(scrapeTimer)
    scrapeTimer = setTimeout(() => {
      const ticket = scrape()
      if (ticket && ticket.links.length) sendTicket(ticket)
    }, 400) // debounce 400ms so we don't spam on rapid DOM updates
  }

  // Initial scrape after page loads
  scheduleScrape()

  // Watch for any DOM change (optic values, iface stats updating live)
  const observer = new MutationObserver(scheduleScrape)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })

})()

// Ticket Ticker Bridge — popup script

const $ = id => document.getElementById(id)

function render (tickets) {
  const n = tickets.length
  $('count').textContent = n
  $('dot').classList.toggle('active', n > 0)

  const list = $('ticketList')
  list.innerHTML = tickets.map(t => `
    <li>
      <span class="tid">${esc(t.id)}</span>
      <span class="hall">${esc(t.hall || '')} ${t.row ? 'R' + t.row : ''}</span>
    </li>
  `).join('')
}

function esc (s) {
  return String(s ?? '').replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

// Load on open
chrome.storage.local.get(['tt_tickets'], result => {
  render(result.tt_tickets || [])
})

// Live update while popup is open
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.tt_tickets) {
    render(changes.tt_tickets.newValue || [])
  }
})

// Open Ticket Ticker (localhost or GitHub Pages)
$('openApp').addEventListener('click', () => {
  // Try localhost first; if the user has it open elsewhere they can navigate manually
  chrome.tabs.create({ url: 'http://localhost:8080' })
})

// Clear all stored tickets
$('clearBtn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'TT_CLEAR' }, () => {
    render([])
  })
})

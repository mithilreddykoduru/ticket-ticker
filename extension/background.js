// Background service worker — receives scraped tickets from the Cableguy content script
// and stores them in chrome.storage.local so the bridge can push them into Ticket Ticker.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'TT_TICKET') {
    // Merge the incoming ticket into the stored list (replace if same id)
    chrome.storage.local.get(['tt_tickets'], result => {
      const tickets = result.tt_tickets || []
      const idx = tickets.findIndex(t => t.id === msg.ticket.id)
      if (idx !== -1) {
        tickets[idx] = msg.ticket
      } else {
        tickets.push(msg.ticket)
      }
      chrome.storage.local.set({ tt_tickets: tickets }, () => {
        sendResponse({ ok: true, count: tickets.length })
        // Update badge with total ticket count
        chrome.action.setBadgeText({ text: String(tickets.length) })
        chrome.action.setBadgeBackgroundColor({ color: '#4f8ef7' })
      })
    })
    return true // keep channel open for async sendResponse
  }

  if (msg.type === 'TT_CLEAR') {
    chrome.storage.local.set({ tt_tickets: [] }, () => {
      chrome.action.setBadgeText({ text: '' })
      sendResponse({ ok: true })
    })
    return true
  }

  if (msg.type === 'TT_GET') {
    chrome.storage.local.get(['tt_tickets'], result => {
      sendResponse({ tickets: result.tt_tickets || [] })
    })
    return true
  }
})

// Restore badge count on startup
chrome.storage.local.get(['tt_tickets'], result => {
  const n = (result.tt_tickets || []).length
  if (n > 0) {
    chrome.action.setBadgeText({ text: String(n) })
    chrome.action.setBadgeBackgroundColor({ color: '#4f8ef7' })
  }
})

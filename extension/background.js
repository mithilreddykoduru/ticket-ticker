// Background service worker — receives scraped tickets from the Cableguy content script,
// stores them in chrome.storage.local, and opens the board when the icon is clicked.

// Open (or focus) the board tab when the extension icon is clicked
chrome.action.onClicked.addListener(() => {
  const boardUrl = chrome.runtime.getURL('index.html')
  chrome.tabs.query({ url: boardUrl }, tabs => {
    if (tabs.length > 0) {
      // Board is already open — focus it
      chrome.tabs.update(tabs[0].id, { active: true })
      chrome.windows.update(tabs[0].windowId, { focused: true })
    } else {
      chrome.tabs.create({ url: boardUrl })
    }
  })
})

// Receive a scraped ticket from the Cableguy content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'TT_TICKET') {
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
        chrome.action.setBadgeText({ text: String(tickets.length) })
        chrome.action.setBadgeBackgroundColor({ color: '#4f8ef7' })
      })
    })
    return true
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

// Restore badge on browser restart
chrome.storage.local.get(['tt_tickets'], result => {
  const n = (result.tt_tickets || []).length
  if (n > 0) {
    chrome.action.setBadgeText({ text: String(n) })
    chrome.action.setBadgeBackgroundColor({ color: '#4f8ef7' })
  }
})

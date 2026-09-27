// Extension storage sync — runs after app.js when the board is loaded as a Chrome Extension page.
// Reads tickets from chrome.storage.local (written by the Cableguy scraper) into localStorage,
// then fires the tt-ext-sync event that app.js is already listening for.
//
// This file is only loaded when the page is running inside the extension
// (chrome-extension:// origin). On localhost or GitHub Pages it does nothing.

;(function () {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return

  function push (tickets) {
    if (!Array.isArray(tickets) || !tickets.length) return
    try {
      localStorage.setItem('tt.tickets', JSON.stringify(tickets))
      window.dispatchEvent(new CustomEvent('tt-ext-sync', { detail: { tickets } }))
    } catch (e) {}
  }

  // Pull whatever is already stored and push into the board
  chrome.storage.local.get(['tt_tickets'], result => {
    if (result.tt_tickets && result.tt_tickets.length) push(result.tt_tickets)
  })

  // Live updates: whenever the scraper captures a new ticket, push it immediately
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.tt_tickets) {
      push(changes.tt_tickets.newValue || [])
    }
  })
})()

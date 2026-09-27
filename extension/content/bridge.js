// Bridge content script injected into the Ticket Ticker page (localhost or GitHub Pages).
// It reads tickets from chrome.storage.local (written by the Cableguy scraper) and
// pushes them into the page's localStorage, then fires a custom event so app.js re-renders.

;(function () {
  'use strict'

  // Only run on pages that look like Ticket Ticker
  if (!document.querySelector('#app, #list, .halls, [data-tt]') &&
      !document.title.toLowerCase().includes('ticket')) {
    return
  }

  function push (tickets) {
    if (!Array.isArray(tickets) || !tickets.length) return
    try {
      localStorage.setItem('tt.tickets', JSON.stringify(tickets))
      // Notify the app without a full page reload
      window.dispatchEvent(new CustomEvent('tt-ext-sync', { detail: { tickets } }))
    } catch (e) {}
  }

  // On load: pull whatever is already stored
  chrome.storage.local.get(['tt_tickets'], result => {
    if (result.tt_tickets && result.tt_tickets.length) push(result.tt_tickets)
  })

  // Live updates: re-push whenever the extension captures a new/updated ticket
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.tt_tickets) {
      push(changes.tt_tickets.newValue || [])
    }
  })

})()

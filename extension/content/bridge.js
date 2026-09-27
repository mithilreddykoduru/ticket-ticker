;(function () {
  'use strict'

  // Only run on pages that look like Ticket Ticker
  if (!document.querySelector('#app, #list, .halls, [data-tt]') &&
      !document.title.toLowerCase().includes('ticket')) {
    return
  }

  console.log('[TT-Bridge] Bridge loaded on', location.href)

  function push (tickets) {
    if (!Array.isArray(tickets) || !tickets.length) return
    try {
      localStorage.setItem('tt.tickets', JSON.stringify(tickets))
      window.dispatchEvent(new CustomEvent('tt-ext-sync', { detail: { tickets } }))
      console.log('[TT-Bridge] Pushed', tickets.length, 'tickets into the app')
    } catch (e) { console.error('[TT-Bridge] Push error:', e) }
  }

  // On load: pull whatever is already stored
  chrome.storage.local.get(['tt_tickets'], result => {
    console.log('[TT-Bridge] On load, found', (result.tt_tickets || []).length, 'stored tickets')
    if (result.tt_tickets && result.tt_tickets.length) push(result.tt_tickets)
  })

  // Live updates: re-push whenever the extension captures a new/updated ticket
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.tt_tickets) {
      console.log('[TT-Bridge] Storage change — pushing updated tickets')
      push(changes.tt_tickets.newValue || [])
    }
  })

})()

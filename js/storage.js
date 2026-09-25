// localStorage can throw in private windows, so everything goes through here
window.TT = window.TT || {}

TT.store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem('tt.' + key)
      return raw == null ? fallback : JSON.parse(raw)
    } catch (e) {
      return fallback
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem('tt.' + key)
      else localStorage.setItem('tt.' + key, JSON.stringify(value))
    } catch (e) {}
  }
}

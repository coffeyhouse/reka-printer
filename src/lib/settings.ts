// Settings that belong to this phone (the rest live with the space).
export const store = {
  get(key: string, fallback: string) {
    try {
      const value = localStorage.getItem('mp_' + key)
      return value === null ? fallback : value
    } catch {
      return fallback
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem('mp_' + key, value)
    } catch {
      // Private browsing: the setting lasts until the page closes.
    }
  },
}

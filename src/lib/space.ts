// The family link. There is no sign-in: opening /s/<id> once makes this phone
// remember the id, and every request then carries it (see supabase.ts).

const KEY = 'ogprints.space'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The space from the link just opened, or the one this phone remembers. */
export function currentSpace(): string | null {
  const fromLink = location.pathname.match(/^\/s\/([^/]+)\/?$/)?.[1]
  if (fromLink && UUID.test(fromLink)) {
    try {
      localStorage.setItem(KEY, fromLink.toLowerCase())
    } catch {
      // Private browsing: the link still works for this visit.
    }
    // Keep the id out of the address bar, screenshots and the page title.
    history.replaceState(null, '', '/')
    return fromLink.toLowerCase()
  }
  try {
    const saved = localStorage.getItem(KEY)
    return saved && UUID.test(saved) ? saved : null
  } catch {
    return null
  }
}

export function forgetSpace() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to forget.
  }
}

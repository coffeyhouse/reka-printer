import { useEffect, useState } from 'react'
import { DEFAULT_BASE } from '../../supabase/functions/og-prints/prompts'
import { getSettings, giveBonus, type Quota, saveSettings } from '../lib/api'

interface Props {
  spaceId: string
  open: boolean
  onClose: () => void
  quota: Quota | null
  /** The limit or today's bonus changed. */
  onQuota: (quota?: Quota) => void
  dark: string
  onDark: (value: string) => void
  thick: string
  onThick: (value: string) => void
  onReconnect: () => void
  toast: (text: string) => void
}

/** The settings sheet, opened by holding the gear for 2 seconds. */
export default function GrownUps(props: Props) {
  const { spaceId, open, quota, toast } = props
  const [base, setBase] = useState(DEFAULT_BASE)
  const [limit, setLimit] = useState('')
  // What the space holds, so leaving a box unchanged saves nothing.
  const [saved, setSaved] = useState({ base: DEFAULT_BASE, limit: 0 })

  useEffect(() => {
    if (!open) return
    let current = true
    void getSettings(spaceId).then((settings) => {
      if (!current || !settings) return
      setBase(settings.base_prompt || DEFAULT_BASE)
      setLimit(String(settings.daily_limit))
      setSaved({ base: settings.base_prompt || DEFAULT_BASE, limit: settings.daily_limit })
    })
    return () => {
      current = false
    }
  }, [open, spaceId])

  function close() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    props.onClose()
  }

  async function saveBase() {
    const words = base.trim() || DEFAULT_BASE
    setBase(words)
    if (words === saved.base) return
    try {
      await saveSettings(spaceId, { base_prompt: words === DEFAULT_BASE ? null : words })
      setSaved((before) => ({ ...before, base: words }))
    } catch {
      toast("Couldn't save that")
    }
  }

  async function saveLimit() {
    const typed = parseInt(limit, 10)
    const value = typed > 0 ? Math.min(50, typed) : saved.limit
    setLimit(value ? String(value) : '')
    if (!value || value === saved.limit) return
    try {
      await saveSettings(spaceId, { daily_limit: value })
      setSaved((before) => ({ ...before, limit: value }))
      props.onQuota()
    } catch {
      toast("Couldn't save that")
    }
  }

  async function bonus() {
    try {
      const answer = await giveBonus(spaceId)
      if (!answer.quota) throw new Error()
      props.onQuota(answer.quota)
      toast('5 more drawings added for today')
    } catch {
      toast("Couldn't add more just now")
    }
  }

  return (
    <>
      <div className={open ? 'scrim open' : 'scrim'} onClick={close} />
      <div className={open ? 'sheet settings open' : 'sheet settings'} role="dialog" aria-label="Grown-up settings" inert={!open}>
        <div className="grab" />
        <div className="sheet-head">
          <h3>Grown-ups only</h3>
          <button className="done" onClick={close}>
            Done
          </button>
        </div>
        <div className="field">
          <label htmlFor="base">Always added to every picture</label>
          <textarea id="base" maxLength={600} value={base} onChange={(e) => setBase(e.target.value)} onBlur={() => void saveBase()} />
          <div className="note">Keeps every style child-friendly and printable. The kid picks the style on the main screen.</div>
        </div>
        <div className="field">
          <label htmlFor="dark">
            Print darkness <span>{props.dark}</span>
          </label>
          <input id="dark" type="range" min="40" max="140" step="5" value={props.dark} onChange={(e) => props.onDark(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="thick">Line thickness</label>
          <select id="thick" value={props.thick} onChange={(e) => props.onThick(e.target.value)}>
            <option value="0">Normal</option>
            <option value="1">Thick</option>
            <option value="2">Extra thick</option>
          </select>
          <div className="note">Fattens the lines before printing so they're easier to colour in.</div>
        </div>
        <div className="field">
          <label htmlFor="limit">
            Drawings per day <span>{quota ? `${quota.used} used today` : ''}</span>
          </label>
          <div className="row2">
            <input
              id="limit"
              type="number"
              min="1"
              max="50"
              inputMode="numeric"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              onBlur={() => void saveLimit()}
            />
            <button className="ghost" onClick={() => void bonus()}>
              Give 5 more today
            </button>
          </div>
          <div className="note">Counted for the whole family, on every phone. Starts again at midnight.</div>
        </div>
        <button className="ghost" onClick={props.onReconnect}>
          Reconnect printer
        </button>
        <div className="note">
          Opened by holding the gear for 2 seconds. Protocol test page: <a href="/test.html">test.html</a>
        </div>
      </div>
    </>
  )
}

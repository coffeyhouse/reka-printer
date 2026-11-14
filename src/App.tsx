import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import Gallery from './components/Gallery'
import GrownUps from './components/GrownUps'
import { draw, getStatus, loadImage, markPrinted, type Picture, type Quota, savePrintVersion, UnknownSpace } from './lib/api'
import { type Shape, shapeById, SHAPES, type Style, styleById, STYLES } from './lib/catalog'
import { renderPrint } from './lib/image'
import * as printer from './lib/printer'
import { store } from './lib/settings'
import { currentSpace } from './lib/space'
import { isConfigured } from './lib/supabase'

export default function App() {
  const [spaceId] = useState(currentSpace)
  const [locked, setLocked] = useState(false)
  if (!isConfigured) return <Closed title="Not set up yet" text="This site is missing its Supabase settings. See the README." />
  if (!spaceId || locked)
    return <Closed title="Ask a grown-up" text="This phone needs the family link. Ask a grown-up to open it here." />
  return <Studio spaceId={spaceId} onLocked={() => setLocked(true)} />
}

function Closed({ title, text }: { title: string; text: string }) {
  return (
    <div className="app">
      <header>
        <div className="brand">OG Prints</div>
      </header>
      <section className="stage empty">
        <div className="placeholder">
          <div className="bubble">
            <Pencil />
          </div>
          <h2>{title}</h2>
          <p>{text}</p>
        </div>
      </section>
    </div>
  )
}

interface Stage {
  kind: 'idle' | 'busy' | 'error' | 'rest' | 'image'
  title: string
  text: string
}
const IDLE: Stage = { kind: 'idle', title: 'What shall we draw?', text: 'Tap the microphone and say anything you like.' }
const REST: Stage = {
  kind: 'rest',
  title: 'Magic needs a rest!',
  text: "You've used all your drawings for today. Come back tomorrow for more!",
}
const PICTURE: Stage = { kind: 'image', title: '', text: '' }

type Chip = { state: 'off' | 'busy' | 'on'; text: string }
const CHIP_OFF: Chip = { state: 'off', text: 'Connect printer' }
const CHIP_ON: Chip = { state: 'on', text: 'Printer ready' }

/** The picture on the stage. */
interface Shown {
  img: HTMLImageElement
  picture: Picture
  style: Style
  shape: Shape
}

const pick = (id: string, list: { id: string }[], fallback: string) => (list.some((x) => x.id === id) ? id : fallback)

function Studio({ spaceId, onLocked }: { spaceId: string; onLocked: () => void }) {
  const [stage, setStage] = useState<Stage>(IDLE)
  const [result, setResult] = useState(false) // New / Try again / Print! instead of mic / Draw it!
  const [idea, setIdeaText] = useState('')
  const [styleId, setStyleId] = useState(() => pick(store.get('styleId', ''), STYLES, 'colour'))
  const [shapeId, setShapeId] = useState(() => pick(store.get('shapeId', ''), SHAPES, 'tall'))
  const [thick, setThick] = useState(() => store.get('thick', '1'))
  // The slider moves in fives from 40, so the old app's "93" always went to the printer as 95.
  const [dark, setDark] = useState(() => store.get('dark', '95'))
  const [quota, setQuota] = useState<Quota | null>(null)
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [chip, setChip] = useState<Chip>(CHIP_OFF)
  const [toastText, setToastText] = useState('')
  const [toastOn, setToastOn] = useState(false)
  const [sheet, setSheet] = useState<'none' | 'settings' | 'gallery'>('none')
  const [holding, setHolding] = useState(false)
  const [drawn, setDrawn] = useState(0) // counts renders of the preview, so it gets fitted

  const stageRef = useRef<HTMLElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const gearRef = useRef<HTMLButtonElement>(null)
  const shown = useRef<Shown | null>(null)
  const rows = useRef<Uint8Array[] | null>(null)
  const working = useRef(false)
  // What the speech and timer callbacks need, as it is now rather than when they were made.
  const now = useRef({ idea, styleId, shapeId, thick, quota })
  now.current = { idea: now.current.idea, styleId, shapeId, thick, quota }

  const setIdea = (text: string) => {
    now.current.idea = text
    setIdeaText(text)
  }

  const toastTimer = useRef(0)
  const toast = useCallback((text: string) => {
    setToastText(text)
    setToastOn(true)
    clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastOn(false), 2000)
  }, [])

  // ---------- the daily limit (counted on the server) ----------
  const refreshQuota = useCallback(async () => {
    try {
      const answer = await getStatus(spaceId)
      if (answer.quota) setQuota(answer.quota)
    } catch (error) {
      if (error instanceof UnknownSpace) onLocked()
    }
  }, [spaceId, onLocked])
  useEffect(() => {
    void refreshQuota()
    // Picks up the midnight reset, and drawings made on the other phone.
    const timer = setInterval(() => void refreshQuota(), 10 * 60000)
    const onShow = () => {
      if (document.visibilityState === 'visible') void refreshQuota()
    }
    document.addEventListener('visibilitychange', onShow)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onShow)
    }
  }, [refreshQuota])

  // ---------- the preview ----------
  // Size the preview to fit the card whatever its shape. Wide, Banner and Long
  // run down the paper, so they are shown turned back the right way up.
  const fitPreview = useCallback(() => {
    const canvas = canvasRef.current
    const card = stageRef.current
    if (!canvas || !card || !shown.current) return
    const turned = shown.current.shape.rotate && canvas.height > canvas.width
    const maxW = card.clientWidth - 36
    const maxH = card.clientHeight - 36
    const k = turned ? Math.min(maxW / canvas.height, maxH / canvas.width) : Math.min(maxW / canvas.width, maxH / canvas.height)
    canvas.style.width = Math.floor(canvas.width * k) + 'px'
    canvas.style.height = Math.floor(canvas.height * k) + 'px'
    canvas.style.transform = `translate(-50%, -50%)${turned ? ' rotate(-90deg)' : ''}`
  }, [])
  useLayoutEffect(fitPreview, [fitPreview, stage.kind, drawn])
  useEffect(() => {
    window.addEventListener('resize', fitPreview)
    return () => window.removeEventListener('resize', fitPreview)
  }, [fitPreview])

  function render(next: Shown, grow: string) {
    rows.current = renderPrint(canvasRef.current!, next.img, {
      rotate: next.shape.rotate,
      dither: next.style.dither,
      grow: parseInt(grow, 10) || 0,
    })
    setDrawn((n) => n + 1)
  }

  function show(next: Shown) {
    const before = shown.current
    if (before && before.img.src !== next.img.src) URL.revokeObjectURL(before.img.src)
    shown.current = next
    render(next, now.current.thick)
    setStage(PICTURE)
    setResult(true)
    // Keep the print version too, the first time a picture is seen.
    if (!next.picture.print_path) void savePrintVersion(spaceId, next.picture, canvasRef.current!)
  }

  function idle() {
    setStage(IDLE)
    setResult(false)
  }

  // ---------- drawing ----------
  async function generate() {
    if (working.current) return
    const words = now.current.idea.trim()
    if (!words) {
      inputRef.current?.focus()
      setStage({ kind: 'idle', title: 'What shall we draw?', text: 'Say or type an idea first!' })
      return
    }
    if (now.current.quota && now.current.quota.left <= 0) {
      setStage(REST)
      setResult(false)
      return
    }
    working.current = true
    setBusy(true)
    setStage({ kind: 'busy', title: 'Drawing…', text: `“${words}”` })
    try {
      let style = styleById(now.current.styleId)
      const surprise = style.id === 'random'
      if (surprise) {
        const pool = STYLES.filter((x) => x.id !== 'random')
        style = pool[Math.floor(Math.random() * pool.length)]
      }
      const shape = shapeById(now.current.shapeId)
      const answer = await draw(spaceId, words, style.id, shape.id)
      if (answer.quota) setQuota(answer.quota)
      if (answer.error === 'limit') {
        setStage(REST)
        setResult(false)
        return
      }
      if (answer.error || !answer.picture) throw new Error(answer.message || 'Something went wrong. Try again in a minute.')
      const img = await loadImage(spaceId, answer.picture.original_path)
      show({ img, picture: answer.picture, style, shape })
      if (surprise) toast(`Surprise: ${style.e} ${style.name}`)
    } catch (error) {
      if (error instanceof UnknownSpace) return onLocked()
      setStage({ kind: 'error', title: 'Oops!', text: error instanceof Error ? error.message : String(error) })
      setResult(false)
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  function startNew() {
    setIdea('')
    shown.current = null
    rows.current = null
    idle()
  }

  // A picture from the gallery goes back on the stage, ready to print again.
  async function open(picture: Picture) {
    if (working.current) return
    setSheet('none')
    working.current = true
    setBusy(true)
    setStage({ kind: 'busy', title: 'Getting it…', text: `“${picture.idea}”` })
    try {
      const img = await loadImage(spaceId, picture.original_path)
      setIdea(picture.idea)
      if (STYLES.some((x) => x.id === picture.style)) chooseStyle(picture.style)
      if (SHAPES.some((x) => x.id === picture.shape)) chooseShape(picture.shape)
      show({ img, picture, style: styleById(picture.style), shape: shapeById(picture.shape) })
    } catch (error) {
      setStage({ kind: 'error', title: 'Oops!', text: error instanceof Error ? error.message : String(error) })
      setResult(false)
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  function chooseStyle(id: string) {
    setStyleId(id)
    store.set('styleId', id)
    setResult(false) // new style -> draw again
  }
  function chooseShape(id: string) {
    setShapeId(id)
    store.set('shapeId', id)
    setResult(false)
  }

  // ---------- speech ----------
  const SR = useRef<any>(null)
  const rec = useRef<any>(null)
  useEffect(() => {
    const w = window as any
    SR.current = store.get('noSR', '0') === '1' ? null : w.SpeechRecognition || w.webkitSpeechRecognition || null
  }, [])
  function keyboardMic() {
    inputRef.current?.focus()
    setStage({ kind: 'idle', title: 'Use the keyboard mic', text: 'Tap the microphone on the keyboard, talk, then tap Draw it!' })
  }
  function talk() {
    if (!SR.current) return keyboardMic()
    if (rec.current) return rec.current.stop()
    const r = new SR.current()
    rec.current = r
    r.lang = 'en-GB'
    r.interimResults = true
    r.maxAlternatives = 1
    let failed = false
    let started = 0
    r.onresult = (e: any) => setIdea(Array.from(e.results as ArrayLike<any>, (x) => x[0].transcript).join(' '))
    r.onerror = (e: any) => {
      failed = true
      // Bluefy has the API but it fails at once: use the keyboard's own mic from then on.
      if (e.error !== 'no-speech' && e.error !== 'aborted' && (Date.now() - started < 1500 || /allowed|capture|network/.test(e.error))) {
        SR.current = null
        store.set('noSR', '1')
        keyboardMic()
      } else setStage({ kind: 'error', title: "Didn't catch that", text: 'Tap the microphone and try again.' })
    }
    r.onend = () => {
      setListening(false)
      rec.current = null
      if (!failed && now.current.idea.trim()) void generate()
    }
    setListening(true)
    setStage({ kind: 'idle', title: 'Listening…', text: 'Say what you want to draw.' })
    try {
      started = Date.now()
      r.start()
    } catch {
      rec.current = null
      SR.current = null
      setListening(false)
      keyboardMic()
    }
  }

  // ---------- printer ----------
  useEffect(() => {
    printer.onDisconnected(() => setChip(CHIP_OFF))
    return () => printer.onDisconnected(() => {})
  }, [])
  // Must stay synchronous up to printer.connect(): the browser only shows the
  // printer picker straight from a tap.
  async function connectPrinter() {
    if (!printer.hasBluetooth()) {
      setStage({ kind: 'error', title: 'Wrong browser', text: 'Open this page in Bluefy (iPhone) or Chrome (Android).' })
      return false
    }
    setChip({ state: 'busy', text: 'Connecting…' })
    const ok = await printer.connect()
    setChip(ok ? CHIP_ON : CHIP_OFF)
    if (!ok) toast("Couldn't connect – is it on?")
    return ok
  }
  function reconnect() {
    setSheet('none')
    printer.disconnect()
    void connectPrinter()
  }
  async function print() {
    if (!rows.current || working.current) return
    if (!printer.isConnected() && !(await connectPrinter())) return
    working.current = true
    setBusy(true)
    setChip({ state: 'busy', text: 'Printing…' })
    try {
      await printer.printRows(rows.current, Number(dark))
      toast('Printed! 🎉')
      if (shown.current) void markPrinted(spaceId, shown.current.picture.id)
    } catch (error) {
      toast((error instanceof Error && error.message) || 'Printing problem')
    } finally {
      working.current = false
      setBusy(false)
      setChip(printer.isConnected() ? CHIP_ON : CHIP_OFF)
    }
  }

  // ---------- grown-up settings (hold the gear for 2 seconds) ----------
  useEffect(() => {
    const gear = gearRef.current!
    let timer = 0
    const start = (e: Event) => {
      e.preventDefault()
      setHolding(true)
      timer = window.setTimeout(() => {
        timer = 0
        setHolding(false)
        setSheet('settings')
      }, 2000)
    }
    const end = () => {
      setHolding(false)
      if (timer) {
        clearTimeout(timer)
        timer = 0
        toast('Grown-ups: hold for 2 seconds')
      }
    }
    const leave = () => {
      if (timer) end()
    }
    const menu = (e: Event) => e.preventDefault()
    // Added by hand: React's own touch listeners are passive and cannot preventDefault.
    gear.addEventListener('touchstart', start, { passive: false })
    gear.addEventListener('touchend', end)
    gear.addEventListener('touchcancel', end)
    gear.addEventListener('mousedown', start)
    gear.addEventListener('mouseup', end)
    gear.addEventListener('mouseleave', leave)
    gear.addEventListener('contextmenu', menu)
    return () => {
      clearTimeout(timer)
      gear.removeEventListener('touchstart', start)
      gear.removeEventListener('touchend', end)
      gear.removeEventListener('touchcancel', end)
      gear.removeEventListener('mousedown', start)
      gear.removeEventListener('mouseup', end)
      gear.removeEventListener('mouseleave', leave)
      gear.removeEventListener('contextmenu', menu)
    }
  }, [toast])

  function changeThick(value: string) {
    setThick(value)
    store.set('thick', value)
    if (shown.current) render(shown.current, value)
  }
  function changeDark(value: string) {
    setDark(value)
    store.set('dark', value)
  }
  function quotaChanged(next?: Quota) {
    if (!next) return void refreshQuota()
    setQuota(next)
    if (stage.kind === 'rest' && next.left > 0) idle()
  }

  const badge = quota && <span className={quota.left <= 3 ? 'badge low' : 'badge'}>{quota.left} left</span>
  const picture = stage.kind === 'image'

  return (
    <>
      <div className="app">
        <header>
          <div className="brand">OG Prints</div>
          <div className="hdr-right">
            <button
              className={`chip ${chip.state}`}
              onClick={() => (printer.isConnected() ? toast('Printer is connected') : void connectPrinter())}
            >
              <span className="dot" />
              <span>{chip.text}</span>
            </button>
            <button ref={gearRef} className={holding ? 'gear holding' : 'gear'} aria-label="Grown-up settings (hold for 2 seconds)">
              <Gear />
            </button>
          </div>
        </header>

        <section ref={stageRef} className={stage.kind === 'idle' ? 'stage empty' : 'stage'}>
          {!picture && (
            <div className="placeholder">
              <div className={stage.kind === 'busy' ? 'bubble wiggle' : 'bubble'}>
                <Pencil />
              </div>
              <h2>{stage.title}</h2>
              <p className={stage.kind === 'error' ? 'err' : undefined}>{stage.text}</p>
              {stage.kind !== 'busy' && !listening && (
                <button className="mine" onClick={() => setSheet('gallery')}>
                  <Pictures />
                  My pictures
                </button>
              )}
            </div>
          )}
          <canvas ref={canvasRef} className="preview" width="384" height="384" style={{ display: picture ? 'block' : 'none' }} />
          <div className={toastOn ? 'toast show' : 'toast'}>{toastText}</div>
        </section>

        <div className="styles" role="group" aria-label="Picture style">
          {STYLES.map((style) => (
            <button key={style.id} className="style" aria-pressed={style.id === styleId} onClick={() => chooseStyle(style.id)}>
              <span className="e" aria-hidden="true">
                {style.e}
              </span>
              {style.name}
            </button>
          ))}
        </div>
        <div className="shapes" role="group" aria-label="Picture shape">
          {SHAPES.map((shape) => (
            <button key={shape.id} className="shape" aria-pressed={shape.id === shapeId} onClick={() => chooseShape(shape.id)}>
              <span className="pic" aria-hidden="true">
                <i style={{ width: shape.icon[0], height: shape.icon[1] }} />
              </span>
              {shape.name}
            </button>
          ))}
        </div>

        <input
          ref={inputRef}
          className="idea"
          type="text"
          aria-label="Your idea"
          placeholder="A dragon eating ice cream…"
          enterKeyHint="go"
          autoComplete="off"
          maxLength={300}
          value={idea}
          onChange={(e) => {
            setIdea(e.target.value)
            setResult(false)
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            e.currentTarget.blur()
            void generate()
          }}
        />

        {result ? (
          <div className="actions">
            <button className="btn new" onClick={startNew}>
              <Plus />
              New
            </button>
            <button className="btn again" disabled={busy} onClick={() => void generate()}>
              <Again />
              Try again
              {badge}
            </button>
            <button className="btn print" disabled={busy} onClick={() => void print()}>
              <Printer />
              Print!
            </button>
          </div>
        ) : (
          <div className="actions">
            <button className={listening ? 'btn mic listening' : 'btn mic'} aria-label="Talk" onClick={talk}>
              <Mic />
            </button>
            <button className="btn draw" disabled={busy} onClick={() => void generate()}>
              <Sparkles />
              Draw it!
              {badge}
            </button>
          </div>
        )}
      </div>

      <Gallery spaceId={spaceId} open={sheet === 'gallery'} onClose={() => setSheet('none')} onPick={(p) => void open(p)} />
      <GrownUps
        spaceId={spaceId}
        open={sheet === 'settings'}
        onClose={() => setSheet('none')}
        quota={quota}
        onQuota={quotaChanged}
        dark={dark}
        onDark={changeDark}
        thick={thick}
        onThick={changeThick}
        onReconnect={reconnect}
        toast={toast}
      />
    </>
  )
}

// ---------- icons ----------
const line = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

const Pencil = () => (
  <svg width="42" height="42" viewBox="0 0 24 24" {...line} stroke="#1D2340" strokeWidth="1.8">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
)
const Gear = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" {...line} strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)
const Pictures = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" {...line} strokeWidth="2.2">
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="9" cy="9" r="1.6" />
    <path d="m21 15-4.6-4.6L5 21" />
  </svg>
)
const Mic = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" {...line} strokeWidth="2.2">
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10a7 7 0 0 0 14 0" />
    <path d="M12 17v4" />
    <path d="M8 21h8" />
  </svg>
)
const Sparkles = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" {...line} strokeWidth="2.2">
    <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </svg>
)
const Plus = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" {...line} strokeWidth="2.4">
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
)
const Again = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" {...line} strokeWidth="2.2">
    <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
)
const Printer = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" {...line} strokeWidth="2.2">
    <path d="M6 9V2h12v7" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </svg>
)

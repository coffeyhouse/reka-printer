// The Reka mini printer over Bluetooth (MXW01 protocol on BLE service AE30).
// Ported unchanged from the single-file app, where it was verified against the
// real printer in Bluefy on iPhone. See HANDOVER.md before changing anything:
// the odd-looking parts are Bluefy workarounds.

// Web Bluetooth has no built-in types.
type Characteristic = any

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const CRC = (() => {
  const t = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 0x80 ? ((c << 1) ^ 7) & 255 : (c << 1) & 255
    t[i] = c
  }
  return t
})()
export const crc8 = (data: ArrayLike<number>) => {
  let c = 0
  for (let i = 0; i < data.length; i++) c = CRC[(c ^ data[i]) & 255]
  return c
}
/** A command packet: 22 21 <cmd> 00 <len lo> <len hi> <data…> <crc8(data)> FF */
export function mxw(cmd: number, data: number[]) {
  const p = new Uint8Array(8 + data.length)
  p.set([0x22, 0x21, cmd, 0, data.length & 255, data.length >> 8])
  p.set(data, 6)
  p[6 + data.length] = crc8(data)
  p[7 + data.length] = 0xff
  return p
}
// Bluefy needs the full 128-bit UUID, and reports them in more than one form.
const U = (id: string) => `0000${id}-0000-1000-8000-00805f9b34fb`
const shortId = (uuid: unknown) => {
  const u = String(uuid).toLowerCase()
  return u.length > 8 ? u.slice(4, 8) : u.padStart(4, '0').slice(-4)
}

/** Blank lines fed after the picture so it clears the tear edge. */
export const FEED_LINES = 100

let device: any = null
let ctrl: Characteristic = null
let dataCh: Characteristic = null
let onLost: () => void = () => {}

interface Waiter {
  cmd: number
  res: (msg: { cmd: number; data: Uint8Array }) => void
}
const waiters: Waiter[] = []
function waitFor(cmd: number, ms: number) {
  return new Promise<{ cmd: number; data: Uint8Array }>((res, rej) => {
    const w = { cmd, res }
    waiters.push(w)
    setTimeout(() => {
      const i = waiters.indexOf(w)
      if (i >= 0) {
        waiters.splice(i, 1)
        rej(new Error('timeout'))
      }
    }, ms)
  })
}
function onNotify(e: any) {
  const b = new Uint8Array(e.target.value.buffer)
  if (b[0] !== 0x22 || b[1] !== 0x21) return
  const len = b[4] | (b[5] << 8)
  const msg = { cmd: b[2], data: b.slice(6, 6 + len) }
  for (const w of [...waiters])
    if (w.cmd === msg.cmd) {
      waiters.splice(waiters.indexOf(w), 1)
      w.res(msg)
    }
}
async function send(ch: Characteristic, bytes: Uint8Array) {
  if (ch.writeValueWithoutResponse) await ch.writeValueWithoutResponse(bytes)
  else await ch.writeValue(bytes)
}

export const hasBluetooth = () => Boolean((navigator as any).bluetooth)
export const isConnected = () => Boolean(ctrl)
/** Called when the printer drops the connection (switched off, out of range). */
export function onDisconnected(callback: () => void) {
  onLost = callback
}

/** Shows the browser's printer picker and connects. Must be called from a tap. */
export async function connect(): Promise<boolean> {
  const bluetooth = (navigator as any).bluetooth
  try {
    const optionalServices = [U('ae30')]
    try {
      device = await bluetooth.requestDevice({ filters: [{ namePrefix: 'Reka' }], optionalServices })
    } catch (e: any) {
      // Bluefy can throw a bare `2` for a filtered request: ask again for any device.
      if (e && e.name === 'NotFoundError' && /cancel/i.test(e.message || '')) throw e
      device = await bluetooth.requestDevice({ acceptAllDevices: true, optionalServices })
    }
    device.addEventListener('gattserverdisconnected', () => {
      ctrl = dataCh = null
      onLost()
    })
    const server = await device.gatt.connect()
    const svc = await server.getPrimaryService(U('ae30'))
    const chars: Record<string, Characteristic> = {}
    for (const c of await svc.getCharacteristics()) chars[shortId(c.uuid)] = c
    ctrl = chars.ae01
    dataCh = chars.ae03 || chars.ae01
    if (!ctrl || !chars.ae02) throw new Error("That doesn't look like the Reka printer.")
    await chars.ae02.startNotifications()
    chars.ae02.addEventListener('characteristicvaluechanged', onNotify)
    return true
  } catch {
    ctrl = dataCh = null
    return false
  }
}

export function disconnect() {
  try {
    if (device && device.gatt.connected) device.gatt.disconnect()
  } catch {
    // Already gone.
  }
  ctrl = dataCh = null
}

/** Prints the rows (48 bytes each). `darkness` is the printer's intensity (the app's default is 95). */
export async function printRows(picture: Uint8Array[], darkness: number) {
  const rows = picture.slice()
  for (let i = 0; i < FEED_LINES; i++) rows.push(new Uint8Array(48))
  const n = rows.length
  await send(ctrl, mxw(0xa2, [darkness & 255]))
  await sleep(80)
  const st = waitFor(0xa1, 2500).catch(() => null)
  await send(ctrl, mxw(0xa1, [0]))
  await st
  const ok = waitFor(0xa9, 3000)
  await send(ctrl, mxw(0xa9, [n & 255, n >> 8, 0x30, 0x00]))
  const r = await ok.catch(() => null)
  if (r && r.data[0] !== 0) throw new Error('Printer said no – check the paper and battery.')
  for (let i = 0; i < n; i++) {
    await send(dataCh, rows[i])
    await sleep(8)
  }
  // Long banners are still printing when the last line is sent: give them longer.
  const done = waitFor(0xaa, Math.max(30000, n * 20)).catch(() => null)
  await send(ctrl, mxw(0xad, [0]))
  await done
}

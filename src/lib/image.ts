// Picture -> the 1-bit rows the printer takes. Ported unchanged from the
// single-file app: same sizes, same threshold, same line fattening.

/** The printer's dots across the paper (48 mm at 8 dots per mm). */
export const WIDTH = 384
/** The printer refuses very short jobs. */
export const MIN_LINES = 90

export interface PrintOptions {
  /** Turn a landscape picture 90° so its long side runs down the paper. */
  rotate: boolean
  /** Floyd–Steinberg shading instead of a plain threshold. */
  dither: boolean
  /** Passes of line fattening, 0 to 2. Ignored when dithering, where it would just go dark. */
  grow: number
}

/** Brightness per pixel -> 1 for black, 0 for white. `lum` is used as scratch space when dithering. */
export function toBlack(lum: Float32Array, width: number, height: number, dither: boolean, grow: number) {
  // 1) black/white
  let black = new Uint8Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const old = lum[i]
      const on = dither ? old < 128 : old < 170
      black[i] = on ? 1 : 0
      if (dither) {
        const err = old - (on ? 0 : 255)
        if (x + 1 < width) lum[i + 1] += (err * 7) / 16
        if (y + 1 < height) {
          if (x > 0) lum[i + width - 1] += (err * 3) / 16
          lum[i + width] += (err * 5) / 16
          if (x + 1 < width) lum[i + width + 1] += err / 16
        }
      }
    }
  // 2) fatten lines for colouring in
  const passes = dither ? 0 : Math.max(0, Math.min(2, grow))
  for (let pass = 0; pass < passes; pass++) {
    const out = new Uint8Array(black)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (black[i]) continue
        if (
          (x > 0 && black[i - 1]) ||
          (x + 1 < width && black[i + 1]) ||
          (y > 0 && black[i - width]) ||
          (y + 1 < height && black[i + width])
        )
          out[i] = 1
      }
    black = out
  }
  return black
}

/** One Uint8Array of width/8 bytes per line, LSB-first (MXW01), 1 = black. */
export function packRows(black: Uint8Array, width: number, height: number) {
  const rows: Uint8Array[] = []
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(width / 8)
    for (let x = 0; x < width; x++) if (black[y * width + x]) row[x >> 3] |= 1 << (x & 7)
    rows.push(row)
  }
  return rows
}

/** Draws the print version of `img` on `canvas` (384 wide) and returns its rows. */
export function renderPrint(canvas: HTMLCanvasElement, img: HTMLImageElement, options: PrintOptions) {
  const rotate = options.rotate && img.naturalWidth > img.naturalHeight
  const iw = rotate ? img.naturalHeight : img.naturalWidth
  const ih = rotate ? img.naturalWidth : img.naturalHeight
  const h = Math.max(MIN_LINES, Math.round((ih * WIDTH) / iw))
  canvas.width = WIDTH
  canvas.height = h
  const g = canvas.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, WIDTH, h)
  if (rotate) {
    g.save()
    g.translate(WIDTH, 0)
    g.rotate(Math.PI / 2)
    g.drawImage(img, 0, 0, h, WIDTH)
    g.restore()
  } else g.drawImage(img, 0, 0, WIDTH, h)
  const id = g.getImageData(0, 0, WIDTH, h)
  const p = id.data
  const lum = new Float32Array(WIDTH * h)
  for (let i = 0; i < lum.length; i++) lum[i] = 0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2]
  const black = toBlack(lum, WIDTH, h, options.dither, options.grow)
  for (let i = 0; i < black.length; i++) p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = black[i] ? 0 : 255
  g.putImageData(id, 0, 0)
  return packRows(black, WIDTH, h)
}

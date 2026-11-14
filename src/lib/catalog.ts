// What the boys can pick. The words sent to the AI for each one live on the
// server (supabase/functions/og-prints/prompts.ts); the ids must match.

export interface Style {
  id: string
  e: string
  name: string
  /** Keep pencil-style shading (dithered) instead of pure black and white. */
  dither: boolean
}

// Every style must print well on a black-and-white thermal printer and be easy to colour in.
export const STYLES: Style[] = [
  { id: 'colour', e: '🖍️', name: 'Colouring', dither: false },
  { id: 'cartoon', e: '😄', name: 'Cartoon', dither: false },
  { id: 'sticker', e: '⭐', name: 'Sticker', dither: false },
  { id: 'pixel', e: '👾', name: 'Pixel', dither: false },
  { id: 'comic', e: '💥', name: 'Comic', dither: false },
  { id: 'sketch', e: '✏️', name: 'Sketch', dither: true },
  { id: 'random', e: '🎲', name: 'Surprise!', dither: false },
]

export interface Shape {
  id: string
  name: string
  /** A landscape picture turned 90° so it runs down the paper. */
  rotate: boolean
  icon: [number, number]
}

// Paper is 48 mm wide; length is unlimited.
export const SHAPES: Shape[] = [
  { id: 'square', name: 'Square', rotate: false, icon: [15, 15] },
  { id: 'tall', name: 'Tall', rotate: false, icon: [11, 18] },
  { id: 'wide', name: 'Wide', rotate: true, icon: [22, 13] },
  { id: 'banner', name: 'Banner', rotate: true, icon: [30, 9] },
  { id: 'long', name: 'Long', rotate: true, icon: [44, 7] },
]

export const styleById = (id: string) => STYLES.find((style) => style.id === id) ?? STYLES[0]
export const shapeById = (id: string) => SHAPES.find((shape) => shape.id === id) ?? SHAPES[1]

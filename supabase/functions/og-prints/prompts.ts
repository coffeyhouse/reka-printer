// What the AI is asked for. The app only sends the idea and the names of the
// style and shape; the words live here so they cannot be changed from a phone.

export const DEFAULT_BASE =
  'A friendly picture suitable for young children, made to be coloured in with crayons. Black and white only, plain white background, no grey, no words or letters unless the style asks for them.'

const THICK =
  'Use VERY thick, bold, smooth black outlines like a fat marker pen, simple big shapes and large empty white areas to colour in, with very little tiny detail.'

// Every style must print well on a black-and-white thermal printer and be easy to colour in.
export const STYLE_PROMPTS: Record<string, string> = {
  colour: `A colouring-book page for young children. ${THICK} No shading and no filled black areas.`,
  cartoon: `A bold, funny cartoon like a Saturday-morning TV show, big expressive faces. ${THICK} Only tiny touches of solid black, like pupils.`,
  sticker: `A cute kawaii sticker design with chunky rounded shapes and big shiny eyes, and an extra-thick black outline around the whole sticker. ${THICK}`,
  pixel:
    'A retro 8-bit pixel-art colouring page: big chunky square pixels drawn as thick black outlines with white insides to colour in, like an arcade game sprite. No filled black areas.',
  comic: `A classic superhero comic book panel: dynamic action pose, speed lines and motion lines, a jagged starburst explosion shape behind the action, and one big comic sound-effect word such as POW, ZOOM, BAM or WHOOSH in huge bold outlined bubble letters. A thick black panel border around the picture. ${THICK} Bold black ink like a comic inker, no grey and no dot shading.`,
  sketch:
    "A pencil sketch with soft shading, like a drawing in an artist's sketchbook, with strong dark outlines.",
}

// Paper is 48 mm wide; length is unlimited. Wide, Banner and Long are turned
// 90° by the app so they run down the paper.
export const SHAPE_PROMPTS: Record<string, { ratio: string; words: string }> = {
  square: { ratio: '1:1', words: 'Square composition.' },
  tall: { ratio: '9:16', words: 'Tall portrait composition, the subject fills the whole height.' },
  wide: { ratio: '16:9', words: 'Wide landscape composition, a whole scene from side to side.' },
  banner: {
    ratio: '4:1',
    words: 'Very wide panoramic banner composition, a long scene stretching from left to right.',
  },
  long: {
    ratio: '8:1',
    words:
      'Extremely wide panoramic banner composition, a very long scene stretching from left to right with lots of different things along it.',
  },
}

export const MAX_IDEA = 300

export function buildPrompt(style: string, shape: string, base: string | null, idea: string) {
  return `${STYLE_PROMPTS[style]}\n${base?.trim() || DEFAULT_BASE}\n${SHAPE_PROMPTS[shape].words}\nDraw: ${idea}`
}

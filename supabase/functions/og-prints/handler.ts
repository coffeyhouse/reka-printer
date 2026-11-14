/**
 * og-prints: the server side of OG Prints, as one Edge Function.
 *   status — today's drawings: { quota }
 *   draw   — an idea, a style and a shape -> a stored picture: { picture, quota }
 *   bonus  — "Give 5 more today": { quota }
 *
 * This is where the Gemini key lives and where the daily limit is counted, so
 * neither can be got round from a phone.
 *
 * OG Prints has no sign-in: every request names a space in the x-space-id
 * header, and that space must exist. Expected failures (the limit, a picture
 * that would not draw) answer 200 with { error, message }, because supabase-js
 * turns any other status into an opaque error.
 *
 * Everything that touches Deno or the environment comes in through `Deps`, so
 * the handler can be tested as is.
 */
import { type Generated, NoPicture } from './gemini.ts'
import { buildPrompt, MAX_IDEA, SHAPE_PROMPTS, STYLE_PROMPTS } from './prompts.ts'

export interface Quota {
  limit: number
  used: number
  bonus: number
  left: number
}

export interface Space {
  id: string
  base_prompt: string | null
}

export interface NewPicture {
  id: string
  space_id: string
  idea: string
  style: string
  shape: string
  model: string
  original_path: string
}

export interface Deps {
  /** Today in the UK, YYYY-MM-DD: the limit resets at UK midnight. */
  today: () => string
  space: (spaceId: string) => Promise<Space | null>
  quota: (spaceId: string, day: string) => Promise<Quota>
  reserve: (spaceId: string, day: string) => Promise<Quota & { ok: boolean }>
  refund: (spaceId: string, day: string) => Promise<Quota>
  addBonus: (spaceId: string, day: string, extra: number) => Promise<Quota>
  /** This month's AI spend has reached the monthly budget. */
  overBudget: () => Promise<boolean>
  generate: (prompt: string, ratio: string) => Promise<Generated>
  /** Stores the image and its row, and returns the row as the app reads it. */
  save: (picture: NewPicture, image: Generated) => Promise<unknown>
  logUsage: (spaceId: string, image: Generated) => Promise<void>
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-space-id',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export async function handle(request: Request, deps: Deps): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'POST only.' }, 405)

  const spaceId = request.headers.get('x-space-id') ?? ''
  const space = UUID.test(spaceId) ? await deps.space(spaceId) : null
  if (!space) return json({ error: 'Unknown space.' }, 401)

  const body = await request.json().catch(() => null)
  const day = deps.today()
  try {
    if (body?.action === 'status') return json({ quota: await deps.quota(space.id, day) })
    if (body?.action === 'bonus') return json({ quota: await deps.addBonus(space.id, day, 5) })
    if (body?.action === 'draw') return json(await draw(space, day, body, deps))
    return json({ error: 'Unknown action.' }, 400)
  } catch (error) {
    console.error(error)
    return json({ error: 'failed', message: 'Something went wrong. Try again in a minute.' })
  }
}

async function draw(space: Space, day: string, body: Record<string, unknown>, deps: Deps) {
  const idea = typeof body.idea === 'string' ? body.idea.trim().slice(0, MAX_IDEA) : ''
  const style = String(body.style ?? '')
  const shape = String(body.shape ?? '')
  if (!idea || !Object.hasOwn(STYLE_PROMPTS, style) || !Object.hasOwn(SHAPE_PROMPTS, shape)) {
    return { error: 'failed', message: 'Say or type an idea first!' }
  }
  if (await deps.overBudget()) {
    return {
      error: 'budget',
      message: "That's all the drawings for this month. A grown-up can raise the monthly budget.",
      quota: await deps.quota(space.id, day),
    }
  }
  const { ok, ...quota } = await deps.reserve(space.id, day)
  if (!ok) {
    return {
      error: 'limit',
      message: "You've used all your drawings for today. Come back tomorrow for more!",
      quota,
    }
  }

  let image: Generated
  try {
    image = await deps.generate(buildPrompt(style, shape, space.base_prompt, idea), SHAPE_PROMPTS[shape].ratio)
  } catch (error) {
    // A drawing that never arrived doesn't count.
    const refunded = await deps.refund(space.id, day)
    if (!(error instanceof NoPicture)) console.error(error)
    return {
      error: 'failed',
      message: error instanceof NoPicture ? error.message : "The drawing machine is having a wobble. Try again!",
      quota: refunded,
    }
  }

  // Logged before saving: the money is spent whether or not the save works.
  await deps.logUsage(space.id, image).catch((error) => console.error(error))
  const id = crypto.randomUUID()
  const picture = await deps.save(
    {
      id,
      space_id: space.id,
      idea,
      style,
      shape,
      model: image.model,
      original_path: `${space.id}/${id}.${EXTENSION[image.mime] ?? 'png'}`,
    },
    image,
  )
  return { picture, quota }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

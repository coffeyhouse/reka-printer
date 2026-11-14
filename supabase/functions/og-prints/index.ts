// Deno entry point for the og-prints Edge Function: wires the handler to the
// environment. Everything else lives in handler.ts so it can be tested.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   GEMINI_API_KEY                   — Google AI Studio; shared with the other
//                                      apps in this project
//   OG_PRINTS_IMAGE_MODEL            — optional, default gemini-nano-banana-2.1
//   OG_PRINTS_MONTHLY_BUDGET_GBP     — optional, default 5
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { generateImage } from './gemini.ts'
import { handle, type Quota } from './handler.ts'

const env = (name: string) => Deno.env.get(name) ?? undefined
const BUCKET = 'og-prints-media'
const FALLBACK_MODEL = 'gemini-2.5-flash-image'

const admin = () =>
  createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, {
    db: { schema: 'og_prints' },
    auth: { persistSession: false },
  })

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin().rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data as T
}

const ukDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' })

Deno.serve((request) =>
  handle(request, {
    today: () => ukDay.format(new Date()),
    space: async (spaceId) => {
      const { data, error } = await admin().from('spaces').select('id, base_prompt').eq('id', spaceId).maybeSingle()
      if (error) throw new Error(`spaces: ${error.message}`)
      return data
    },
    quota: (spaceId, day) => rpc<Quota>('quota', { p_space: spaceId, p_day: day }),
    reserve: (spaceId, day) => rpc<Quota & { ok: boolean }>('reserve_draw', { p_space: spaceId, p_day: day }),
    refund: (spaceId, day) => rpc<Quota>('refund_draw', { p_space: spaceId, p_day: day }),
    addBonus: (spaceId, day, extra) => rpc<Quota>('add_bonus', { p_space: spaceId, p_day: day, p_extra: extra }),
    // The key and the budget are shared by every space.
    overBudget: async () => {
      const start = new Date()
      start.setUTCDate(1)
      start.setUTCHours(0, 0, 0, 0)
      const { data, error } = await admin().from('ai_usage').select('est_cost_gbp').gte('created_at', start.toISOString())
      if (error) throw new Error(`ai_usage: ${error.message}`)
      const spent = (data ?? []).reduce((sum, row) => sum + Number(row.est_cost_gbp ?? 0), 0)
      return spent >= Number(env('OG_PRINTS_MONTHLY_BUDGET_GBP') ?? 5)
    },
    generate: (prompt, ratio) => {
      const model = env('OG_PRINTS_IMAGE_MODEL') ?? 'gemini-nano-banana-2.1'
      return generateImage(
        { apiKey: env('GEMINI_API_KEY'), models: model === FALLBACK_MODEL ? [model] : [model, FALLBACK_MODEL] },
        prompt,
        ratio,
      )
    },
    save: async (picture, image) => {
      const db = admin()
      const upload = await db.storage.from(BUCKET).upload(picture.original_path, image.bytes, { contentType: image.mime })
      if (upload.error) throw new Error(`upload: ${upload.error.message}`)
      const { data, error } = await db.from('pictures').insert(picture).select().single()
      if (error) throw new Error(`pictures: ${error.message}`)
      return data
    },
    logUsage: async (spaceId, image) => {
      const { error } = await admin().from('ai_usage').insert({
        space_id: spaceId,
        task: 'draw',
        model: image.model,
        input_tokens: image.inputTokens,
        output_tokens: image.outputTokens,
        est_cost_gbp: image.costGbp,
      })
      if (error) throw new Error(`ai_usage: ${error.message}`)
    },
  }),
)

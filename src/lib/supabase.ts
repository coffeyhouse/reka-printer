import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && anonKey)

export const MEDIA_BUCKET = 'og-prints-media'

function makeClient(spaceId: string) {
  return createClient(url!, anonKey!, {
    db: { schema: 'og_prints' },
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-space-id': spaceId } },
  })
}

/** Client bound to the `og_prints` schema and one space's header. */
export type OgClient = ReturnType<typeof makeClient>

/**
 * One client per space. Every request carries the space id as a header, which is
 * what the row level security policies match on — see supabase/schema.sql.
 */
const clients = new Map<string, OgClient>()

export function getClient(spaceId: string): OgClient {
  const existing = clients.get(spaceId)
  if (existing) return existing
  const client = makeClient(spaceId)
  clients.set(spaceId, client)
  return client
}

/** Public URL for a stored picture. */
export function mediaUrl(spaceId: string, path: string): string {
  return getClient(spaceId).storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl
}

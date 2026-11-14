// The og-prints Edge Function and the pictures table.
import { getClient, MEDIA_BUCKET, mediaUrl } from './supabase'

export interface Quota {
  limit: number
  used: number
  bonus: number
  left: number
}

export interface Picture {
  id: string
  idea: string
  style: string
  shape: string
  original_path: string
  print_path: string | null
  width: number | null
  height: number | null
  created_at: string
}

/** The family link on this phone no longer matches a space. */
export class UnknownSpace extends Error {}

interface Answer {
  error?: 'limit' | 'budget' | 'failed'
  message?: string
  quota?: Quota
  picture?: Picture
}

async function call(spaceId: string, body: Record<string, unknown>): Promise<Answer> {
  const { data, error } = await getClient(spaceId).functions.invoke('og-prints', { body })
  if (error) {
    if ((error as { context?: Response }).context?.status === 401) throw new UnknownSpace()
    throw new Error("Can't reach the drawing machine. Check the internet and try again.")
  }
  return data as Answer
}

export const getStatus = (spaceId: string) => call(spaceId, { action: 'status' })
export const giveBonus = (spaceId: string) => call(spaceId, { action: 'bonus' })
export const draw = (spaceId: string, idea: string, style: string, shape: string) =>
  call(spaceId, { action: 'draw', idea, style, shape })

const PICTURE_COLUMNS = 'id, idea, style, shape, original_path, print_path, width, height, created_at'
export const PAGE = 30

/** Newest first, one page at a time. */
export async function listPictures(spaceId: string, from: number): Promise<Picture[]> {
  const { data, error } = await getClient(spaceId)
    .from('pictures')
    .select(PICTURE_COLUMNS)
    .order('created_at', { ascending: false })
    .range(from, from + PAGE - 1)
  if (error) throw new Error(error.message)
  return data as Picture[]
}

/**
 * Loads a stored picture for the canvas. Fetched as a blob so the canvas can
 * always read its pixels back (an <img> from another site can taint it).
 */
export async function loadImage(spaceId: string, path: string): Promise<HTMLImageElement> {
  const response = await fetch(mediaUrl(spaceId, path))
  if (!response.ok) throw new Error("Couldn't load that picture.")
  const img = new Image()
  img.src = URL.createObjectURL(await response.blob())
  await img.decode()
  return img
}

/** Stores the print version next to the original, once. */
export async function savePrintVersion(spaceId: string, picture: Picture, canvas: HTMLCanvasElement) {
  // The canvas is reused for the next picture: take its size and pixels now.
  const { width, height } = canvas
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return
  const client = getClient(spaceId)
  const path = `${spaceId}/${picture.id}-print.png`
  const upload = await client.storage.from(MEDIA_BUCKET).upload(path, blob, { contentType: 'image/png' })
  if (upload.error) return
  const { error } = await client.from('pictures').update({ print_path: path, width, height }).eq('id', picture.id)
  if (!error) picture.print_path = path
}

export async function markPrinted(spaceId: string, pictureId: string) {
  await getClient(spaceId).rpc('mark_printed', { picture_id: pictureId })
}

export interface SpaceSettings {
  daily_limit: number
  base_prompt: string | null
}

export async function getSettings(spaceId: string): Promise<SpaceSettings | null> {
  const { data } = await getClient(spaceId).from('spaces').select('daily_limit, base_prompt').maybeSingle()
  return data as SpaceSettings | null
}

export async function saveSettings(spaceId: string, changes: Partial<SpaceSettings>) {
  const { error } = await getClient(spaceId).from('spaces').update(changes).eq('id', spaceId)
  if (error) throw new Error(error.message)
}

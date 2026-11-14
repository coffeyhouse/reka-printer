// One picture from Gemini's image model ("Nano Banana"), with what it cost.

export interface Generated {
  bytes: Uint8Array
  mime: string
  model: string
  inputTokens: number
  outputTokens: number
  costGbp: number
}

/** A failure worth showing to a child as is. */
export class NoPicture extends Error {}

// gemini-nano-banana-2.1, US$ per million tokens: 1.50 in, 7.50 text and
// thinking out, 30 image out; a 1K picture is 1,120 image tokens (Google's
// pricing page, checked 14 November 2026). £ at roughly 0.8 per dollar.
const RATES_USD = { input: 1.5, text: 7.5, image: 30 }

// deno-lint-ignore no-explicit-any
export function costGbp(usage: any): number {
  const image = (usage?.candidatesTokensDetails ?? [])
    // deno-lint-ignore no-explicit-any
    .filter((d: any) => d.modality === 'IMAGE')
    // deno-lint-ignore no-explicit-any
    .reduce((sum: number, d: any) => sum + (d.tokenCount ?? 0), 0)
  const text = Math.max(0, (usage?.candidatesTokenCount ?? 0) - image) + (usage?.thoughtsTokenCount ?? 0)
  const usd =
    ((usage?.promptTokenCount ?? 0) * RATES_USD.input + text * RATES_USD.text + image * RATES_USD.image) / 1e6
  return usd * 0.8
}

// Tried in order until Google stops answering 400. The first asks for the
// shape and for no "thinking" (it adds about a fifth to the cost and five
// seconds, for no visible gain on line drawings); older models may refuse
// either, and the last sends neither (the prompt still describes the shape).
const VARIANTS: ((ratio: string) => Record<string, unknown>)[] = [
  (ratio) => ({ imageConfig: { aspectRatio: ratio }, thinkingConfig: { thinkingLevel: 'minimal' } }),
  (ratio) => ({ imageConfig: { aspectRatio: ratio } }),
  () => ({}),
]

export async function generateImage(
  config: { apiKey: string | undefined; models: string[]; fetch?: typeof fetch },
  prompt: string,
  ratio: string,
): Promise<Generated> {
  if (!config.apiKey) throw new Error('GEMINI_API_KEY is not set')
  const doFetch = config.fetch ?? fetch
  let problem = 'No image model answered.'
  for (const model of config.models) {
    for (const variant of VARIANTS) {
      const response = await doFetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ['IMAGE', 'TEXT'], ...variant(ratio) },
          }),
          signal: AbortSignal.timeout(100_000),
        },
      )
      const json = await response.json().catch(() => ({}))
      if (!response.ok) {
        problem = `Gemini ${response.status}: ${String(json?.error?.message ?? '').slice(0, 200)}`
        if (response.status === 400) continue
        if (response.status === 404) break
        throw new Error(problem)
      }
      // deno-lint-ignore no-explicit-any
      const part = (json.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.inlineData?.data)
      if (!part) throw new NoPicture('No picture came back – try asking a different way.')
      const usage = json.usageMetadata
      return {
        bytes: Uint8Array.from(atob(part.inlineData.data), (c) => c.charCodeAt(0)),
        mime: part.inlineData.mimeType ?? 'image/png',
        model,
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
        costGbp: costGbp(usage),
      }
    }
  }
  throw new Error(problem)
}

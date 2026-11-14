import { assertEquals } from 'jsr:@std/assert@1'
import { type Generated, NoPicture } from './gemini.ts'
import { type Deps, handle, type NewPicture } from './handler.ts'

const SPACE = '11111111-2222-4333-8444-555555555555'
const image: Generated = {
  bytes: new Uint8Array([1, 2, 3]),
  mime: 'image/jpeg',
  model: 'test-model',
  inputTokens: 100,
  outputTokens: 1500,
  costGbp: 0.03,
}

/** A space with `limit` drawings a day and everything recorded in `log`. */
function fake(over: Partial<Deps> = {}, limit = 2) {
  const log: string[] = []
  let used = 0
  let bonus = 0
  const quota = () => ({ limit, used, bonus, left: Math.max(0, limit + bonus - used) })
  const saved: NewPicture[] = []
  const prompts: string[] = []
  const deps: Deps = {
    today: () => '2026-11-14',
    space: (id) => Promise.resolve(id === SPACE ? { id, base_prompt: null } : null),
    quota: () => Promise.resolve(quota()),
    reserve: () => {
      const ok = used < limit + bonus
      if (ok) used++
      return Promise.resolve({ ...quota(), ok })
    },
    refund: () => {
      used--
      log.push('refund')
      return Promise.resolve(quota())
    },
    addBonus: (_space, _day, extra) => {
      bonus += extra
      return Promise.resolve(quota())
    },
    overBudget: () => Promise.resolve(false),
    generate: (prompt, ratio) => {
      prompts.push(`${ratio}|${prompt}`)
      log.push('generate')
      return Promise.resolve(image)
    },
    save: (picture) => {
      saved.push(picture)
      return Promise.resolve(picture)
    },
    logUsage: () => {
      log.push('usage')
      return Promise.resolve()
    },
    ...over,
  }
  const call = async (body: unknown, space = SPACE) => {
    const response = await handle(
      new Request('http://x/og-prints', {
        method: 'POST',
        headers: { 'x-space-id': space },
        body: JSON.stringify(body),
      }),
      deps,
    )
    return { status: response.status, body: await response.json() }
  }
  return { call, log, saved, prompts }
}

const dragon = { action: 'draw', idea: ' a dragon ', style: 'colour', shape: 'banner' }

Deno.test('a space nobody made is refused', async () => {
  const { call, log } = fake()
  assertEquals((await call(dragon, '99999999-2222-4333-8444-555555555555')).status, 401)
  assertEquals((await call(dragon, "x' or 1=1")).status, 401)
  assertEquals(log, [])
})

Deno.test('a drawing is stored, logged and counted', async () => {
  const { call, log, saved, prompts } = fake()
  const { body } = await call(dragon)
  assertEquals(body.quota, { limit: 2, used: 1, bonus: 0, left: 1 })
  assertEquals(log, ['generate', 'usage'])
  assertEquals(saved[0].idea, 'a dragon')
  assertEquals(saved[0].original_path, `${SPACE}/${saved[0].id}.jpg`)
  assertEquals(prompts[0].startsWith('4:1|A colouring-book page'), true)
  assertEquals(prompts[0].endsWith('Draw: a dragon'), true)
})

Deno.test('the daily limit stops the AI being asked', async () => {
  const { call, log } = fake({}, 1)
  await call(dragon)
  const { body } = await call(dragon)
  assertEquals(body.error, 'limit')
  assertEquals(body.quota.left, 0)
  assertEquals(log, ['generate', 'usage'])
  // "Give 5 more today" lets it carry on.
  assertEquals((await call({ action: 'bonus' })).body.quota.left, 5)
  assertEquals((await call(dragon)).body.error, undefined)
})

Deno.test("a drawing that fails doesn't use up a go", async () => {
  const { call, log } = fake({ generate: () => Promise.reject(new NoPicture('No picture came back.')) })
  const { body } = await call(dragon)
  assertEquals(body.error, 'failed')
  assertEquals(body.message, 'No picture came back.')
  assertEquals(body.quota.used, 0)
  assertEquals(log, ['refund'])
})

Deno.test('the monthly budget stops everything', async () => {
  const { call, log } = fake({ overBudget: () => Promise.resolve(true) })
  assertEquals((await call(dragon)).body.error, 'budget')
  assertEquals(log, [])
})

Deno.test('only known styles and shapes reach the prompt', async () => {
  const { call, log } = fake()
  assertEquals((await call({ ...dragon, style: 'constructor' })).body.error, 'failed')
  assertEquals((await call({ ...dragon, shape: 'huge' })).body.error, 'failed')
  assertEquals((await call({ ...dragon, idea: '   ' })).body.error, 'failed')
  assertEquals(log, [])
})

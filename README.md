# OG Prints

A drawing machine for Oliver and George. A child says or types an idea, picks
a style and a shape, the AI draws a thick-lined black-and-white picture, and it
prints on a Reka mini thermal printer over Bluetooth so they can colour it in.
Every picture is kept in **My pictures**, so it can be printed again.

`HANDOVER.md` has the verified printer protocol, the Bluefy quirks and the
reasons behind the choices below. Read it before changing anything to do with
Bluetooth.

## How it fits together

| Part | Where | What it does |
| --- | --- | --- |
| The app | Vercel (Vite + React + TypeScript, `src/`) | The one screen, the 1-bit conversion, Web Bluetooth printing |
| `og-prints` Edge Function | Supabase (`supabase/functions/og-prints/`) | Holds the Gemini key, counts the daily limit, draws, stores the original |
| Database | Supabase, schema `og_prints` (`supabase/schema.sql`) | Pictures, the family's settings, the daily count, AI spend |
| Storage | Supabase bucket `og-prints-media` | `<space>/<picture>.jpg` (what the AI drew) and `<space>/<picture>-print.png` (384 dots wide, as printed) |

The Supabase project is the one shared with Bookworm and Giftly. Printing
never touches a server: the phone talks to the printer itself.

`test.html` is the Bluetooth protocol test page. It is copied into the build
untouched and served at `/test.html`. Don't change it.

## The family link (there is no sign-in)

The app only works on a phone that has opened the family link once:

    https://<site>/s/<space id>

The id is saved on the phone and dropped from the address bar. It is sent with
every request as an `x-space-id` header; row level security only returns rows
for that space, and the function refuses any id it doesn't know. **The link is
the key: never put it in this repo** (the repo is public), an issue or a
screenshot.

A space is made by hand, because every drawing spends money:

    supabase db query --linked "insert into og_prints.spaces default values returning id;"

If the link ever gets out, the only lock is to delete that space row and make
a new one. The gallery list goes with it, so treat the link like a house key.

## Running it

    cp .env.example .env.local     # fill in from Supabase -> Settings -> API
    npm install
    npm run dev

| Variable | Where | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `.env.local`, Vercel | Safe in the browser |
| `VITE_SUPABASE_ANON_KEY` | `.env.local`, Vercel | Safe in the browser |
| `GEMINI_API_KEY` | Supabase Edge Function secrets | Already set for the other apps. Never in the browser, never in this repo |
| `OG_PRINTS_IMAGE_MODEL` | Supabase secrets, optional | Default `gemini-nano-banana-2.1` |
| `OG_PRINTS_MONTHLY_BUDGET_GBP` | Supabase secrets, optional | Default `5`. Drawing stops for the month when the estimated spend reaches it |

A picture costs about 3p. The daily limit (default 15, set in the grown-up
settings) is shared by everyone on the link and starts again at UK midnight.

## Setting up the shared Supabase project (once)

    supabase link --project-ref <ref>
    supabase db query --linked -f supabase/schema.sql      # safe to run again
    supabase functions deploy og-prints --project-ref <ref> --no-verify-jwt

Then in the dashboard: **Settings -> API -> Exposed schemas**, add `og_prints`.

**Never run `supabase config push` from this repo.** It would overwrite the
settings of the project the other apps rely on. There are no migrations here
for the same reason: Bookworm owns the project's migration history.

## Vercel

Import the repo, framework preset Vite, and set the two `VITE_` variables.
`vercel.json` sends every path to the app so the family link works.

## Checks

    npm run check          # types, image tests (vitest), function tests (deno)
    supabase db query --linked -f supabase/tests/rls.sql

`rls.sql` proves that one space cannot see or touch another's rows or files,
and that the limit counts properly. It runs in one transaction and rolls
itself back, so it leaves nothing behind.

## The old version

The single-file app still runs on GitHub Pages from the `pages-legacy` branch
(https://coffeyhouse.github.io/reka-printer/), with its key on the phone. It
stays until the Vercel version has been proven on the real printer.

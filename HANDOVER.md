# OG Prints – handover

A kids' app for Oliver and George Coffey ("OG" = their initials). A child says or types an idea, picks a style and shape, AI draws a thick-lined black-and-white picture, and it prints on a cheap Bluetooth thermal printer so they can colour it in.

Current state (14 November 2026): a Vite + React app in `src/`, built for Vercel, with the shared Supabase project behind it (schema `og_prints`, bucket `og-prints-media`, Edge Function `og-prints`). `README.md` has the layout, setup and deploy steps. `test.html` is the Bluetooth protocol test page we used to find the right protocol. Keep it working and unchanged: it's the debugging tool.

The original single-file app is on the `pages-legacy` branch and still serves https://coffeyhouse.github.io/reka-printer/ until the new one has been proven on the real printer.

## Where this phase got to

Done and checked against a local Supabase stack with a stand-in printer (not yet on the real project or the real printer):

1. Vercel project structure. The Bluetooth code (`src/lib/printer.ts`) and the picture code (`src/lib/image.ts`) are straight ports; for the same picture, every byte sent to the printer matches the old app.
2. Shared Supabase backend, following Bookworm and Giftly: own schema, no sign-in (a family link holding an unguessable space id, sent as `x-space-id`, enforced by row level security), one Edge Function, a public bucket with unguessable paths.
3. Every picture is stored (the original and the print version) and shown in **My pictures**; tapping one brings it back ready to print, for free.
4. The Gemini key lives in the Edge Function's secrets. The daily limit, the "give 5 more today" bonus and a monthly spend cap are counted there.

Still to do:

5. **Picture search**: an unofficial DuckDuckGo image search ("<idea> colouring page", strict safe search) as a free alternative to AI generation. It must run in the Edge Function, not on Vercel (Giftly found DuckDuckGo refuses Vercel's servers); Giftly's `supabase/functions/giftly/imageSearch.ts` and `safeFetch.ts` are the model. The function has to fetch the chosen image too (CORS, and the canvas needs untainted pixels). Searches don't count towards the daily limit. `pictures.source` and `source_url` are already there for it.
6. Favourites and deleting from the gallery (`pictures.favourite` exists; nothing can be deleted yet).

Decisions Warren made: no sign-in, one secret family link; one shared gallery and one shared daily limit (no profiles); the Gemini key the other apps already use.

## Hard constraints

- **Bluetooth printing must stay in the browser** (Web Bluetooth). The server can't reach the printer. Image → 1-bit conversion can stay client-side too.
- **iPhone = Bluefy browser** (Safari has no Web Bluetooth). Android/desktop Chrome also work. Test in Bluefy.
- **Whole UI fits on one phone screen**, big touch targets, made for young kids. Grown-up settings are hidden behind a gear you **hold for 2 seconds**.
- Never commit secrets. The repo is public: that includes the family link.

## Printer facts (verified on the real device)

- Reka "Mini Thermal Printer" (UK, sold by Quesh, product code 744108), normally used with the "Fun Print" app. Firmware reports `1.9.3.2.2`.
- BLE name: `Reka`. Advertises service `AF30`; GATT exposes **`AE30`** with characteristics `ae01` (write without response, control), `ae02` (notify), `ae03` (write without response, **image data**), `ae04` (notify), `ae05` (indicate), `ae10` (read/write); plus a service `AE3A` (`ae3b` write, `ae3c` notify) that isn't used.
- Protocol = **MXW01-style** (the classic `51 78` cat-printer protocol and ESC/POS do **not** work):
  - Packet: `22 21 <cmd> 00 <lenLo> <lenHi> <data…> <crc8(data)> FF`. CRC-8 polynomial 0x07, init 0, over the data bytes only.
  - Sequence: `A2 [intensity]` (default 95 = 0x5F; the old app's setting said 93, but its slider moved in fives from 40, so 95 is what the printer has always been sent) → `A1 [00]` status (reply on ae02) → `A9 [linesLo, linesHi, 0x30, 0x00]` print request (reply `A9` with data[0] = 0 means OK) → send each row (48 bytes = 384 dots, **LSB-first** bit order, 1 = black) to **ae03**, ~8 ms apart → `AD [00]` flush → wait for an `AA` "print complete" notification.
  - 384 dots wide (48 mm). At least 90 lines. We add 100 blank lines at the end so the picture clears the tear edge.
  - Prints come out upside-down to someone facing the printer. That's normal.

## Bluefy quirks (handled in `src/lib/printer.ts` and `src/App.tsx`; don't regress them)

- `requestDevice` with filters sometimes throws a bare `2`. Fall back to `acceptAllDevices: true`.
- Use full 128-bit UUID strings for `optionalServices` (numeric ones broke the chooser).
- Bluefy reports short UUIDs (`AE30`), while Chrome reports full ones. Normalise with `shortId()`.
- `webkitSpeechRecognition` exists but fails instantly. Fall back to the iOS keyboard's dictation mic (a flag is remembered in localStorage).
- The printer picker only opens straight from a tap: nothing may be awaited between the tap and `requestDevice`.

## Features

- **Styles** (child picks): Colouring, Cartoon, Sticker, Pixel, Comic, Sketch, Surprise (random). The list is in `src/lib/catalog.ts`; the words sent to the AI for each are on the server in `supabase/functions/og-prints/prompts.ts`. All except Sketch ask for very thick marker-pen outlines with big white areas, because the kids colour them in. Sketch uses Floyd–Steinberg dithering.
- **Shapes**: Square 1:1, Tall 9:16 (default), Wide 16:9, Banner 4:1, Long 8:1. Wide, Banner and Long are **rotated 90°** so they print larger down the paper; a Long picture is about 40 cm of paper. On screen they are shown the right way up.
- **Prompt** = style prompt + grown-up "always added" line + shape wording + `Draw: <idea>`. Only the idea and the ids of the style and shape come from the phone.
- **Model**: `gemini-nano-banana-2.1`, falling back to `gemini-2.5-flash-image` (legacy, retiring 2027-03-15) on a 404. Endpoint: `v1beta/models/<model>:generateContent`, header `x-goog-api-key`, image returned in `candidates[0].content.parts[].inlineData`. **The shape goes in `generationConfig.imageConfig.aspectRatio`** (confirmed). `thinkingConfig.thinkingLevel: 'minimal'` saves about a fifth of the cost and five seconds with no visible difference on line drawings: about 3p and 9 seconds a picture.
- **Image processing** (on the phone): scale to 384 wide → threshold (luminance < 170 is black) or dither → **line thickening** by 0/1/2 px dilation (grown-up "Line thickness" setting, default Thick) → pack rows. The print version is uploaded once, the first time a picture is shown.
- Flow: idle → drawing (wiggling pencil) → preview with **New / Try again / Print!**. Printer status chip in the header (tap to connect). Daily limit badge on the Draw/Try again buttons. **My pictures** opens the gallery.
- Grown-up settings (hold the gear for 2 seconds): "always added" prompt line and drawings per day plus "give 5 more today" (both kept on the server, for every phone); print darkness (40–140) and line thickness (kept on the phone); reconnect printer.
- Look: app name **OG Prints**; fonts Fredoka (headings) + Nunito; ground `#EEF3FF`, ink `#1D2340`, mic `#E8412F`, Draw `#0E7C66`, Print `#FFC93C`; chunky rounded buttons with a solid drop shadow.

## Other image models

OpenAI's `gpt-image-2.5-flare` was looked at as a cheaper option (the homework cards app uses it). It can't make the Long shape: its widest picture is 3:1, and each side must be a multiple of 16 pixels (so `1536x512`). A side-by-side trial didn't run because the only OpenAI key to hand had expired. Gemini's pictures were good across every style and shape, so it stays.

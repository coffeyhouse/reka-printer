# OG Prints – handover

A kids' app for Oliver and George Coffey ("OG" = their initials). A child says or types an idea, picks a style and shape, AI draws a thick-lined black-and-white picture, and it prints on a cheap Bluetooth thermal printer so they can colour it in.

Current state: a single static page (`index.html`) on GitHub Pages at https://coffeyhouse.github.io/reka-printer/, used on an iPhone in the **Bluefy** browser. Everything runs in the browser, and the Gemini API key is stored in the phone's localStorage. `test.html` is the Bluetooth protocol test page we used to find the right protocol. Keep it working: it's the debugging tool.

## Goal of this next phase

1. **Host on Vercel**, with a proper project structure (any framework is fine; it must still work as a plain web page in Bluefy).
2. **Use the shared Supabase backend** that's already used for other family apps (see `coffeyhouse/bookworm`, `coffeyhouse/gift-planning-app` ("Giftly") and others). Look at those repos first and follow their conventions for project setup, auth, table naming/schemas, storage buckets, env vars and RLS.
3. **Store every generated picture** so it can be reprinted later: a gallery/history screen with a big "Print again" button.
4. **Move the Gemini API key server-side** (Vercel function or Supabase Edge Function). No API keys in the browser.
5. **Enforce the daily limit server-side** (currently 15/day in localStorage, with a grown-up "give 5 more today" bonus).
6. **(Next, planned) Picture search**: an unofficial DuckDuckGo image search ("<idea> colouring page", strict safe search) as a free alternative to AI generation. It needs a server-side proxy for both the search and fetching the chosen image (CORS, and the canvas needs untainted pixels). Searches should not count towards the daily limit.

## Hard constraints

- **Bluetooth printing must stay in the browser** (Web Bluetooth). The server can't reach the printer. Image → 1-bit conversion can stay client-side too.
- **iPhone = Bluefy browser** (Safari has no Web Bluetooth). Android/desktop Chrome also work. Test in Bluefy.
- **Whole UI fits on one phone screen**, big touch targets, made for young kids. Grown-up settings are hidden behind a gear you **hold for 2 seconds**.
- Never commit secrets.

## Printer facts (verified on the real device)

- Reka "Mini Thermal Printer" (UK, sold by Quesh, product code 744108), normally used with the "Fun Print" app. Firmware reports `1.9.3.2.2`.
- BLE name: `Reka`. Advertises service `AF30`; GATT exposes **`AE30`** with characteristics `ae01` (write without response, control), `ae02` (notify), `ae03` (write without response, **image data**), `ae04` (notify), `ae05` (indicate), `ae10` (read/write); plus a service `AE3A` (`ae3b` write, `ae3c` notify) that isn't used.
- Protocol = **MXW01-style** (the classic `51 78` cat-printer protocol and ESC/POS do **not** work):
  - Packet: `22 21 <cmd> 00 <lenLo> <lenHi> <data…> <crc8(data)> FF`. CRC-8 polynomial 0x07, init 0, over the data bytes only.
  - Sequence: `A2 [intensity]` (default 93 = 0x5D) → `A1 [00]` status (reply on ae02) → `A9 [linesLo, linesHi, 0x30, 0x00]` print request (reply `A9` with data[0] = 0 means OK) → send each row (48 bytes = 384 dots, **LSB-first** bit order, 1 = black) to **ae03**, ~8 ms apart → `AD [00]` flush → wait for an `AA` "print complete" notification.
  - 384 dots wide (48 mm). At least 90 lines. We add 100 blank lines at the end so the picture clears the tear edge.
  - Prints come out upside-down to someone facing the printer. That's normal.

## Bluefy quirks (already handled in index.html; don't regress them)

- `requestDevice` with filters sometimes throws a bare `2`. Fall back to `acceptAllDevices: true`.
- Use full 128-bit UUID strings for `optionalServices` (numeric ones broke the chooser).
- Bluefy reports short UUIDs (`AE30`), while Chrome reports full ones. Normalise with `shortId()`.
- `webkitSpeechRecognition` exists but fails instantly. Fall back to the iOS keyboard's dictation mic (a flag is remembered in localStorage).

## Current features (index.html)

- **Styles** (child picks): Colouring, Cartoon, Sticker, Pixel, Comic, Sketch, Surprise (random). Each has its own prompt text in `STYLES`. All except Sketch ask for very thick marker-pen outlines with big white areas, because the kids colour them in. Sketch uses Floyd–Steinberg dithering.
- **Shapes**: Square 1:1, Tall 9:16 (default), Wide 16:9, Banner 4:1. Wide and Banner are **rotated 90°** so they print larger down the paper. The aspect-ratio request format for Nano Banana 2.1 is unclear in Google's docs, so `askGemini()` tries `generationConfig.imageConfig.aspectRatio`, then `generationConfig.responseFormat.image.aspectRatio`, then no ratio, and remembers what worked. **Confirm which is correct** and simplify.
- **Prompt** = style prompt + grown-up "always added" safety line + shape wording + `Draw: <idea>`.
- **Model**: `gemini-nano-banana-2.1` (latest, about $0.034/image), falling back to `gemini-2.5-flash-image` (legacy, retiring 2027-03-15) on a 404. Endpoint: `v1beta/models/<model>:generateContent`, header `x-goog-api-key`, image returned in `candidates[0].content.parts[].inlineData`.
- **Image processing**: scale to 384 wide → threshold (luminance < 170 is black) or dither → **line thickening** by 0/1/2 px dilation (grown-up "Line thickness" setting, default Thick) → pack rows.
- Flow: idle → drawing (wiggling pencil) → preview with **New / Try again / Print!**. Printer status chip in the header (tap to connect). Daily limit badge on the Draw/Try again buttons.
- Grown-up settings: API key, model, "always added" prompt line, print darkness (40–140), line thickness, drawings per day plus "give 5 more today", reconnect printer.
- Look: app name **OG Prints**; fonts Fredoka (headings) + Nunito; ground `#EEF3FF`, ink `#1D2340`, mic `#E8412F`, Draw `#0E7C66`, Print `#FFC93C`; chunky rounded buttons with a solid drop shadow.

## Suggested data model (adapt to the shared backend's conventions)

- `og_prints_pictures`: id, created_at, kid (nullable: Oliver/George, if we add profiles), idea, style, shape, model, source (`ai` | `search`), source_url, original_path (full-res image from Gemini/search), print_path (processed 1-bit PNG, 384 px wide), width, height, print_count, last_printed_at, favourite.
- Storage bucket for originals and print-ready images. Keep **originals** so a reprint can use a different line thickness.
- Server-side usage count per day (or count rows per day) for the limit.

## Questions to settle with Warren early

- Auth: how do the other apps sign in? Does the kids' iPhone use one shared family login, or a profile picker for Oliver and George?
- Should the gallery be split per child or shared?
- Domain: a Vercel subdomain or a custom one?
- Keep the GitHub Pages version running until the Vercel one is proven?

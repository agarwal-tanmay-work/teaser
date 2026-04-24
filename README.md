# Teaser

**Paste a product URL. Get a professional launch video. Automatically.**

Teaser is a SaaS platform that fully automates product launch video creation. A founder pastes their product URL, and Teaser's AI visits the product, *sees* the actual screen at every step via vision AI, records a real interactive demo, writes a narrative-driven script, generates a natural voiceover, composites everything with animated intro/outro, karaoke captions, and a music bed — then delivers a publish-ready MP4.

---

## How It Works

1. Founder pastes a product URL (and optional demo start URL)
2. Firecrawl scrapes the website — targeting product pages, customer stories, testimonials, integrations, and case studies for social-proof depth
3. Gemini 2.5 Flash analyses the scraped content and produces a structured `ProductUnderstanding` (features, demo flow goals, target audience)
4. A **vision-driven agentic loop** records the demo:
   - Playwright opens a headless Chrome browser at 1920×1080
   - At each step, a screenshot is sent to Gemini Vision — the AI *sees* the actual page and decides the next action (click, navigate, scroll, type)
   - CDP `Page.startScreencast` captures frames with wall-clock timestamps for accurate 1× playback
   - Smart interaction: cubic-bezier cursor easing, hover-before-click, animated click ripples, jittered typing, auto-dismiss popups
5. Gemini writes a timed narration script following a Product Hunt narrative arc (Hook → Problem → Product in Action → Proof → CTA)
6. ElevenLabs converts the script to a natural voiceover (tone-matched: professional, conversational, or energetic)
7. **Remotion** composites the final video in one render pass:
   - Animated intro & outro
   - Per-clip motion (click-zoom with `transformOrigin`, Ken Burns panning)
   - Word-level karaoke captions (Inter 900, amber highlight, spring reveal, backdrop-blur pill)
   - Background music with time-varying volume envelope
   - Progress bar overlay
   - FFmpeg handles only the raw recording color grade (saturation, contrast, cool tilt)
8. The final MP4 (CRF 18 / AAC 192k, full 1920×1080) is uploaded to Supabase Storage
9. Founder downloads their launch video from the dashboard

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router, TypeScript strict) |
| Styling | Tailwind CSS v4 (dark mode only, no UI libraries) |
| Database | Supabase (PostgreSQL + Auth + Storage) |
| Job Queue | BullMQ + Upstash Redis |
| Browser Automation | Playwright (headless Chromium) + CDP Screencast |
| Vision AI | Gemini 3.1 Flash Lite (multimodal) — per-step screenshot analysis |
| LLM | Gemini 3.1 Flash Lite (with 2.5 Flash / 2.5 Flash Lite fallback) |
| Web Scraping | Firecrawl API |
| Voiceover | ElevenLabs API (tone-specific voices) |
| Video Composition | Remotion (intro/outro, captions, clip motion, music) |
| Video Processing | fluent-ffmpeg (FFmpeg) — color grading, encoding |
| Data Fetching | TanStack React Query |
| Animations | Framer Motion |
| Icons | Lucide React |
| Analytics | PostHog |
| Validation | Zod v4 |
| Package Manager | pnpm |

### Optional: Skyvern Navigation Agent

Teaser includes an optional integration with a **forked Skyvern** instance for browser recording. When enabled (`USE_SKYVERN=true`), Skyvern replaces the built-in Playwright recorder with its own AI-driven navigation agent running in Docker.

---

## Local Setup

### Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- FFmpeg installed on your system (`brew install ffmpeg` / `apt install ffmpeg` / `choco install ffmpeg`)
- A Supabase project
- API keys for: Gemini, ElevenLabs, Firecrawl, Upstash Redis
- Docker (only if using Skyvern)

### 1. Clone and install

```bash
git clone https://github.com/agarwal-tanmay-work/teaser.git
cd teaser
pnpm install
npx playwright install chromium
```

### 2. Set up environment variables

```bash
cp .env.local.example .env.local
```

Fill in all values in `.env.local`. Required variables:

| Variable | Source |
|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API (never expose to browser) |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/) |
| `ELEVENLABS_API_KEY` | [ElevenLabs](https://elevenlabs.io/) |
| `ELEVENLABS_VOICE_ID` | ElevenLabs → Voices (default fallback) |
| `FIRECRAWL_API_KEY` | [Firecrawl](https://firecrawl.dev/) |
| `UPSTASH_REDIS_REST_URL` | [Upstash Console](https://console.upstash.com/) (use `rediss://` URL) |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Console |
| `NEXT_PUBLIC_POSTHOG_KEY` | [PostHog](https://app.posthog.com/) |

Optional tone-specific voice IDs: `ELEVENLABS_VOICE_ID_PROFESSIONAL`, `ELEVENLABS_VOICE_ID_CONVERSATIONAL`, `ELEVENLABS_VOICE_ID_ENERGETIC`.

### 3. Set up Supabase

1. Create a new Supabase project
2. Open the SQL editor and run the contents of `supabase/schema.sql`
3. Create a Storage bucket named `videos` and set it to public
4. Copy your project URL, anon key, and service role key into `.env.local`

### 4. Run the development server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Run the video processor worker

In a separate terminal:

```bash
pnpm worker
```

The worker connects to Upstash Redis and processes video generation jobs as they arrive.

### 6. (Optional) Run Skyvern

If using the Skyvern navigation agent instead of the built-in recorder:

```bash
docker compose -f docker-compose.skyvern.yml up --build
```

Set `USE_SKYVERN=true` and configure `SKYVERN_BASE_URL` / `SKYVERN_API_KEY` in `.env.local`.

---

## Video Pipeline

```
User submits URL (+ optional demo start URL)
      |
      v
POST /api/videos/create
  - Validates input (Zod v4)
  - Checks URL is reachable
  - Inserts video_job row (status: pending)
  - Enqueues job in BullMQ
      |
      v
BullMQ Worker (pnpm worker)
  |
  |- Stage 1 (0-15%)   -> Firecrawl deep-scrapes URL (10k chars/page, 8 pages,
  |                        targets /customers, /case-studies, /testimonials, etc.)
  |                     -> Gemini produces ProductUnderstanding JSON
  |
  |- Stage 2 (15-35%)  -> Vision-Driven Agentic Recording:
  |                        Playwright opens Chrome at 1920×1080
  |                        For each demo goal (up to 20 total steps):
  |                          Screenshot → Gemini Vision → next action
  |                        CDP startScreencast captures wall-clock frames
  |                        FFmpeg assembles frames via concat demuxer
  |
  |- Stage 3 (35-55%)  -> Gemini writes timed narration script
  |                        (PH arc: Hook → Problem → Action → Proof → CTA)
  |
  |- Stage 4 (55-70%)  -> ElevenLabs converts script to MP3 voiceover
  |
  |- Stage 5 (70-90%)  -> FFmpeg color-grades raw recording
  |                     -> Remotion renders master composition:
  |                        intro + per-clip motion + karaoke captions
  |                        + outro + music bed + progress bar → .mp4
  |
  +- Stage 6 (90-100%) -> Upload .mp4 to Supabase Storage
                        -> Mark job completed
      |
      v
Dashboard polls GET /api/videos/status/[jobId] every 3 seconds
Shows circular progress ring -> completed state with video player + download
```

---

## Project Structure

```
teaser/
├── app/
│   ├── layout.tsx                   # Root layout (fonts, metadata, globals)
│   ├── globals.css                  # Global styles + Tailwind
│   ├── (landing)/page.tsx           # Public landing page
│   ├── (auth)/
│   │   ├── layout.tsx               # Auth page layout
│   │   ├── login/                   # Login page
│   │   └── signup/                  # Signup page
│   ├── auth/                        # Supabase auth callback handler
│   ├── (app)/
│   │   ├── layout.tsx               # Auth guard + sidebar
│   │   └── dashboard/page.tsx       # Dashboard
│   └── api/
│       ├── waitlist/                # POST - join waitlist
│       └── videos/
│           ├── create/              # POST - create job (auth required)
│           ├── process/             # POST - internal: trigger processing
│           ├── status/[jobId]/      # GET  - poll job status (auth required)
│           ├── list/                # GET  - list user's videos
│           ├── understand/          # POST - internal: scrape + Gemini analyse
│           └── script/              # POST - internal: Gemini script generation
├── components/
│   ├── landing/                     # Navbar, Hero, Problem, HowItWorks,
│   │                                # Features, Testimonials, Waitlist, Footer
│   ├── dashboard/                   # AppSidebar, VideoForm, ProgressTracker,
│   │                                # VideoCard, VideoHistory
│   ├── ui/                          # AnimatedGridPattern, BorderBeam, FlipWords,
│   │                                # Marquee, SparklesCore, Spotlight,
│   │                                # TextGenerateEffect
│   └── providers/                   # QueryProvider (TanStack React Query)
├── lib/
│   ├── gemini.ts                    # understandProduct + generateScript
│   │                                # + getNextDemoAction (vision) + Gemini TTS
│   ├── firecrawl.ts                 # Deep scrape with social-proof targeting
│   ├── elevenlabs.ts                # generateVoiceover (tone-matched)
│   ├── skyvern.ts                   # Skyvern API client (optional recorder)
│   ├── recon.ts                     # Site reconnaissance utilities
│   ├── sitemap.ts                   # Sitemap parsing for scrape targets
│   ├── tts.ts                       # TTS abstraction layer
│   ├── ffmpegUtils.ts               # FFmpeg helper functions
│   ├── queue.ts                     # BullMQ queue + addVideoJob (lazy singleton)
│   ├── supabase.ts                  # Three Supabase clients (server/browser/service)
│   ├── logger.ts                    # Winston logger (server only)
│   └── utils.ts                     # retryWithBackoff + sleep
├── workers/
│   ├── videoProcessor.ts            # BullMQ Worker — orchestrates all 6 stages
│   ├── videoAssembler.ts            # Remotion + FFmpeg — assembles final .mp4
│   └── browserRecorder.ts           # Vision-driven agentic recorder (CDP screencast)
├── remotion/
│   ├── Root.tsx                     # Remotion root — registers compositions
│   ├── TeaserVideo.tsx              # Master composition (clips + captions + music)
│   └── components/
│       ├── Intro.tsx                # Animated intro sequence
│       ├── Outro.tsx                # Animated outro with CTA
│       ├── KaraokeCaptions.tsx      # Word-level karaoke captions
│       ├── ClipMotion.tsx           # Click-zoom + Ken Burns per clip
│       ├── FeatureHighlight.tsx     # Feature callout overlays
│       ├── LowerThird.tsx           # Lower-third text bar
│       ├── ProgressBar.tsx          # Video progress bar overlay
│       └── TypingAnimation.tsx      # Typing animation effect
├── types/index.ts                   # All shared TypeScript interfaces
├── supabase/schema.sql              # Full database schema with RLS policies
├── docker-compose.skyvern.yml       # Docker Compose for Skyvern (optional)
└── skyvern-fork/                    # Forked Skyvern with custom hooks (optional)
```

---

## Commands

```bash
pnpm dev          # Start Next.js development server
pnpm build        # Production build
pnpm type-check   # TypeScript strict check (must pass with zero errors)
pnpm worker       # Start the BullMQ video processor worker
pnpm lint         # ESLint
```

### Skyvern (optional)

```bash
docker compose -f docker-compose.skyvern.yml up --build    # Start Skyvern
docker compose -f docker-compose.skyvern.yml down           # Stop Skyvern
```

---

## Architecture Decisions

- **Dark-only design system** — no light mode, no external UI libraries
- **Vision-driven recording** — at each step, Gemini Vision *sees* the actual page screenshot and decides the next action. Replaces static pre-planned step execution. Enforces >= 2 in-page interactions per page for deep exploration.
- **Robust Model Fallbacks** — automated model chain (3.1-flash-lite -> 2.5-flash -> 2.5-flash-lite) with auto-skip on quota exhaustion (402) and auto-retry on rate limits (429).
- **CDP Screencast over Playwright recordVideo** — wall-clock timestamps eliminate fast-forward artifacts
- **Remotion for composition** — one render pass produces the final video (intro, clips, captions, outro, music). FFmpeg is only used for raw recording color grading
- **Karaoke captions** — word-level highlighting with spring animations, not FFmpeg drawtext
- **BullMQ + Upstash Redis** — lazy singleton pattern avoids build-time Redis connections
- **PH narrative arc** — scripts follow Hook → Problem → Product in Action → Proof → CTA with a banned-phrase list to avoid generic marketing language
- **Click verification** — JPEG file size comparison (fast, zero deps, ~2% threshold) to detect failed clicks
- **Custom cursor** — injected into page DOM (not FFmpeg overlay) so it renders naturally in the recording with ripple effects
- **Zod v4** — uses `.issues` not `.errors` for error access

---

## Deployment

1. Deploy the Next.js app to **Vercel**
2. Set all environment variables in the Vercel dashboard
3. Run the worker on a separate long-running server (**Railway**, **Render**, or a VPS)
4. Ensure FFmpeg is installed on the worker server (`apt install ffmpeg`)
5. Run `npx playwright install chromium` on the worker server before starting
6. (Optional) Deploy Skyvern via Docker on the worker server for AI-driven browser navigation

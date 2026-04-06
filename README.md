# Teaser

**Paste a product URL. Get a professional launch video. Automatically.**

Teaser is a SaaS platform that fully automates product launch video creation. A founder pastes their product URL, and Teaser's AI visits the product, understands what it does, records a real screen demo, writes a professional script, generates a natural voiceover, adds smart editing (zoom effects, captions, branded intro/outro), and delivers a publish-ready MP4 — in under 10 minutes.

---

## What Teaser Does

1. Founder pastes a product URL
2. Firecrawl scrapes the entire product website
3. Gemini analyses the content and produces a structured understanding (features, demo flow, target audience)
4. Playwright opens a real headless Chrome browser, follows the demo flow, and records the session as video
5. Gemini writes a professional 60-90 second narration script
6. ElevenLabs converts the script to a natural voiceover
7. FFmpeg assembles everything: recording + voiceover + captions + branded intro/outro
8. The final MP4 is uploaded to Supabase Storage
9. Founder downloads their launch video

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, TypeScript strict) |
| Styling | Tailwind CSS v4 (dark mode only, no UI libraries) |
| Database | Supabase (PostgreSQL + Auth + Storage) |
| Job Queue | BullMQ + Upstash Redis |
| Browser Automation | Playwright (headless Chromium) |
| LLM | Google Gemini 1.5 Pro |
| Web Scraping | Firecrawl API |
| Voiceover | ElevenLabs API |
| Video Assembly | fluent-ffmpeg (FFmpeg) |
| Data Fetching | TanStack React Query |
| Animations | Framer Motion |
| Validation | Zod |
| Package Manager | pnpm |

---

## Local Setup

### Prerequisites

- Node.js 20+
- pnpm (`npm install -g pnpm`)
- FFmpeg installed on your system (`brew install ffmpeg` / `apt install ffmpeg`)
- A Supabase project
- API keys for: Gemini, ElevenLabs, Firecrawl, Upstash Redis

### 1. Clone and install

```bash
git clone https://github.com/agarwal-tanmay-work/teaser.git
cd teaser
pnpm install
```

### 2. Set up environment variables

```bash
cp .env.local.example .env.local
```

Fill in all values in `.env.local`. See `.env.local.example` for descriptions of each variable.

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

---

## Video Pipeline

```
User submits URL
      |
      v
POST /api/videos/create
  - Validates input (Zod)
  - Checks URL is reachable
  - Inserts video_job row (status: pending)
  - Enqueues job in BullMQ
      |
      v
BullMQ Worker (pnpm worker)
  |
  |- Stage 1 (0-15%)   -> Firecrawl scrapes URL -> Gemini produces ProductUnderstanding JSON
  |- Stage 2 (15-35%)  -> Playwright opens Chrome, follows demo_flow, records .webm
  |- Stage 3 (35-55%)  -> Gemini writes timed narration script
  |- Stage 4 (55-70%)  -> ElevenLabs converts script to MP3 voiceover
  |- Stage 5 (70-90%)  -> FFmpeg: intro + recording + outro + captions + audio mix -> .mp4
  +- Stage 6 (90-100%) -> Upload .mp4 to Supabase Storage -> mark job completed
      |
      v
Dashboard polls GET /api/videos/status/[jobId] every 3 seconds
Shows circular progress ring -> completed state with video player and download buttons
```

---

## Project Structure

```
teaser/
├── app/
│   ├── (landing)/page.tsx        # Public landing page
│   ├── (app)/
│   │   ├── layout.tsx            # Auth guard + sidebar
│   │   └── dashboard/page.tsx   # Dashboard
│   └── api/
│       ├── waitlist/             # POST - join waitlist
│       └── videos/
│           ├── create/           # POST - create job (auth required)
│           ├── status/[jobId]/   # GET  - poll job status (auth required)
│           ├── understand/       # POST - internal: scrape + Gemini analyse
│           └── script/           # POST - internal: Gemini script generation
├── components/
│   ├── landing/                  # Navbar, Hero, Problem, HowItWorks,
│   │                             # Features, Testimonials, Waitlist, Footer
│   └── dashboard/                # AppSidebar, VideoForm, ProgressTracker, VideoCard
├── lib/
│   ├── logger.ts                 # Winston logger (server only)
│   ├── supabase.ts               # Three Supabase clients (server/browser/service)
│   ├── gemini.ts                 # understandProduct + generateScript
│   ├── firecrawl.ts              # scrapeUrl
│   ├── elevenlabs.ts             # generateVoiceover
│   ├── queue.ts                  # BullMQ queue + addVideoJob (lazy singleton)
│   └── utils.ts                  # retryWithBackoff + sleep
├── workers/
│   ├── videoProcessor.ts         # BullMQ Worker - orchestrates all 6 stages
│   ├── videoAssembler.ts         # FFmpeg pipeline - assembles final .mp4
│   └── browserRecorder.ts        # Playwright - records real product demo
├── types/index.ts                # All shared TypeScript interfaces
└── supabase/schema.sql           # Full database schema with RLS policies
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

---

## Deployment

1. Deploy the Next.js app to Vercel
2. Set all environment variables in the Vercel dashboard
3. Run the worker on a separate long-running server (Railway, Render, or a VPS)
4. Ensure FFmpeg is installed on the worker server (`apt install ffmpeg`)
5. Run `pnpm playwright install chromium` on the worker server before starting

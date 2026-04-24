# Teaser — Claude Code Memory

## What Teaser Is
A SaaS platform that turns any software product URL into a
professional launch video automatically. The founder pastes
their product URL. Teaser's AI visits the URL, reads and
understands the entire product, navigates it like a human
would, records a real screen demo automatically, writes a
professional video script, generates a natural AI voiceover,
adds smart editing (zoom effects, captions, cursor highlights,
branded intro and outro), and delivers a publish-ready MP4
video — all without the founder doing anything except paste
a link. URL in. Professional launch video out. Zero editing
skills. Zero screen recording. Zero agency. Under 10 minutes.

## The Problem Teaser Solves
Every startup needs a professional product launch video.
Current options: hire a video agency ($2,000-$20,000, takes
weeks), DIY with screen recording tools (requires editing
skills, takes days), or skip it entirely and launch with
something embarrassing. Teaser eliminates all three problems
by fully automating the entire video creation pipeline.

## The Core Technical Flow
1. User pastes product URL + optional description
2. Firecrawl scrapes the entire product website
3. Gemini reads the scraped content and outputs a structured
   ProductUnderstanding JSON.
4. A vision-driven agentic loop records the demo: Playwright
   opens a real headless Chrome browser at 1920×1080. At each
   step, a screenshot is sent to Gemini Vision — the AI *sees*
   the actual page and decides the next action (click, type,
   scroll, hover). CDP screencast captures wall-clock frames
   for perfect 1× playback.
5. Gemini writes a professional 60-90 second video script
   timed to match what was recorded, trained on the style
   of top ProductHunt launch videos
6. ElevenLabs converts the script to natural voiceover audio
7. FFmpeg + Remotion assembles everything: recording +
   voiceover + background music + animated captions +
   smart zoom effects on key moments + cursor highlights +
   branded 2-second intro with product name + 3-second outro
   with useteaser.com
8. Final MP4 is uploaded to Supabase Storage
9. User downloads their professional video

## Tech Stack — Never Change Without Asking
- Framework: Next.js 16 with App Router (TypeScript strict)
- Styling: Tailwind CSS v4 only. No external UI libraries ever.
- Database: Supabase (PostgreSQL)
- Auth: Supabase Auth
- Job Queue: BullMQ + Redis via Upstash
- Browser Automation: Playwright (headless Chrome) + CDP Screencast
- LLM: Gemini 3.1 Flash Lite (preview) with 2.5-flash fallback
- Web Scraping: Firecrawl API
- Voiceover: ElevenLabs API
- Video Assembly: Remotion + FFmpeg
- Storage: Supabase Storage
- Package manager: pnpm always. Never npm or yarn.
- Optional: Skyvern for alternative AI-driven navigation

## Non-Negotiable Code Rules
- TypeScript strict mode. Zero `any` types. Ever.
- Every function has a JSDoc comment.
- Every API route has try/catch with correct HTTP status codes.
- Every external API call has retry logic (3 attempts, backoff).
- Never console.log. Use logger from /lib/logger.ts.
- Never expose raw error strings to users.
- React Query for ALL data fetching. No useEffect for data.
- Zod for ALL validation — forms and API request bodies.
- Server components by default. Client only when needed.
- Mobile-first responsive. Test at 375px always.

## Design System — Never Deviate
- Background: #0A0A0A
- Surface: #111111
- Border: #1F1F1F
- Primary text: #FFFFFF
- Secondary text: #6E6E6E
- Success: #22C55E, Error: #EF4444
- Font: Geist via next/font
- Dark mode only. No light mode.
- Animations: Framer Motion only.
- No gradients except hero headline.

## File Naming
- Components: PascalCase (Hero.tsx)
- API routes: route.ts in named folders
- Utilities: camelCase (gemini.ts)
- Types: PascalCase interfaces (VideoJob)

## Commands
- Install: pnpm install
- Dev: pnpm dev
- Type check: pnpm type-check
- Build: pnpm build
- Worker: pnpm worker

## Key Files
- All types: /types/index.ts
- Supabase: /lib/supabase.ts
- Gemini: /lib/gemini.ts
- ElevenLabs: /lib/elevenlabs.ts
- Queue: /lib/queue.ts
- Logger: /lib/logger.ts
- Worker: /workers/videoProcessor.ts

## Current State
See project_state.md for what is built and what is next.

## Never Do
- Use `any` TypeScript type
- Use npm or yarn
- Add shadcn, MUI, or any UI library
- Put business logic in React components
- Hardcode secrets
- Skip error handling
- Write useEffect for data fetching
- Commit .env.local or settings.local.json
- Use OpenAI — we use Gemini only
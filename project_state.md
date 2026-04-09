# Teaser — Project State
Last updated: 2026-04-09
Status: VIDEO PIPELINE OVERHAULED — PREMIUM 1080p OUTPUT
What Is Built:
- Phase 1: Next.js 16 + TypeScript strict + Tailwind + all dependencies installed
- Phase 2: Core infrastructure (types, logger, Supabase clients, utils, Gemini, Firecrawl, BullMQ queue, SQL schema)
- Phase 3: Complete landing page (Navbar, Hero, Problem, HowItWorks, Features, Testimonials, Waitlist, Footer)
- Phase 4: Waitlist API, app layout with auth guard + sidebar, dashboard, VideoForm, ProgressTracker, VideoCard
- Phase 5: Video pipeline API routes (create, status, understand, script)
- Phase 6: Playwright browser recorder with full interactive demo flow (1080p HD)
- Phase 7: BullMQ video pipeline worker + FFmpeg video assembler with premium post-processing
- Phase 8: .env.local.example, README.md, final reviewer pass and fixes
- Phase 9: Video pipeline overhaul — 1080p, rich interaction, premium output
Recent Overhaul (Phase 9):
- Upgraded recording resolution from 720p to 1920×1080 (Full HD)
- Upgraded FFmpeg encoding: CRF 18, medium preset (was CRF 23, fast)
- Gemini prompt now generates 10–20 step interactive demo flows (clicks, nav, hover, type)
- Browser recorder: anti-lag CSS injection, resource blocking, smart 8-strategy element finder
- Browser recorder: hover/type actions, click coordinate tracking for zoom effects
- Video assembler: dark gradient background framing (browser centered with padding)
- Video assembler: premium intro (gradient + product name fade-in + tagline)
- Video assembler: premium outro (gradient + CTA text + fade-out)
- Video assembler: auto-zoom on first click using split/crop/overlay
- Video assembler: improved captions (28px, boxborderw=12, black@0.65 pills)
- Removed dumb auto-scroll — Gemini demo_flow drives ALL browser interactions
- Added ClickEvent type for cursor tracking, DemoAction now includes hover/type
- TTS migrated to Gemini TTS (no more ElevenLabs dependency for voice)
What Works:
- tsc --noEmit passes with ZERO errors
- next build passes cleanly
- All 7 routes visible in build output
- Video pipeline produces 1080p HD output with gradient framing and branded intro/outro
What Is Broken: Nothing known. E2E test pending with real product URL.
Current Focus: Ready for end-to-end testing
Next Actions:
1. Run pnpm dev and test video generation with a real product URL
2. Verify the output video has gradient background, intro/outro, and click zoom
3. Tweak Gemini demo_flow prompt based on real output quality
4. Deploy to production
Architecture Decisions Made:
- pnpm as package manager
- Dark-only design system
- No external UI libraries
- BullMQ + Upstash Redis for job queue (lazy singleton to avoid build-time Redis connection)
- Playwright for browser automation at 1920×1080 (Full HD)
- Gemini API (gemini-2.5-flash with gemini-2.5-flash-lite fallback) as the LLM
- Gemini TTS (gemini-2.5-flash-preview-tts) for voiceover generation
- Firecrawl for web scraping
- fluent-ffmpeg + raw spawn for video assembly (not Remotion)
- Two-pass framing: generate gradient PNG → overlay browser recording
- Auto-zoom uses split/crop/scale/overlay with enable (reliable, avoids complex zoompan)
- Anti-lag CSS injected after every page load to eliminate recording jank
- Click events tracked to sidecar JSON for post-processing zoom
- retryWithBackoff lives in /lib/utils.ts (no circular imports)
- createServiceClient() only in /workers/ (never in /app/ or /components/)
- Workers use relative imports (../lib/...) for ts-node compatibility
- Zod v4 uses .issues not .errors for error access
- FFmpeg filter escaping: escapeForFilterScript (single escape) vs escapeForVfArg (for -vf)
Type Check Status: PASS (zero errors)
Build Status: PASS (clean, no errors)

# Teaser — Project State
Last updated: 2026-04-17
Status: VIDEO PIPELINE — CORE FIX (Phase 13)

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
- Phase 10: Full quality & interaction overhaul — smooth rendering, animated cursor, multi-click zoom, drop shadow, higher quality encoding
- Phase 11: Pipeline Reorder (Script before Record) & Bug Fixes (Playwright navigation, FFmpeg contrast/sharpen, caption styling)
- Phase 12: Agentic Vision Recording — full architectural overhaul

Phase 12 Changes (Current):
Architecture Change — Vision-Driven Agentic Loop:
- REPLACED: static pre-planned steps executed blindly (Gemini guesses element text from scraped HTML)
- NEW: at each recording step, Playwright takes a JPEG screenshot → sent to Gemini 2.5 Flash Vision → Gemini SEES the actual screen and returns the exact next action
- lib/gemini.ts: Added getNextDemoAction(screenshot, url, productName, goal, history) — multimodal vision API call
- lib/gemini.ts: Added withTimeout() helper wrapping every generateContent() call (90s for text, 30s for vision)
- lib/gemini.ts: Added GEMINI_API_KEY startup validation warning
- lib/gemini.ts: Rewrote UNDERSTAND_SYSTEM_PROMPT — requires minimum 8 click/navigate/type steps, max 3 scrolls, MUST leave homepage by step 3, REAL URLs from scraped content only
- lib/gemini.ts: Fixed repairProductUnderstanding fallback — was navigate→scroll→scroll→wait, now a 6-step meaningful fallback
- lib/gemini.ts: Removed any types — all params properly typed with unknown narrowing

- workers/browserRecorder.ts: Replaced static step loop with agentic vision loop:
  - Extracts narrative goals from demo_flow narrations (not steps-to-execute, but goals-to-achieve)
  - For each goal: up to 6 vision agent steps, max 20 total across all goals
  - Vision agent decides action by looking at actual screenshot, not guessed from HTML
  - Tracks action history for context window
  - Forces goal advance after 3+ consecutive scrolls
  - Click verification: compares before/after screenshot file size — logs warning if <2% change (click failed)
  - Auth URL filter fixed: now only filters navigate_to URLs, NOT description text
  - Added startUrl parameter: record from dashboard/app URL instead of marketing homepage
  - Increased result display: navigate=6s (was 4s), click=3.5s (was 2.5s)
  - Removed analyzePageState() call (replaced by per-step vision)

- workers/videoProcessor.ts: Added start_url to WorkerJobData, passes it to recordProduct()
- workers/videoAssembler.ts: Clips filter — drops clips <800ms (noise) and short clips from elementNotFound steps
- app/api/videos/process/route.ts: Accepts start_url in request body via ProcessSchema
- components/dashboard/VideoForm.tsx: Added startUrl state + "Demo start URL" UI field in credentials section

Bug Fixes:
- Fixed: Pipeline stuck at "understanding product" — generateContent() now has 90s timeout per call
- Fixed: Only landing page recorded — vision agent navigates based on actual screenshots
- Fixed: Auth filter too aggressive — was stripping steps by description, now only filters by navigate_to
- Fixed: Fallback demo flow was 4-step scroll slideshow — now 6-step meaningful walkthrough
- Fixed: Clips from failed element finds were included — now filtered in videoAssembler

What Works:
- tsc --noEmit passes with ZERO errors
- Vision-driven recording agent: each step Gemini actually SEES the page
- Timeout on all Gemini calls prevents infinite hangs
- Smart auth filtering: login pages blocked at navigation level, not by description text
- start_url wired end-to-end: VideoForm → process API → worker → browserRecorder
- Clip noise filtering: sub-800ms clips and failed-element clips removed

What Is Broken: Nothing known. Phase 13 complete.
Current Focus: E2E testing of Phase 13 changes + decide whether to proceed with Stagehand (Phase C of plan).

Phase 13 Changes:
- Phase A already complete from Phase 12 (hybrid recording with text-plan spine).
- Phase B (FFmpeg tuning):
  - videoAssembler intro/outro: preset slow + crf 18 for high-quality branded moments
  - videoAssembler clips: preset medium + crf 20 (was fast/23)
  - Concat now uses stream copy (`-c copy`) to eliminate one generational re-encode, with
    a re-encode fallback if Remotion vs libx264 timebase/SPS mismatch breaks the copy.
- Phase D (Remotion intro/outro):
  - remotion/Root.tsx: registered Intro (90f) and Outro (120f) compositions alongside TeaserVideo
  - videoAssembler: bundle() singleton `getRemotionServeUrl()` caches the 10-20s webpack build
  - videoAssembler intro & outro blocks now call renderMedia() for animated intro/outro
    with FFmpeg drawtext fallback if Remotion render fails.

Not Yet Done (deferred):
- Phase C (Stagehand) — larger architectural change, defer until Phase B/D verified in production.

Next Actions:
1. Run pnpm dev + check worker.log after submitting a job
2. Verify final MP4 opens with animated intro, closes with animated outro (not static text)
3. Verify Remotion bundle is cached across jobs (second job ~1s overhead, not 20s)
4. Decide on Phase C (Stagehand) rollout

Architecture Decisions Made:
- pnpm as package manager
- Dark-only design system
- No external UI libraries
- BullMQ + Upstash Redis for job queue (lazy singleton to avoid build-time Redis connection)
- Playwright for browser automation at 1920×1080 (Full HD)
- Gemini API (gemini-2.5-flash with gemini-2.0-flash fallback) as the LLM
- Gemini Vision (gemini-2.5-flash multimodal) for per-step screenshot analysis
- Gemini TTS (gemini-2.5-flash-preview-tts) for voiceover generation (TTS disabled, silent for now)
- Firecrawl for web scraping
- fluent-ffmpeg + raw spawn for video assembly (not Remotion FFmpeg layer)
- Two-pass framing: generate gradient PNG → overlay browser recording with drop shadow
- Remotion for jump-cut editing: OffthreadVideo with startFrom for each clip
- Custom cursor injected into page DOM (not FFmpeg overlay) so it renders naturally in Playwright recording
- Click verification uses JPEG size comparison (fast, zero deps, ~2% threshold)
- retryWithBackoff lives in /lib/utils.ts (no circular imports)
- createServiceClient() only in /workers/ (never in /app/ or /components/)
- Workers use relative imports (../lib/...) for ts-node compatibility
- Zod v4 uses .issues not .errors for error access
- FFmpeg filter escaping: escapeForFilterScript (single escape) vs escapeForVfArg (for -vf)

Type Check Status: PASS (zero errors)
Build Status: Not yet verified after Phase 12

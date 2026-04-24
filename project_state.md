# Teaser — Project State
Last updated: 2026-04-24
Status: STABILITY & AGENTIC POLISH — Phase 16 shipped

Phase 15 — Video Quality Overhaul (2026-04-19):
- Phase A — Captions: killed FFmpeg drawtext captions; new remotion/components/KaraokeCaptions.tsx renders word-level karaoke (Inter 900 / 60px, amber `#FACC15` active word, glow, spring reveal, backdrop-blur pill, `**word**` emphasis markup support)
- Phase B — Recording polish (workers/browserRecorder.ts): cubic-bezier cursor easing with arc paths, hover-before-click with per-click ripple, adaptive dark-outer/white-inner ripple, networkidle-capped dynamic post-action waits, RAF smooth scroll, 30–60ms jittered typing, auto-dismiss popups via role-based selectors + expanded POPUP_HIDE_CSS, `scrollIntoViewIfNeeded` before click, vision fallback now emits 3-step scroll sequence (never dead-stares)
- Phase C — Assembly (workers/videoAssembler.ts + remotion/TeaserVideo.tsx): Remotion owns entire master composition — intro, per-clip motion, karaoke captions, outro, music bed, progress bar all rendered in ONE pass. FFmpeg only color-grades raw recording (saturation 0.94, contrast 1.07, cool tilt). Dropped 1600×900 chrome inset for full 1920×1080 immersive. New remotion/components/ClipMotion.tsx: click-zoom 1.0→1.12 with transformOrigin at element coords for lead clips, Ken Burns elsewhere. Crossfaded intro→demo→outro. Background music (`public/audio/bg-music.mp3` auto-detected) with time-varying volume envelope. CRF 18 / AAC 192k.
- Phase D — Script & narrative engineering (lib/gemini.ts + lib/firecrawl.ts): SCRIPT_SYSTEM_PROMPT rewritten for PH narrative arc (HOOK → PROBLEM → PRODUCT IN ACTION → PROOF → CTA) with banned-phrase list ("unlock productivity", "streamline workflow", "powerful platform", "seamless experience", "revolutionary", "game-changing", etc.). Caption craft rules enforce 6–14 word sentences, present tense, `**word**` emphasis markup (1–2 per segment). Firecrawl now targets /customers, /case-studies, /testimonials, /reviews, /stories, /showcase, /integrations for social-proof depth. CHARS_PER_PAGE lifted 6k→10k, MAX_PAGES 6→8, gemini scrapedContent slice lifted 20k→40k.
- Removed dead code: remotion/components/Subtitles.tsx, remotion/components/Cursor.tsx
- Types: added WordTiming + TeaserVideoProps/IntroProps/OutroProps with index signatures to satisfy Remotion composition generic
- Verified: `npx tsc --noEmit` clean, `next build` clean (14/14 static pages)

Phase 16 — Stability & Model Fallbacks (2026-04-24):
- Model Chain: Primary LLM moved to `gemini-3.1-flash-lite-preview`. Added automatic fallback chain: `gemini-3.1-flash-lite-preview` -> `gemini-2.5-flash` -> `gemini-2.5-flash-lite`.
- Quota Management: Implemented `isQuotaExhausted` (auto-skip model on 402/quota) and `isRateLimited` (auto-wait on 429).
- Agentic Stability: `planPageInteractions` now enforces "Deep Landing Interaction" (>= 2 in-page interactions like scroll/hover/type before any navigation).
- Vision Loop Polish: Added `allowNavigation` flag to ensure the video ends inside the product, not on a half-loaded subpage.
- Request Layer: Dropped library dependencies for LLM calls, moved to native `https` with explicit 120s timeouts and `withTimeout` race wrapper for all model calls.
- MAX_PAGES capped at 5 for predictable exploration depth.

Prior status header: VIDEO PIPELINE — FAST-FORWARD + STALL FIX (Phase 14)

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

Phase 14 Changes (Fast-forward + stall fix):
- browserRecorder: REPLACED Playwright recordVideo with CDP Page.startScreencast.
  Each frame is stamped server-side with Date.now(), and we assemble the MP4 via
  FFmpeg concat demuxer using explicit per-frame durations. Fully eliminates the
  fast-forward effect since the MP4 timeline is built from wall-clock directly,
  not Chromium's internal WebM PTS.
- browserRecorder: added master 5min wall-clock budget around the record loop
  with per-iteration heartbeat log. Prevents indefinite hangs mid-recording.
- browserRecorder: added click ripple effect to CURSOR_SCRIPT — expanding green
  circle on mousedown, standard polish in pro product launch videos.
- videoAssembler: concat now always re-encodes (preset medium / crf 20, cfr 30,
  matching timescale). Stream-copy was freezing mid-playback when Remotion intro
  SPS didn't match our libx264 clip SPS.
- Earlier setpts/ffprobe time-stretch hack removed — obsolete under CDP path.

Next Actions:
1. E2E test: submit a job, verify playback is 1x (not fast-forwarded), scrubs cleanly
2. Verify click ripples appear in the final MP4 at every click
3. Confirm master timeout breaks gracefully if Gemini flakes
4. Decide on Phase C (Stagehand) rollout

Architecture Decisions Made:
- pnpm as package manager
- Dark-only design system
- No external UI libraries
- BullMQ + Upstash Redis for job queue (lazy singleton to avoid build-time Redis connection)
- Playwright for browser automation at 1920×1080 (Full HD)
- Gemini API (gemini-3.1-flash-lite-preview with 2.5-flash fallback) as the LLM
- Gemini Vision (gemini-3.1-flash-lite-preview multimodal) for per-step screenshot analysis
- Gemini TTS (gemini-2.5-flash-preview-tts) for voiceover generation (TTS disabled, silent for now)
- Model Fallback Chain: 3.1-flash-lite-preview -> 2.5-flash -> 2.5-flash-lite with auto-skip on quota exhaustion
- Native https request layer with explicit 120s timeouts and withTimeout race wrapper
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

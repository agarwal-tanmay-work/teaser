# Teaser — Project State
Last updated: 2026-04-09
Status: VIDEO PIPELINE — FULL QUALITY & INTERACTION OVERHAUL (Phase 10)
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
Recent Overhaul (Phase 11):
Video Pipeline Reordering:
- Changed pipeline execution order: Understand -> Script -> Record -> Voiceover -> Edit -> Upload.
- Playwright now receives the generated `VideoScript` directly and acts on precise segments derived from `what_to_show`.
Browser Recorder (workers/browserRecorder.ts):
- Squashed Bug 1: Added `networkidle` enforcement immediately after page `goto` with an additional `3000ms` wait to prevent recording blank white screens.
- Squashed Bug 4: Enforced a precise sequence of locators for `click` with failover strategies, preserving site interaction tracking. Added `waitForLoadState` explicitly.
Video Assembler (workers/videoAssembler.ts):
- Squashed Bug 2: Applied FFmpeg video filters (`eq=contrast=1.1:brightness=-0.05:saturation=1.2,unsharp=5:5:0.8:3:3:0.4`) during WebM parsing. 
- Updated final encoding to `-crf 18`, `-preset slow`, `-profile:v high`.
- Squashed Bug 3: Restyled captions exactly to user specification (`fontsize=28:fontcolor=white:borderw=2:bordercolor=black:box=0:y=h*0.85`).
Browser Recorder (workers/browserRecorder.ts):
- REMOVED --disable-gpu-compositing and --disable-features=VizDisplayCompositor — these were killing render quality and causing frame drops
- Added --use-gl=swiftshader, --disable-background-timer-throttling, --disable-renderer-backgrounding for smooth consistent rendering
- REMOVED animation-killing anti-lag CSS (animation-duration: 0.01s) — sites now look natural with all animations intact
- Kept only popup/banner hiding CSS (renamed POPUP_HIDE_CSS)
- Injected animated custom cursor into every recorded page: 22px white circle with indigo glow ring, smooth CSS transition (left/top 0.28s ease) so cursor visibly slides to each target before clicking
- Click animation: cursor scales down + ripple ring expands and fades outward — all baked into the recording
- Cursor re-injected after every page navigation (idempotent)
- Element finder timeout reduced 4000ms → 2000ms per strategy (fail-fast); broad fallback stays 3000ms — max wait drops from 32s to ~18s
- waitUntil changed from domcontentloaded → load so JS-heavy sites fully render before interactions
Video Assembler (workers/videoAssembler.ts):
- Multi-click zoom: new buildZoomFilterChain() applies zoom at every click (up to 6, deduped by 3s spacing) using chained split→crop→scale→overlay per click; zoom factor 1.2x → 1.3x
- Drop shadow: browser window now has a blurred shadow copy overlaid 20px right / 24px down behind it
- Gradient background upgraded: deep navy-to-indigo using both X and Y gradients (richer than single-axis)
- Final render quality: CRF 18/medium → CRF 16/slow + bitrate floor 8000k/maxrate 12000k
- Intermediate files now use veryfast preset (throwaway temp files, quality is in CRF)
- Captions: fontsize 28→30, boxborderw 12→14, opacity 0.65→0.72, max line 65→60 chars
- Fixed filter graph bug: zoom chain already embedded [0:v] input label, was being doubled
Gemini (lib/gemini.ts):
- Added ELEMENT TARGETING RULES: instructs Gemini to use visible button text (e.g. "Get Started") never CSS class names — root cause of failed clicks
- Added TIMING RULES: explicit wait steps after every CTA click and navigate, minimum 15 steps, emphasis on actual product functionality not just landing page
What Works:
- tsc --noEmit passes with ZERO errors
- next build passes cleanly
- All 7 routes visible in build output
- Browser records with visible animated cursor and natural site animations
- Auto-zoom on ALL click events (up to 6) not just first
- Drop shadow behind browser window in framed composition
- CRF 16 / slow preset / bitrate floor for maximum 1080p quality
What Is Broken: Nothing known. Complete pipeline reorder & video quality fixes successfully integrated.
Current Focus: E2E testing of the reordered Script -> Record pipeline.
Next Actions:
1. Run pnpm dev + pnpm worker and test with a real product URL
2. Verify cursor animations visible in recording
3. Verify multi-click zoom fires at each interaction point
4. Verify site animations play naturally (no frozen/snapping)
5. Deploy to production
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
- Two-pass framing: generate gradient PNG → overlay browser recording with drop shadow
- Multi-click zoom uses chained split/crop/scale/overlay with enable (reliable, avoids complex zoompan)
- Custom cursor injected into page DOM (not FFmpeg overlay) so it renders naturally in Playwright recording
- Click events tracked to sidecar JSON for post-processing zoom
- retryWithBackoff lives in /lib/utils.ts (no circular imports)
- createServiceClient() only in /workers/ (never in /app/ or /components/)
- Workers use relative imports (../lib/...) for ts-node compatibility
- Zod v4 uses .issues not .errors for error access
- FFmpeg filter escaping: escapeForFilterScript (single escape) vs escapeForVfArg (for -vf)
Type Check Status: PASS (zero errors)
Build Status: PASS (clean, no errors)

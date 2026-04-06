# Teaser — Project State
Last updated: 2026-04-06
Status: ALL 8 PHASES COMPLETE — TEASER MVP FULLY BUILT
What Is Built:
- Phase 1: Next.js 16 + TypeScript strict + Tailwind + all dependencies installed
- Phase 2: Core infrastructure (types, logger, Supabase clients, utils, Gemini, Firecrawl, ElevenLabs, BullMQ queue, SQL schema)
- Phase 3: Complete landing page (Navbar, Hero, Problem, HowItWorks, Features, Testimonials, Waitlist, Footer)
- Phase 4: Waitlist API, app layout with auth guard + sidebar, dashboard, VideoForm, ProgressTracker, VideoCard
- Phase 5: Video pipeline API routes (create, status, understand, script)
- Phase 6: Playwright browser recorder with full demo flow execution
- Phase 7: BullMQ video pipeline worker + FFmpeg video assembler
- Phase 8: .env.local.example, README.md, final reviewer pass and fixes
What Works:
- pnpm type-check passes with ZERO errors
- pnpm build passes cleanly
- All 7 routes visible in build output
- Reviewer agent gave PASS after fixing 3 res.ok checks
What Is Broken: Nothing. All reviewer issues fixed.
Current Focus: COMPLETE
Next Actions:
1. Add real API keys to .env.local
2. Create Supabase project and run supabase/schema.sql
3. Create Supabase Storage bucket named 'videos' (public)
4. Set up Upstash Redis account
5. Run pnpm dev to start the Next.js app
6. Run pnpm worker in a separate terminal to start the video processor
7. Test the full end-to-end flow with a real product URL
8. Deploy Next.js to Vercel, worker to Railway/Render
Architecture Decisions Made:
- pnpm as package manager
- Dark-only design system
- No external UI libraries
- BullMQ + Upstash Redis for job queue (lazy singleton to avoid build-time Redis connection)
- Playwright for browser automation
- Gemini API (gemini-1.5-pro) as the LLM
- Firecrawl for web scraping
- ElevenLabs for voiceover
- fluent-ffmpeg (not Remotion) for video assembly
- retryWithBackoff lives in /lib/utils.ts (no circular imports)
- createServiceClient() only in /workers/ (never in /app/ or /components/)
- Workers use relative imports (../lib/...) for ts-node compatibility
- Zod v4 uses .issues not .errors for error access
Type Check Status: PASS (zero errors)
Build Status: PASS (clean, no Redis errors)

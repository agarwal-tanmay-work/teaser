---
name: api-builder
description: Use when building any new API route or server
             endpoint. Triggered by requests to create backend
             routes, API handlers, or server-side logic.
---
Follow .claude/rules/api-design.md exactly.
Add all new TypeScript types to /types/index.ts first.
Import Supabase from /lib/supabase.ts.
Import logger from /lib/logger.ts. Never console.log.
Add retry logic from /lib/gemini.ts retryWithBackoff for
any Gemini, ElevenLabs, or Firecrawl calls.
Run pnpm type-check after building. Fix every single error.
Update project_state.md when done.

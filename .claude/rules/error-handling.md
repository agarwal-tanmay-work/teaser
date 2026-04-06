# Error Handling Rules
1. Every async function must have try/catch
2. External API calls (Gemini, ElevenLabs, Firecrawl, Supabase)
   must use retryWithBackoff: attempt 1 immediate, attempt 2
   after 1000ms, attempt 3 after 2000ms. Throw after 3 failures.
3. User-facing error messages must ALWAYS be friendly human
   strings. Never expose: stack traces, Supabase error codes,
   API error objects, or any technical details to the UI.
4. Log all errors server-side with logger.error() including
   full context (which function, which input caused it)
5. Failed video jobs must update Supabase video_jobs table
   with status 'failed' and a human-readable error_message
6. All API routes return JSON even for error responses
7. Network timeouts: set explicit timeouts on all fetch calls.
   Firecrawl: 30s. Gemini: 60s. ElevenLabs: 120s. Supabase: 10s.
8. Never let a single failed demo step crash the entire
   Playwright recording session. Skip failed steps and continue.

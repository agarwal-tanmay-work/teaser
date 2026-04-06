---
name: supabase-query
description: Use when writing Supabase database queries, working
             with Supabase auth, storage, or creating new tables.
---
Client selection:
Server components and API routes: createServerClient() from /lib/supabase.ts
Client components: createBrowserClient() from /lib/supabase.ts
Workers (bypasses RLS): createServiceClient() from /lib/supabase.ts

Always handle errors from every Supabase call:
const { data, error } = await supabase.from('table').select()
if (error) throw new Error(`Database error: ${error.message}`)
if (!data) throw new Error('No data returned')

Tables in this project:
- waitlist: id, email, created_at, source, position, notified
- video_jobs: id, user_id, product_url, product_description,
  video_length, tone, features_to_highlight, status, progress,
  progress_message, product_understanding (jsonb), script (jsonb),
  recording_url, final_video_url, error_message, created_at,
  completed_at
- users_profile: id, full_name, company_name, plan,
  videos_generated, created_at

CRITICAL: Never use createServiceClient() in any file that runs
in the browser. It bypasses Row Level Security and exposes all data.
Service client is ONLY for /workers/ files.
Never import SUPABASE_SERVICE_ROLE_KEY anywhere in /app/ or
/components/ or /lib/ files that get bundled to the client.

After creating all 15 scaffold files, show me the complete
folder structure. Then ask for my GitHub username so you can
set up the remote. Wait for my confirmation before Phase 1.

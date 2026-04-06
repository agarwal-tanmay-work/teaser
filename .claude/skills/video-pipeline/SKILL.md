---
name: video-pipeline
description: Use when working on any part of the automated
             video generation system: Playwright recording,
             Gemini script generation, ElevenLabs voiceover,
             FFmpeg assembly, or BullMQ pipeline workers.
---
The video pipeline has exactly 6 stages. Every stage must:
- Update the video_jobs table in Supabase with progress %
  and a human-readable progress_message
- Handle errors gracefully (log, update status, throw)
- Never leave a job stuck in 'processing' status

Progress update pattern (use this exact code):
await supabase
  .from('video_jobs')
  .update({ progress, progress_message: message, status: 'processing' })
  .eq('id', jobId)

Stage reference:
Stage 1 (0-15%): Product understanding
- Firecrawl scrapes the product URL
- Gemini analyzes scraped content
- Output: ProductUnderstanding JSON object

Stage 2 (15-35%): Browser recording
- Playwright opens headless Chrome at 1280x720
- Follows demo_flow steps from Stage 1 output
- Records entire session as .webm video
- Output: path to .webm recording file

Stage 3 (35-55%): Script generation
- Gemini writes narration script timed to recording
- Each segment has start_time, end_time, narration, what_to_show
- Output: VideoScript JSON object

Stage 4 (55-70%): Voiceover generation
- ElevenLabs converts script text to MP3 audio
- Output: path to .mp3 voiceover file

Stage 5 (70-90%): Video assembly
- FFmpeg combines: recording + voiceover + music + captions
- Remotion adds: zoom effects + cursor highlights + intro + outro
- Output: path to final .mp4 file

Stage 6 (90-100%): Upload and cleanup
- Upload MP4 to Supabase Storage bucket 'videos'
- Update video_jobs with final_video_url and status 'completed'
- Delete all temp files in /tmp/recordings/[jobId]/
- Output: public URL of final video

Error pattern: catch error → log it → update video_jobs with
status 'failed' and error_message → throw so BullMQ marks
the job as failed → never swallow errors silently.

Temp file locations:
/tmp/recordings/[jobId]/ — raw Playwright recording
/tmp/voiceovers/[jobId].mp3 — ElevenLabs audio
/tmp/rendered/[jobId].mp4 — assembled video before upload
Always clean up with: fs.rmSync(path, { recursive: true, force: true })

import fs from 'fs'
import { retryWithBackoff } from '@/lib/utils'
import { logger } from '@/lib/logger'
import type { VideoTone } from '@/types'

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech'
const TIMEOUT_MS = 120_000

/**
 * Maps a video tone to the appropriate ElevenLabs voice ID from environment variables.
 * Falls back to the generic ELEVENLABS_VOICE_ID if tone-specific vars are not set.
 * @param tone - The desired tone for the voiceover
 */
function getVoiceId(tone: VideoTone): string {
  const voiceMap: Record<VideoTone, string | undefined> = {
    professional: process.env.ELEVENLABS_VOICE_ID_PROFESSIONAL,
    conversational: process.env.ELEVENLABS_VOICE_ID_CONVERSATIONAL,
    energetic: process.env.ELEVENLABS_VOICE_ID_ENERGETIC,
  }
  return voiceMap[tone] ?? process.env.ELEVENLABS_VOICE_ID ?? ''
}

/**
 * Converts text to speech using the ElevenLabs API and saves the audio to a file.
 * Applies a 120-second timeout and retries up to 3 times with backoff.
 * @param text - The narration text to convert to speech
 * @param tone - The tone style that determines which voice to use
 * @param outputPath - Absolute file path where the MP3 audio will be saved
 * @returns The outputPath after successful file write
 */
export async function generateVoiceover(
  text: string,
  tone: VideoTone,
  outputPath: string
): Promise<string> {
  return retryWithBackoff(async () => {
    const voiceId = getVoiceId(tone)

    let response: Response
    try {
      response = await fetch(`${ELEVENLABS_API_URL}/${voiceId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': process.env.ELEVENLABS_API_KEY ?? '',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error) {
      logger.error('generateVoiceover: network error', { error })
      throw new Error('Failed to connect to voiceover service. Please try again.')
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      logger.error('generateVoiceover: non-OK response from ElevenLabs', {
        status: response.status,
        body: body.slice(0, 300),
      })
      throw new Error('Voiceover generation failed. Please try again.')
    }

    const audioBuffer = await response.arrayBuffer()
    fs.writeFileSync(outputPath, Buffer.from(audioBuffer))

    return outputPath
  })
}

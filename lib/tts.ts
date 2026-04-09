import fs from 'fs'
import { retryWithBackoff } from '@/lib/utils'
import { logger } from '@/lib/logger'
import type { VideoTone } from '@/types'

const TIMEOUT_MS = 120_000

/**
 * Gemini TTS voice presets mapped to video tones.
 * See https://ai.google.dev/gemini-api/docs/text-to-speech
 */
const VOICE_MAP: Record<VideoTone, string> = {
  professional: 'Charon',    // Deep, authoritative
  conversational: 'Puck',    // Friendly, warm
  energetic: 'Kore',         // Bright, upbeat
}

/**
 * Model fallback chain for TTS — try the primary model first,
 * then fall back to alternatives if overloaded.
 */
const TTS_MODELS = [
  'gemini-2.5-flash-preview-tts',
]

/**
 * Converts text to speech using Google Gemini TTS API and saves as a WAV file.
 * Uses the same GEMINI_API_KEY — no extra credentials needed.
 *
 * @param text - The narration text to convert to speech
 * @param tone - The tone style that determines which voice to use
 * @param outputPath - Absolute file path where the audio will be saved
 * @returns The outputPath after successful file write
 */
export async function generateVoiceover(
  text: string,
  tone: VideoTone,
  outputPath: string
): Promise<string> {
  const voiceName = VOICE_MAP[tone] ?? 'Charon'
  const apiKey = process.env.GEMINI_API_KEY ?? ''

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set — cannot generate voiceover.')
  }

  // Split long text into chunks if needed (Gemini TTS has input limits)
  // For most scripts this will be a single chunk
  const chunks = splitTextIntoChunks(text, 4000)
  const audioBuffers: Buffer[] = []

  for (const chunk of chunks) {
    const buffer = await generateChunk(chunk, voiceName, apiKey)
    audioBuffers.push(buffer)
  }

  // Combine all audio chunks
  const combined = Buffer.concat(audioBuffers)

  // Write raw PCM, then convert to WAV format for FFmpeg compatibility
  const wavBuffer = pcmToWav(combined, 24000, 1, 16)

  // Update output path to use .wav extension
  const wavPath = outputPath.replace(/\.mp3$/i, '.wav')
  fs.writeFileSync(wavPath, wavBuffer)
  logger.info(`generateVoiceover: saved ${wavBuffer.length} bytes to ${wavPath}`)

  return wavPath
}

/**
 * Generates a single audio chunk using the Gemini TTS REST API.
 * Retries with backoff on failures.
 */
async function generateChunk(
  text: string,
  voiceName: string,
  apiKey: string
): Promise<Buffer> {
  return retryWithBackoff(async () => {
    let lastError: Error | null = null

    for (const model of TTS_MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
            },
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })

        if (!response.ok) {
          const body = await response.text().catch(() => '')
          logger.warn(`generateChunk: ${model} returned ${response.status}`, {
            body: body.slice(0, 300),
          })
          lastError = new Error(`Gemini TTS (${model}) returned ${response.status}: ${body.slice(0, 200)}`)
          continue
        }

        const data = await response.json() as {
          candidates?: Array<{
            content?: {
              parts?: Array<{
                inlineData?: { mimeType: string; data: string }
              }>
            }
          }>
        }

        const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData
        if (!inlineData?.data) {
          lastError = new Error(`Gemini TTS (${model}) returned no audio data`)
          continue
        }

        return Buffer.from(inlineData.data, 'base64')
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        logger.warn(`generateChunk: ${model} failed`, { error: lastError.message })
      }
    }

    throw lastError ?? new Error('All Gemini TTS models failed')
  }, 3) // 3 retries per chunk is enough
}

/**
 * Splits text into chunks that respect sentence boundaries.
 * Gemini TTS handles up to ~5000 chars but we stay conservative.
 */
function splitTextIntoChunks(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text]

  const chunks: string[] = []
  const sentences = text.split(/(?<=[.!?])\s+/)
  let current = ''

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).length > maxLength && current) {
      chunks.push(current.trim())
      current = sentence
    } else {
      current = current ? current + ' ' + sentence : sentence
    }
  }
  if (current.trim()) {
    chunks.push(current.trim())
  }

  return chunks
}

/**
 * Wraps raw PCM (signed 16-bit little-endian) data in a WAV header
 * so FFmpeg can decode it without guessing the format.
 */
function pcmToWav(
  pcmBuffer: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8
  const blockAlign = (channels * bitsPerSample) / 8
  const dataSize = pcmBuffer.length
  const headerSize = 44
  const header = Buffer.alloc(headerSize)

  // RIFF header
  header.write('RIFF', 0)
  header.writeUInt32LE(dataSize + headerSize - 8, 4)
  header.write('WAVE', 8)

  // fmt sub-chunk
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)          // Sub-chunk size
  header.writeUInt16LE(1, 20)           // PCM format
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)

  // data sub-chunk
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)

  return Buffer.concat([header, pcmBuffer])
}

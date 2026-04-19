import fs from 'fs'
import os from 'os'
import { spawn } from 'child_process'

/** Finds the absolute path to the FFmpeg binary. */
export function getFfmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  const windowsStandard = 'C:\\ffmpeg\\bin\\ffmpeg.exe'
  if (os.platform() === 'win32' && fs.existsSync(windowsStandard)) {
    return windowsStandard
  }
  return 'ffmpeg'
}

/** Finds the absolute path to the FFprobe binary. */
export function getFfprobePath(): string {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH
  const windowsStandard = 'C:\\ffmpeg\\bin\\ffprobe.exe'
  if (os.platform() === 'win32' && fs.existsSync(windowsStandard)) {
    return windowsStandard
  }
  return 'ffprobe'
}

/** Validates that FFmpeg is callable. */
export async function validateFfmpeg(): Promise<void> {
  const binary = getFfmpegPath()
  return new Promise((resolve, reject) => {
    const p = spawn(binary, ['-version'])
    p.on('error', (err) => reject(new Error(`FFmpeg not found at ${binary}: ${err.message}`)))
    p.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg failed to start with code ${code}`))
    })
  })
}

/**
 * Returns the duration of a media file in milliseconds, using ffprobe.
 * Returns null if ffprobe is unavailable or the file can't be probed.
 */
export async function ffprobeDurationMs(inputPath: string): Promise<number | null> {
  const binary = getFfprobePath()
  return new Promise((resolve) => {
    const p = spawn(binary, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ])
    let stdout = ''
    p.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
    p.on('error', () => resolve(null))
    p.on('close', (code) => {
      if (code !== 0) return resolve(null)
      const seconds = parseFloat(stdout.trim())
      if (!Number.isFinite(seconds) || seconds <= 0) return resolve(null)
      resolve(Math.round(seconds * 1000))
    })
  })
}

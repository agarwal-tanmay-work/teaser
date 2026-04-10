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

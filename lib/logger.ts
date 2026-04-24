import winston from 'winston'

const isDevelopment = process.env.NODE_ENV !== 'production'

/**
 * Application-wide logger using Winston.
 * Server-side only — never import this in client components.
 * Uses colorized console output in development and JSON in production.
 */
export const logger = winston.createLogger({
  level: isDevelopment ? 'debug' : 'info',
  format: isDevelopment
    ? winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          // Handle Error objects in meta so they don't show as '{}'
          const cleanMeta: Record<string, unknown> = { ...meta }
          for (const key in cleanMeta) {
            const value = cleanMeta[key]
            if (value instanceof Error) {
              cleanMeta[key] = {
                message: value.message,
                stack: value.stack,
              }
            }
          }
          const metaStr = Object.keys(cleanMeta).length ? ` ${JSON.stringify(cleanMeta)}` : ''
          return `${String(timestamp)} [${level}] ${String(message)}${metaStr}`
        })
      )
    : winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'worker.log' })
  ],
})

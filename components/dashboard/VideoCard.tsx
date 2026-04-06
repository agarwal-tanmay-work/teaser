import type { VideoJob } from '@/types'

interface VideoCardProps {
  job: VideoJob
}

/** Formats a date string into a human-readable relative time (e.g. "2 hours ago"). */
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/** Truncates a URL to a maximum character length with an ellipsis. */
function truncateUrl(url: string, maxLength: number = 40): string {
  if (url.length <= maxLength) return url
  return url.slice(0, maxLength) + '…'
}

/** A card displaying a single video job with its status, progress, and actions. */
export default function VideoCard({ job }: VideoCardProps) {
  return (
    <div className="bg-[#111111] border border-[#1F1F1F] rounded-lg p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium truncate" title={job.product_url}>
            {truncateUrl(job.product_url)}
          </p>
          <p className="text-[#6E6E6E] text-xs mt-1">{timeAgo(job.created_at)}</p>
          {job.status === 'failed' && job.error_message && (
            <p className="text-[#EF4444] text-xs mt-2">{job.error_message}</p>
          )}
        </div>

        {/* Status badge */}
        <div className="flex-shrink-0">
          {job.status === 'pending' && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-[#1F1F1F] text-[#6E6E6E]">
              Pending
            </span>
          )}
          {job.status === 'processing' && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs bg-blue-500/10 text-blue-400">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              Processing {job.progress}%
            </span>
          )}
          {job.status === 'completed' && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-[#22C55E]/10 text-[#22C55E]">
              Completed
            </span>
          )}
          {job.status === 'failed' && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-[#EF4444]/10 text-[#EF4444]">
              Failed
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      {job.status === 'completed' && job.final_video_url && (
        <div className="flex gap-2 mt-3">
          <a
            href={job.final_video_url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 text-xs bg-white text-black font-medium rounded-md hover:bg-gray-100 transition-colors"
          >
            Download
          </a>
          <a
            href={job.final_video_url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 text-xs border border-[#1F1F1F] text-white rounded-md hover:bg-[#1F1F1F] transition-colors"
          >
            View
          </a>
        </div>
      )}
    </div>
  )
}

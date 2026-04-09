/** Status of a video generation job */
export type VideoJobStatus = 'pending' | 'processing' | 'completed' | 'failed'

/** Tone style for the generated video */
export type VideoTone = 'professional' | 'conversational' | 'energetic'

/** Length of the generated video in seconds */
export type VideoLength = 30 | 60 | 90

/** Actions available in a demo flow step */
export type DemoAction = 'scroll_down' | 'scroll_up' | 'click' | 'navigate' | 'wait' | 'hover' | 'type'

/** A single step in the automated demo recording flow */
export interface DemoStep {
  step: number
  action: DemoAction
  description: string
  element_to_click?: string
  navigate_to?: string
  type_text?: string
}

/** Recorded click/interaction event for post-processing zoom effects */
export interface ClickEvent {
  x: number
  y: number
  timestamp: number
  action: string
}

/** Structured understanding of a product extracted by Gemini */
export interface ProductUnderstanding {
  product_name: string
  tagline: string
  core_value_prop: string
  target_audience: string
  top_5_features: string[]
  brand_tone: string
  product_category: string
  problem_being_solved: string
  key_pages_to_visit: string[]
  demo_flow: DemoStep[]
}

/** A single narration segment in the video script */
export interface ScriptSegment {
  start_time: number
  end_time: number
  narration: string
  what_to_show: string
  zoom_target?: string
}

/** Full video script with timed narration segments */
export interface VideoScript {
  total_duration: number
  segments: ScriptSegment[]
}

/** A video generation job stored in Supabase */
export interface VideoJob {
  id: string
  user_id: string
  product_url: string
  product_description?: string
  video_length: VideoLength
  tone: VideoTone
  features_to_highlight?: string
  status: VideoJobStatus
  progress: number
  progress_message?: string
  product_understanding?: ProductUnderstanding
  script?: VideoScript
  recording_url?: string
  final_video_url?: string
  error_message?: string
  created_at: string
  completed_at?: string
}

/** A waitlist entry stored in Supabase */
export interface WaitlistEntry {
  id: string
  email: string
  created_at: string
  source: string
  position: number
  notified: boolean
}

/** A user profile stored in Supabase */
export interface UserProfile {
  id: string
  full_name?: string
  company_name?: string
  plan: 'free' | 'pro' | 'startup' | 'agency'
  videos_generated: number
  created_at: string
}

/** Input payload for creating a new video job */
export interface VideoJobCreateInput {
  product_url: string
  description?: string
  video_length: VideoLength
  tone: VideoTone
  features?: string
  credentials?: {
    username: string
    password: string
  }
}

/** Successful API response wrapper */
export interface ApiSuccess<T> {
  success: true
  data: T
}

/** Failed API response wrapper */
export interface ApiError {
  success: false
  error: string
  details?: unknown
}

/** Union type for all API responses */
export type ApiResponse<T> = ApiSuccess<T> | ApiError

/** Response returned after joining the waitlist */
export interface WaitlistJoinResponse {
  position: number
  message: string
}

/** Response returned after creating a video job */
export interface VideoCreateResponse {
  job_id: string
}

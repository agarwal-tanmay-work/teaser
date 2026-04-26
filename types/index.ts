/** Status of a video generation job */
export type VideoJobStatus = 'pending' | 'processing' | 'completed' | 'failed'

/** Tone style for the generated video */
export type VideoTone = 'professional' | 'conversational' | 'energetic'

/**
 * Target length of the generated video in seconds.
 * The UI offers 120/150/180 as presets but the recorder dynamically adjusts
 * based on how much content the product actually has. Minimum 60, max 300.
 */
export type VideoLength = number

/** Actions available in a demo flow step */
export type DemoAction = 'scroll_down' | 'scroll_up' | 'click' | 'navigate' | 'wait' | 'hover' | 'type'

/**
 * The high-level intent of a demo beat. A beat is a 3-5 step sequence
 * (open → setup → commit → reveal) that demonstrates ONE product capability
 * end-to-end. The goal informs the planner's prompt and the runtime's
 * auto-commit heuristic (search → press Enter, form → click submit, etc.).
 */
export type BeatGoal =
  | 'search'
  | 'form_submit'
  | 'chat_send'
  | 'configure_and_run'
  | 'open_feature'
  | 'navigate_explore'

/**
 * A step's role inside its parent beat. The runtime auto-commits after a
 * step marked 'commit' (unless skipCommit is set) and dwells on the result
 * during the implicit 'reveal' phase that follows.
 */
export type BeatStepRole = 'open' | 'setup' | 'commit' | 'reveal'

/** A single step in the automated demo recording flow */
export interface DemoStep {
  step: number
  action: DemoAction
  description: string
  narration: string
  element_to_click?: string
  navigate_to?: string
  type_text?: string
  /** Beat-aware planner annotation; absent for legacy / seed steps. */
  beatStepRole?: BeatStepRole
  /** Set true when the planner explicitly does NOT want the runtime to auto-commit (e.g. partial form fields). */
  skipCommit?: boolean
}

/**
 * A beat is the unit of demonstration: open feature → setup → commit → reveal.
 * The recorder advances through a queue of beats; each beat resolves to either
 * `achieved` (outcome detected after a commit step) or `abandoned` (no outcome
 * after `attempts` retries, or unrecoverable navigation).
 */
export interface DemoBeat {
  /** Stable id used to tag scenes belonging to this beat (e.g. "beat-1"). */
  id: string
  /** High-level intent — informs the planner prompt and runtime auto-commit heuristic. */
  goal: BeatGoal
  /** One-liner describing what the viewer should see after the commit (e.g. "search results for the query are visible"). */
  outcomeDescription: string
  /** Page URL the recorder should navigate to before running this beat. */
  targetUrl?: string
  /** Realistic value the planner should type (when the beat involves typing). */
  inputHint?: string
  /** Steps materialised by `planBeatSteps` once the recorder reaches the target page. Empty until the beat is active. */
  steps: DemoStep[]
  /** Lifecycle state. `pending` → `active` → (`achieved` | `abandoned`). */
  status: 'pending' | 'active' | 'achieved' | 'abandoned'
  /** Number of plan-and-run attempts spent on this beat. Capped at 2. */
  attempts: number
  /** Path to a screenshot taken at the beat's `open` step. */
  startScreenshotPath?: string
  /** Path to a screenshot taken at the moment the outcome was detected. */
  outcomeScreenshotPath?: string
}

/** Bounding box of a target element on page */
export interface ElementBox {
  x: number
  y: number
  width: number
  height: number
}

/** A specific timed segment to keep in the final video edit */
export interface VideoClip {
  start: number
  end: number
}

/** Per-word timing info for karaoke-style caption reveal */
export interface WordTiming {
  word: string
  startMs: number
  endMs: number
  emphasis?: boolean
}

/** A captured scene from the screenshot-based recorder */
export interface SceneCapture {
  step: number
  action: DemoAction
  description: string
  /**
   * Narration text. Supports `**word**` markup for per-word emphasis
   * — rendered amber + slight scale boost in karaoke captions.
   */
  narration: string
  clips: VideoClip[]
  targetElement: ElementBox | null
  typeText: string | null
  elementNotFound: boolean
  pageUrl: string
  /** Optional pre-computed word timings. When absent, captions distribute words evenly. */
  wordTimings?: WordTiming[]
  /**
   * Path to a representative JPEG screenshot taken mid-clip on disk.
   * Populated by the recorder so the post-recording vision pass can
   * regenerate captions to match what the viewer actually sees.
   */
  screenshotPath?: string
  /** Cheap perceptual-hash signature of the post-action screenshot. Used to detect frozen/looping content. */
  noveltyHash?: string
  /** Id of the beat this scene belongs to. Absent for legacy / seed scenes. */
  beatId?: string
  /** Role within the beat — assembler weighs `commit` + `reveal` clips longer. */
  beatStepRole?: BeatStepRole
  /** How the runtime confirmed the beat outcome (or that it gave up). */
  outcomeKind?: 'url' | 'dom' | 'network' | 'aria-live' | 'timeout' | 'none'
  /** Path to the post-commit reveal screenshot — preferred over the typing-finish frame for caption regen. */
  outcomeScreenshotPath?: string
  /** Which branch of the commitInput cascade fired (or 'skipped' when no commit was attempted). */
  commitKind?: 'form-submit' | 'sibling-button' | 'enter' | 'blur' | 'skipped'
  /** Wall-clock ms spent waiting for the outcome — useful for diagnosing slow products / timeouts. */
  outcomeMs?: number
}

/** Manifest output from the browser recorder */
export interface RecordingManifest {
  productUrl: string
  productName: string
  tagline: string
  totalScenes: number
  scenes: SceneCapture[]
  /**
   * Wall-clock duration in ms reserved at the start of recording.mp4 for
   * page-load and animation settle. No clip ever references this window;
   * it's leading recording garbage that the assembler/Remotion ignore.
   */
  prerollMs?: number
  /**
   * Beats the runtime ran (achieved + abandoned). Empty array for legacy
   * recordings predating beat-driven planning. Verification asserts at
   * least 2 entries with `status === 'achieved'`.
   */
  beats?: DemoBeat[]
  /**
   * Aggregate counters for post-hoc diagnosis. Populated at the end of
   * `recordProduct` so the videoProcessor (and any verification harness)
   * can flag pipeline regressions without re-running the recorder.
   */
  diagnostics?: RecordingDiagnostics
}

/** Aggregate counters surfaced on the manifest for post-run diagnosis. */
export interface RecordingDiagnostics {
  /** How many beats reached `status === 'achieved'`. */
  beatsAchieved: number
  /** How many beats ran but were abandoned. */
  beatsAbandoned: number
  /** Total scenes whose action was 'type'. */
  typesTotal: number
  /** Subset of typesTotal where the runtime detected a real outcome (not timeout/none). */
  typesWithOutcome: number
  /** Reason the live loop ended — see recorder log lines for matching messages. */
  endReason: 'queue-empty' | 'stuck' | 'live-batch-cap' | 'wall-clock-cap' | 'target-met'
}

/**
 * Live snapshot of what's clickable / typeable on the currently loaded page.
 * Built per page from the DOM right before each planning batch so the
 * vision agent picks interactions that actually exist.
 */
export interface DomInventoryItem {
  /** 'button' | 'link' | 'input' | 'search' */
  kind: 'button' | 'link' | 'input' | 'search'
  /** Visible text or accessible label (for inputs: placeholder or aria-label). */
  text: string
  /** Stable selector usable by Playwright's locator engine when text-find fails. */
  selector: string
  /** Bounding box at scan time (page may scroll, so consumers should re-find). */
  box: ElementBox
  /** True for buttons/links that look like a primary CTA (matches "sign up", "try", "start", etc.). */
  primaryCta?: boolean
  /** Semantic role of the input — informs realistic sample-text generation. */
  inputType?: 'text' | 'search' | 'email' | 'password' | 'textarea' | 'tel' | 'url' | 'number'
  /**
   * Resolved absolute destination URL when the item navigates somewhere.
   * Anchors → `el.href`. Buttons → best-effort from `data-href`, `formaction`,
   * or a literal URL inside `onclick`. Used to filter forbidden-revisit
   * destinations BEFORE the planner sees the inventory.
   */
  resolvedHref?: string
}

/** Aggregated counts + shortlist returned by `scanDomInventory`. */
export interface DomInventory {
  buttonCount: number
  linkCount: number
  inputCount: number
  searchCount: number
  /** First strong primary CTA found, if any. */
  primaryCta: DomInventoryItem | null
  /** Top items for use in the planner prompt. Capped to ~12 entries. */
  items: DomInventoryItem[]
}

/** Recorded click/interaction event for post-processing zoom effects */
export interface ClickEvent {
  x: number
  y: number
  timestamp: number
  action: string
}

/** Scroll-depth sample recorded during demo playback */
export interface ScrollEvent {
  timestamp: number
  scrollPercent: number  // 0–1, fraction of page scrolled
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
  /**
   * 2-3 seed beats synthesised from `top_5_features` + `key_pages_to_visit`.
   * The recorder seeds its `BeatRunner` queue from this list; if empty, the
   * runner falls back to adaptive `proposeBeat` calls.
   */
  proposed_beats?: DemoBeat[]
  /**
   * Verbatim text the user typed into "What does your product do?" — stamped
   * server-side after the model returns so it can't be overridden by
   * hallucination. Downstream beat planning treats this as ground truth.
   */
  user_description?: string
  /**
   * Verbatim text the user typed into "Key features to show" — same stamping
   * rule. The recorder prioritises beats that demonstrate THESE features over
   * the model's inferred top_5_features.
   */
  user_features?: string
}

/** A single narration segment in the video script */
export interface ScriptSegment {
  start_time: number
  end_time: number
  narration: string
  what_to_show: string
  action: DemoAction
  element_to_click?: string
  navigate_to?: string
  type_text?: string
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

/** A single action decision returned by the vision-based demo agent */
export interface AgentAction {
  action: DemoAction | 'done'
  element_text?: string
  navigate_to?: string
  type_text?: string
  description: string
  narration: string
  skip_from_video?: boolean
}

/**
 * A single interactive element discovered on the live rendered page.
 * Used to ground Gemini's demo_flow against real DOM text instead of
 * scraped HTML guesses.
 */
export interface InteractiveElement {
  /** Visible text the recorder will match against (button/link label). */
  text: string
  /** DOM role, e.g. 'link' | 'button' | 'input'. */
  role: 'link' | 'button' | 'input'
  /** Absolute href if this is an `<a>` element, otherwise undefined. */
  href?: string
  /** Page URL where this element was found (the inventory spans multiple pages). */
  foundOn: string
}

/**
 * Aggregated reconnaissance output: every real same-origin URL and every
 * visible click target discovered by loading the site in Playwright.
 */
export interface InteractiveInventory {
  /** Same-origin URLs discovered via sitemap.xml, robots.txt, Firecrawl map, and live DOM. */
  subpages: string[]
  /** Clickable elements across discovered pages — the only strings Gemini is allowed to put in `element_to_click`. */
  elements: InteractiveElement[]
}

/** Input payload for creating a new video job */
export interface VideoJobCreateInput {
  product_url: string
  /** Where the recording agent starts inside the app — use this for post-login app URLs */
  start_url?: string
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

/**
 * Props for the Remotion `TeaserVideo` master composition.
 * Index signature satisfies Remotion's `Props extends Record<string, unknown>`
 * constraint on `<Composition>` without widening the named fields.
 */
export interface TeaserVideoProps {
  scenes: SceneCapture[]
  recordedVideoUrl?: string
  voiceoverUrl?: string
  musicUrl?: string
  productName: string
  tagline: string
  productUrl: string
  [key: string]: unknown
}

/** Props for the Remotion `Intro` composition (animated product card, 3 s). */
export interface IntroProps {
  productName: string
  tagline: string
  [key: string]: unknown
}

/** Props for the Remotion `Outro` composition (CTA card, 4 s). */
export interface OutroProps {
  productName: string
  productUrl?: string
  [key: string]: unknown
}

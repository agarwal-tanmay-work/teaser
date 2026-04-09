# Design Tokens

## Colors (Dark Mode Primary)

### Backgrounds
- **Primary:** Pure Black (`#000000`) or Tailwind `bg-black`
- **Secondary (Cards/Elements):** Deep Gray/Black mix with low opacity, typically using `bg-black/50`, `bg-zinc-950` with glassmorphism `backdrop-blur-md`
- **Borders:** Thin semi-transparent borders `border-white/10` or `border-zinc-800`

### Typography Colors
- **Headings & Primary Text:** Pure White (`#FFFFFF`) / `text-white`
- **Secondary & Support Text:** `text-zinc-300` / `text-neutral-300`
- **Muted Elements (e.g., Footer Links):** `text-zinc-500`

### Accents
- **Glows:** Blueish/cyan semi-transparent blurred gradients in the background behind hero or cards
- **Buttons:** 
  - Primary: Solid White (`bg-white text-black`)
  - Secondary: Ghost with outline (`border border-white/20 hover:bg-white/10`)

## Typography

- **Font Family:** Clean geometric sans-serif (e.g., Inter, Geist, or equivalent).
- **Hero Headings:** 
  - Size: Extra large (`text-5xl` md:`text-7xl`)
  - Weight: Bold (`font-bold` or `font-extrabold`)
  - Tracking: Tighter tracking (`tracking-tight`)
- **Body Text:**
  - Size: Standard `text-base` or `text-lg`
  - Leading: Relaxed to normal (`leading-relaxed`)

## Spacing & Spacing

- **Section Spacing:** Generous vertical padding (`py-24`, `py-32`)
- **Container Max-Width:** Desktop constraints to keep content central (`max-w-7xl` or `max-w-6xl`)
- **Border Radius:** 
  - Rounded structural elements (`rounded-2xl` or `rounded-full` for badges)
  - Pill buttons (`rounded-full`)

## Elevation & Glassmorphism

- Heavy reliance on backdrop blur (`backdrop-blur-lg` or `backdrop-blur-xl`) with low-opacity structural backgrounds for floating nav and modal-like cards.

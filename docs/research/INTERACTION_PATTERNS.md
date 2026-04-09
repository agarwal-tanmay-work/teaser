# Interaction Patterns

## Hover States
- **Buttons:** 
  - Primary button may slightly lift or have a bright overlay.
  - Links and text convert from `text-zinc-500` to `text-white` with a fast transition.
- **Cards:** 
  - Faint border glow on hover (`border-white/30`).
  - Potential scale transformation (`scale-[1.02]`).

## Active / Press States
- **Buttons:** `active:scale-[0.98]` to provide a tactile 'pushed in' feeling.

## Entrance Animations
- Staggered fade in and translate-up on page load.
- Elements appearing as they scroll into view (common via Framer Motion or lightweight IntersectionObservers).

## Custom Component Interactions
- **Marquee:** Continuous linear CSS or JS-driven rotation. Pauses on hover optional.
- **Live Collaboration Mockup:** Animated cursors moving over text to simulate other active users (key feature highlight of the Cardboard editor).

## Focus & Accessibility
- Expected standard focus rings (or custom outline offsets) when navigating via keyboard.

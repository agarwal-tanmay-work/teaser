# Component Inventory

## 1. Floating Navigation Bar
- **Structure:** `nav` element containing logo on left, centered links (optional), and auth actions on right.
- **States:** Sticky top, `backdrop-blur-md`, subtle bottom border (`border-b border-white/10`).
- **Variants:** None (consistent across scroll).

## 2. Hero Section
- **Structure:** Badge ("Backed by Y Combinator"), huge `h1` heading, sub-paragraph, and button group (Primary "Get started", Secondary Ghost "Watch our launch video").
- **Animations:** Fade in, slight upward translation on mount.

## 3. Editor Preview (Signature Component)
- **Structure:** Large stylized container showcasing the application UI (Timeline, Media Library, Video player). This is a complex composite image or interactive mock.
- **Styling:** Often wrapped in a glowing container or subtle drop shadow in dark mode.

## 4. Logo Marquee
- **Structure:** "Used by humans at" text, followed by an infinite auto-scrolling row of grayscale/white semi-transparent logos.

## 5. Feature Carousel (Cover Flow)
- **Structure:** Horizontal slider containing video categories (Talking heads, Vlogs, etc.).
- **Interactions:** Draggable or next/prev button driven. Selected item is scaled up/focused, others are slightly faded or scaled down.

## 6. Feature Concept Cards
- **Structure:** Rounded cards showcasing product features (e.g., "Live collaboration").
- **Styling:** `bg-zinc-900/50` or similar, `border border-white/10`. Inside, visual representation (e.g. animated SVG cursors) and a short title/description.

## 7. Pricing / Final CTA
- **Structure:** Centered text, price tag (`$60/month`), and action buttons identical in styling to hero buttons.

## 8. Footer
- **Structure:** Simple grid layout. 3 columns for links (Product, Legal, Company), and social icons.
- **Styling:** Links in `text-zinc-500 hover:text-white transition-colors`. Social icons as circular bordered elements.

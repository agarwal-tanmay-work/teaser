# Layout Architecture

## Grid System
- Standard 12-column grid or CSS standard Flex/Grid equivalent layouts for most interior content.
- Use of CSS Grid for multi-column footer and generic feature presentation (e.g. `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`).

## Breakpoints (Mobile-First)
- **sm/md (Mobile to Tablet):** Shifts from single-column vertical stacks to multi-column.
- **lg/xl (Desktop):** Max-width constraints apply (`max-w-7xl mx-auto`). Margins handle centering.

## Sticky & Z-Index Layers
- **Navbar:** Sticky top, high z-index (e.g. `z-50`), providing navigation above all content.
- **Background Glows:** Absolute or fixed positioned blurred gradients set behind main content (`-z-10`).
- **Feature Cards / Media elements:** Middle z-index (e.g., `z-10`) layered dynamically depending on slider or stack context.

## Scrolling & Flow
- Direct vertical scroll flow.
- Large breathing room (`gap` and padding/margin) to ensure individual feature focus.
- Specific sections feature horizontal scrolling/carousels which must hide overflow (`overflow-x-hidden`) inside the grid.

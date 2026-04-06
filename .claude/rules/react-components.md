# React Component Rules
1. Default to Server Components. Never add 'use client' unless
   you need: useState, useReducer, useEffect, event handlers,
   or browser-only APIs (window, document, etc.)
2. All props must have explicit TypeScript interface defined
   in the component file or in /types/index.ts
3. Never put business logic inside components. Move to /lib/
4. Mobile-first always: design for 375px first, then 768px,
   then 1280px. Never desktop-first.
5. Framer Motion for all animations. No CSS transitions except
   for simple hover effects.
6. Design tokens — use EXACTLY these Tailwind values:
   bg-[#0A0A0A] for page background
   bg-[#111111] for all cards and surfaces
   border border-[#1F1F1F] for all borders
   text-white for primary text
   text-[#6E6E6E] for secondary/muted text
   rounded-lg for cards (8px)
   rounded-md for buttons and inputs (6px)
7. Never use external UI component libraries. Build from scratch.
8. Every component file exports one default component.

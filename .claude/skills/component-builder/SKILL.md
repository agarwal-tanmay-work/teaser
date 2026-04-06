---
name: component-builder
description: Use when building any new React component, page
             section, layout, or UI element. Triggered by
             requests to create anything visual or frontend.
---
Follow .claude/rules/react-components.md exactly.
File locations:
- Landing page sections: /components/landing/
- Dashboard UI: /components/dashboard/
- Shared UI primitives: /components/ui/
Always start with Server Component. Add 'use client' only
if genuinely needed. Define TypeScript props interface first.
Check design tokens match .claude/rules/react-components.md.
Mentally verify layout works at 375px before finishing.
Run pnpm type-check after building.

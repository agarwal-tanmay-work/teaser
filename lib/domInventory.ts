import type { Page } from 'playwright'
import type { DomInventory, DomInventoryItem } from '../types'
import { logger } from './logger'

/**
 * Scans the live DOM of `page` and returns a shortlist of the most useful
 * interactive elements visible right now — buttons, navigation links, text
 * inputs, search bars, and an optional primary CTA.
 *
 * The vision agent uses this inventory to bias its plan toward interactions
 * that ACTUALLY exist on this page, instead of falling back to scroll when
 * Gemini can't read button text from a screenshot. The fallback path also
 * uses it: if Gemini fails entirely, we click the primary CTA / type into
 * the first search field directly.
 *
 * Capped at ~12 items so the prompt stays compact.
 */
export async function scanDomInventory(page: Page): Promise<DomInventory> {
  try {
    const raw = await page.evaluate((): {
      buttonCount: number
      linkCount: number
      inputCount: number
      searchCount: number
      items: Array<{
        kind: 'button' | 'link' | 'input' | 'search'
        text: string
        selector: string
        x: number
        y: number
        width: number
        height: number
        primaryCta?: boolean
        inputType?: string
        resolvedHref?: string
      }>
    } => {
      const PRIMARY_RE = /^(sign up|sign in|signup|signin|log in|login|try|try it|try free|start|start free|start now|get started|get a demo|book|book a demo|launch|create|generate|continue|next|join|register|free trial|see demo|watch demo|learn more|explore)/i
      const SKIP_RE = /(cookie|consent|gdpr|accept|dismiss|close|got it|no thanks|menu|hamburger|search icon|back to top)/i

      const isVisible = (el: Element): boolean => {
        const r = (el as HTMLElement).getBoundingClientRect()
        if (r.width <= 4 || r.height <= 4) return false
        const cs = window.getComputedStyle(el as HTMLElement)
        if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false
        if (r.bottom < 0 || r.top > window.innerHeight + 200) return false
        return true
      }

      const cleanText = (el: Element): string => {
        const txt = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (txt) return txt.slice(0, 60)
        const aria = el.getAttribute('aria-label')
        if (aria) return aria.slice(0, 60)
        const title = el.getAttribute('title')
        if (title) return title.slice(0, 60)
        const value = (el as HTMLInputElement).value
        if (value) return value.slice(0, 60)
        return ''
      }

      const buildSelector = (el: Element, kind: string): string => {
        const id = el.id
        if (id && /^[A-Za-z][\w-]*$/.test(id)) return `#${id}`
        const txt = cleanText(el)
        if (txt && (kind === 'button' || kind === 'link')) {
          return `${kind === 'link' ? 'a' : 'button'}:has-text("${txt.replace(/"/g, '\\"').slice(0, 40)}")`
        }
        const placeholder = (el as HTMLInputElement).placeholder
        if (placeholder) return `[placeholder="${placeholder.replace(/"/g, '\\"').slice(0, 40)}"]`
        const aria = el.getAttribute('aria-label')
        if (aria) return `[aria-label="${aria.replace(/"/g, '\\"').slice(0, 40)}"]`
        return el.tagName.toLowerCase()
      }

      const items: Array<{
        kind: 'button' | 'link' | 'input' | 'search'
        text: string
        selector: string
        x: number
        y: number
        width: number
        height: number
        primaryCta?: boolean
        inputType?: string
        resolvedHref?: string
      }> = []

      // Best-effort URL extraction from a button: data-href, formaction, or
      // a literal http(s) URL inside an inline onclick handler. The runtime's
      // click gate uses this to skip clicks that would land on a forbidden URL.
      const extractButtonHref = (el: Element): string | undefined => {
        const dataHref = el.getAttribute('data-href')
        if (dataHref) {
          try { return new URL(dataHref, location.href).toString() } catch { /* ignore */ }
        }
        const formAction = el.getAttribute('formaction')
        if (formAction) {
          try { return new URL(formAction, location.href).toString() } catch { /* ignore */ }
        }
        const onclick = el.getAttribute('onclick') ?? ''
        const m = onclick.match(/https?:\/\/[^\s'"`)]+/)
        if (m) {
          try { return new URL(m[0]).toString() } catch { /* ignore */ }
        }
        return undefined
      }

      let buttonCount = 0
      let linkCount = 0
      let inputCount = 0
      let searchCount = 0

      // Hard cap per kind so a degenerate page (e.g. 5000 buttons) doesn't
      // spike CPU or stall the recording. Items shortlist is already capped
      // at 24 below; this caps the *scan* itself at 200 per kind.
      const MAX_SCAN_PER_KIND = 200

      // Buttons — both <button> and role=button
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).slice(0, MAX_SCAN_PER_KIND)
      for (const el of buttons) {
        if (!isVisible(el)) continue
        const text = cleanText(el)
        if (!text || text.length < 2 || SKIP_RE.test(text)) continue
        const r = (el as HTMLElement).getBoundingClientRect()
        buttonCount++
        if (items.length < 24) {
          items.push({
            kind: 'button',
            text,
            selector: buildSelector(el, 'button'),
            x: Math.round(r.x + r.width / 2),
            y: Math.round(r.y + r.height / 2),
            width: Math.round(r.width),
            height: Math.round(r.height),
            primaryCta: PRIMARY_RE.test(text),
            resolvedHref: extractButtonHref(el),
          })
        }
      }

      // Same-origin links
      const origin = location.origin
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).slice(0, MAX_SCAN_PER_KIND)
      for (const el of links) {
        if (!isVisible(el)) continue
        const text = cleanText(el)
        if (!text || text.length < 2 || SKIP_RE.test(text)) continue
        let resolvedHref: string | undefined
        try {
          const url = new URL(el.href)
          if (url.origin !== origin) continue
          resolvedHref = url.toString()
        } catch {
          continue
        }
        const r = el.getBoundingClientRect()
        linkCount++
        if (items.length < 24) {
          items.push({
            kind: 'link',
            text,
            selector: buildSelector(el, 'link'),
            x: Math.round(r.x + r.width / 2),
            y: Math.round(r.y + r.height / 2),
            width: Math.round(r.width),
            height: Math.round(r.height),
            primaryCta: PRIMARY_RE.test(text),
            resolvedHref,
          })
        }
      }

      // Inputs and textareas
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]), textarea, [contenteditable="true"]'
      )).slice(0, MAX_SCAN_PER_KIND)
      for (const el of inputs) {
        if (!isVisible(el)) continue
        const placeholder = (el as HTMLInputElement).placeholder ?? ''
        const aria = el.getAttribute('aria-label') ?? ''
        const text = (placeholder || aria || (el.tagName === 'TEXTAREA' ? 'Message' : 'Input')).slice(0, 60)
        const r = (el as HTMLElement).getBoundingClientRect()
        const inputType = el instanceof HTMLInputElement
          ? (el.type as 'text' | 'search' | 'email' | 'password' | 'tel' | 'url' | 'number')
          : 'textarea'
        const isSearch = inputType === 'search'
          || /search/i.test(placeholder)
          || /search/i.test(aria)
          || /search/i.test(el.getAttribute('name') ?? '')
        if (isSearch) searchCount++
        else inputCount++
        if (items.length < 24) {
          items.push({
            kind: isSearch ? 'search' : 'input',
            text,
            selector: buildSelector(el, isSearch ? 'search' : 'input'),
            x: Math.round(r.x + r.width / 2),
            y: Math.round(r.y + r.height / 2),
            width: Math.round(r.width),
            height: Math.round(r.height),
            inputType,
          })
        }
      }

      return { buttonCount, linkCount, inputCount, searchCount, items }
    })

    const items: DomInventoryItem[] = raw.items.map((it) => ({
      kind: it.kind,
      text: it.text,
      selector: it.selector,
      box: { x: it.x, y: it.y, width: it.width, height: it.height },
      primaryCta: it.primaryCta,
      inputType: it.inputType as DomInventoryItem['inputType'],
      resolvedHref: it.resolvedHref,
    }))

    // Rank items: primary CTAs first, then search, then inputs, then buttons, then links.
    const rankWeight = (it: DomInventoryItem): number => {
      let w = 0
      if (it.primaryCta) w += 100
      if (it.kind === 'search') w += 60
      else if (it.kind === 'input') w += 50
      else if (it.kind === 'button') w += 20
      else w += 10
      return w
    }
    items.sort((a, b) => rankWeight(b) - rankWeight(a))
    const shortlist = items.slice(0, 12)
    const primaryCta = items.find((it) => it.primaryCta && (it.kind === 'button' || it.kind === 'link')) ?? null

    return {
      buttonCount: raw.buttonCount,
      linkCount: raw.linkCount,
      inputCount: raw.inputCount,
      searchCount: raw.searchCount,
      primaryCta,
      items: shortlist,
    }
  } catch (err) {
    logger.warn('domInventory: scan failed', { err })
    return {
      buttonCount: 0,
      linkCount: 0,
      inputCount: 0,
      searchCount: 0,
      primaryCta: null,
      items: [],
    }
  }
}

/**
 * Builds a short, prompt-ready summary of an inventory for the planner.
 * Example: "4 buttons, 2 inputs, 1 search field. Primary CTA: 'Try it free'.
 *  Top elements: button 'Pricing', link 'Features', search 'Search docs', input 'Email'."
 */
export function inventoryDigest(inv: DomInventory): string {
  const counts: string[] = []
  if (inv.buttonCount) counts.push(`${inv.buttonCount} button${inv.buttonCount === 1 ? '' : 's'}`)
  if (inv.linkCount) counts.push(`${inv.linkCount} link${inv.linkCount === 1 ? '' : 's'}`)
  if (inv.inputCount) counts.push(`${inv.inputCount} input${inv.inputCount === 1 ? '' : 's'}`)
  if (inv.searchCount) counts.push(`${inv.searchCount} search field${inv.searchCount === 1 ? '' : 's'}`)
  const summary = counts.length ? counts.join(', ') : 'no obvious interactive elements'
  const cta = inv.primaryCta ? ` Primary CTA: "${inv.primaryCta.text}".` : ''
  const top = inv.items.slice(0, 6).map((it) => `${it.kind} "${it.text}"`).join(', ')
  return `${summary}.${cta}${top ? ` Top elements: ${top}.` : ''}`
}

/**
 * Drops items from the inventory whose `resolvedHref` belongs to a forbidden
 * destination. This is the hard gate that prevents the planner from ever
 * proposing "click Home" / "click Logo" / "click Pricing" once those URLs
 * have been visited and explored. The recorder calls this before every
 * planner request so the model literally cannot suggest a forbidden click.
 */
export function filterInventory(
  inv: DomInventory,
  forbiddenKeys: Set<string>,
  urlKey: (u: string) => string,
): DomInventory {
  if (forbiddenKeys.size === 0) return inv
  const allowed = inv.items.filter((it) => {
    if (!it.resolvedHref) return true
    try {
      return !forbiddenKeys.has(urlKey(it.resolvedHref))
    } catch {
      return true
    }
  })
  const primaryCta = inv.primaryCta && allowed.includes(inv.primaryCta) ? inv.primaryCta : (
    allowed.find((it) => it.primaryCta && (it.kind === 'button' || it.kind === 'link')) ?? null
  )
  return {
    buttonCount: inv.buttonCount,
    linkCount: inv.linkCount,
    inputCount: inv.inputCount,
    searchCount: inv.searchCount,
    primaryCta,
    items: allowed,
  }
}

/**
 * Prompt-ready summary that renders each link with its destination path so the
 * planner sees `link "Pricing" (→ /pricing)` instead of just `link "Pricing"`.
 * The destination annotation tightens grounding and makes the post-filter list
 * self-documenting (every link shown is, by construction, a non-forbidden one).
 */
export function inventoryDigestWithDestinations(inv: DomInventory, baseUrl: string): string {
  const counts: string[] = []
  if (inv.buttonCount) counts.push(`${inv.buttonCount} button${inv.buttonCount === 1 ? '' : 's'}`)
  if (inv.linkCount) counts.push(`${inv.linkCount} link${inv.linkCount === 1 ? '' : 's'}`)
  if (inv.inputCount) counts.push(`${inv.inputCount} input${inv.inputCount === 1 ? '' : 's'}`)
  if (inv.searchCount) counts.push(`${inv.searchCount} search field${inv.searchCount === 1 ? '' : 's'}`)
  const summary = counts.length ? counts.join(', ') : 'no obvious interactive elements'
  const cta = inv.primaryCta ? ` Primary CTA: "${inv.primaryCta.text}".` : ''
  let base: URL | null = null
  try { base = new URL(baseUrl) } catch { /* leave null */ }
  const top = inv.items.slice(0, 8).map((it) => {
    let dest = ''
    if (it.resolvedHref) {
      try {
        const u = new URL(it.resolvedHref)
        dest = base && u.origin === base.origin ? ` (→ ${u.pathname || '/'})` : ` (→ ${u.toString()})`
      } catch { /* ignore */ }
    }
    return `${it.kind} "${it.text}"${dest}`
  }).join(', ')
  return `${summary}.${cta}${top ? ` Top elements: ${top}.` : ''}`
}

/**
 * Realistic sample text for typing into an input based on its semantic type
 * and the product context. Keeps the demo from showing generic "test" or
 * "hello world" inputs which read as fake.
 */
export function sampleTypeText(inputType: DomInventoryItem['inputType'] | undefined, productName: string): string {
  switch (inputType) {
    case 'search':
      return `${productName.split(' ')[0].toLowerCase()} workflow`
    case 'email':
      return 'demo@example.com'
    case 'password':
      return '••••••••'
    case 'tel':
      return '+1 555 0123'
    case 'url':
      return 'https://example.com'
    case 'number':
      return '42'
    case 'textarea':
      return `Try ${productName} for our team`
    default:
      return `Try ${productName}`
  }
}

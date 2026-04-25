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
      }> = []

      let buttonCount = 0
      let linkCount = 0
      let inputCount = 0
      let searchCount = 0

      // Buttons — both <button> and role=button
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
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
          })
        }
      }

      // Same-origin links
      const origin = location.origin
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
      for (const el of links) {
        if (!isVisible(el)) continue
        const text = cleanText(el)
        if (!text || text.length < 2 || SKIP_RE.test(text)) continue
        try {
          const url = new URL(el.href)
          if (url.origin !== origin) continue
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
          })
        }
      }

      // Inputs and textareas
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]), textarea, [contenteditable="true"]'
      ))
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

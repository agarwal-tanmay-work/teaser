# API Route Rules
Every API route uses this exact structure:
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { logger } from '@/lib/logger'
const Schema = z.object({ /* fields here */ })
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = Schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      )
    }
    const { /* fields */ } = parsed.data
    /* business logic */
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    logger.error('route-name error:', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
HTTP codes: 200 success, 201 created, 400 validation failed,
401 unauthorized, 404 not found, 409 conflict, 500 server error
Never return raw error strings. Always wrap in friendly message.
Always add new types to /types/index.ts before writing the route.

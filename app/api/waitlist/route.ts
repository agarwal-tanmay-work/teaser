import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { ApiResponse, WaitlistJoinResponse } from '@/types'

const WaitlistSchema = z.object({
  email: z.string().email('Please enter a valid email address.'),
})

/**
 * POST /api/waitlist
 * Adds an email to the Teaser waitlist.
 * Returns the position number on success.
 * Handles duplicate emails gracefully by returning the existing position.
 */
export async function POST(req: NextRequest): Promise<NextResponse<ApiResponse<WaitlistJoinResponse>>> {
  try {
    const body: unknown = await req.json()
    const parsed = WaitlistSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid email address.' },
        { status: 400 }
      )
    }

    const { email } = parsed.data
    const supabase = createServerClient()

    // Count existing entries to calculate position
    const { count, error: countError } = await supabase
      .from('waitlist')
      .select('*', { count: 'exact', head: true })

    if (countError) {
      logger.error('waitlist POST: count error', { error: countError.message })
      return NextResponse.json(
        { success: false, error: 'Something went wrong. Please try again.' },
        { status: 500 }
      )
    }

    const position = (count ?? 0) + 1

    const { error: insertError } = await supabase.from('waitlist').insert({
      email,
      position,
      source: 'landing_page',
    })

    if (insertError) {
      // Unique constraint violation (code 23505) = email already on waitlist
      if (insertError.code === '23505') {
        return NextResponse.json({
          success: true,
          data: {
            position,
            message: 'You are already on the list! We will be in touch soon.',
          },
        })
      }
      logger.error('waitlist POST: insert error', { error: insertError.message })
      return NextResponse.json(
        { success: false, error: 'Something went wrong. Please try again.' },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          position,
          message: `You are on the list! You are number ${position}.`,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    logger.error('waitlist POST: unexpected error', { error })
    return NextResponse.json(
      { success: false, error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}

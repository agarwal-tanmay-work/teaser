import { understandProduct } from './lib/gemini'
import fs from 'fs'
import { config } from 'dotenv'
config({ path: '.env.local' })

async function debug() {
  const productUrl = 'https://beaconai-system.vercel.app/'
  const scrapedContent = '# BeaconAI System\n\nAI Monitoring and observability.'
  
  try {
    console.log('Running understandProduct...')
    const res = await understandProduct(productUrl, scrapedContent)
    console.log('SUCCESS:', JSON.stringify(res, null, 2))
  } catch (err: any) {
    console.log('--- ERROR DETECTED ---')
    console.log('Message:', err.message)
    if (err.issues) {
      console.log('Zod Issues:', JSON.stringify(err.issues, null, 2))
    } else {
      console.log('Full Error:', err)
    }
  }
}

debug()

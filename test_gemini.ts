import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

async function test() {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const res = await model.generateContent('hello');
    console.log('gemini-1.5-flash worked:', res.response.text());
  } catch (e: any) {
    console.error('gemini-1.5-flash error:', e.message);
  }
}
test();

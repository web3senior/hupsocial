import OpenAI from "openai";
import { NextResponse } from 'next/server'

// Initialize the client.
// It automatically picks up GEMINI_API_KEY from your .env file.
const openai = new OpenAI({
        baseURL: 'https://api.deepseek.com',
        apiKey: process.env.DEEPSEEK_API_KEY,
});


export async function POST(req) {
  try {
    // 1. Extract prompt from the request body
    const { profile, posts } = await req.json()

    if (!profile || !posts) {
      return NextResponse.json({ error: 'Profile and posts are required' }, { status: 400 })
    }

    const systemPrompt = `
  Analyze this Web3 user.
  Name: ${profile.name}
  Bio: ${profile.bio}
  Activity: ${posts}

  Return a JSON-style response (but as plain text) containing:
  1. A 2-sentence summary.
  2. A "Web3 Vibe" title.
  3. Personality Scores (0-100) for: Degen, Builder, and Researcher.
`

    // 2. Generate content using the new SDK syntax
  const completion = await openai.chat.completions.create({
    messages: [{ role: "system", content: systemPrompt }],
    model: "deepseek-chat",
  });

    const text = completion.choices[0].message.content

    // 3. Return the response text
    return NextResponse.json({ json: JSON.parse(text) })
  } catch (error) {
    console.error('Gemini API Error:', error)
    return NextResponse.json(
      { error: 'Failed to generate content', details: error.message },
      { status: 500 }
    )
  }
}

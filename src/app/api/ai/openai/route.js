import OpenAI from 'openai'
import { NextResponse } from 'next/server'

// Initialize the client.
// It automatically picks up GEMINI_API_KEY from your .env file.
const client = new OpenAI()

export async function POST(req) {
  try {
    // 1. Extract prompt from the request body
    const { profile, posts, poaps } = await req.json()

    if (!profile || !posts) {
      return NextResponse.json({ error: 'Profile and posts are required' }, { status: 400 })
    }

    const systemPrompt = `
  You are an expert Web3 Cultural Analyst. Your task is to analyze a user's on-chain persona based on their profile, social activity, and POAP history.

  ### DATA TO ANALYZE:
  - Name: ${profile.name}
  - Bio: ${profile.bio}
  - Recent Activity: ${posts}
  - POAP History: ${poaps} (What is POAP? POAP, short for Proof of Attendance Protocol, allows you to mint memories as digital mementos we call POAPs.)

  ### SCORING LOGIC:
  1. **Degen (0-100):** High scores for memecoin mentions, high-frequency trading, NFT flipping, "apeing" into new projects, and use of slang like "LFG", "GM", or "Moon".
  2. **Builder (0-100):** High scores for technical terms (Solidity, Rust, SDKs), hackathon POAPs (ETHGlobal), mentions of building/shipping, and GitHub activity.
  3. **Researcher (0-100):** High scores for long-form analysis, governance voting, whitepaper discussions, DAO participation, and educational POAPs.

  ### OUTPUT REQUIREMENTS:
  - **Summary:** A sharp, insightful 2-sentence breakdown of who they are in the ecosystem. Avoid generic "This user is active" filler.
  - **Web3 Vibe:** A creative, 2-4 word "Archetype" title (e.g., "The Stealth Alpha Hunter", "Protocol Architect", "Governance Minimalist", "High-Stakes Yield Farmer").
  - **Format:** Return ONLY a valid JSON object. No markdown blocks, no extra text.

  JSON structure:
  {
    "summary": "string",
    "web3_vibe": "string",
    "scores": {
        "degen": number,
        "builder": number,
        "researcher": number
    }
  }
`

    // 2. Generate content using the new SDK syntax
    const response = await client.responses.create({
      model: 'gpt-5-nano',
      input: systemPrompt,
    })

    const text = response.output_text

    // 3. Return the response text
    return NextResponse.json(JSON.parse(text))
  } catch (error) {
    console.error('Gemini API Error:', error)
    return NextResponse.json(
      { error: 'Failed to generate content', details: error.message },
      { status: 500 }
    )
  }
}

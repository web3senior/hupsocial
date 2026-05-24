import { Indexer } from "@0gfoundation/0g-ts-sdk"
import { NextResponse } from "next/server"
import sharp from "sharp"

export const runtime = "nodejs"

function intParam(value, fallback, min, max) {
  const parsed = Number.parseInt(value ?? "", 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const rootHash = searchParams.get("hash")

  const width = intParam(searchParams.get("w"), null, 1, 4096)
  const quality = intParam(searchParams.get("q"), 80, 1, 100)

  if (!rootHash) {
    return NextResponse.json({ error: "Root Hash is required" }, { status: 400 })
  }

  try {
    const INDEXER_RPC =
      process.env.INDEXER_RPC || "https://indexer-storage-testnet-turbo.0g.ai"

    const indexer = new Indexer(INDEXER_RPC)
    const [blob, dlErr] = await indexer.downloadToBlob(rootHash)

    if (dlErr !== null) {
      throw new Error(`0G Indexer Download Error: ${dlErr}`)
    }

    const arrayBuffer = await blob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const metadata = await sharp(buffer, { animated: true }).metadata()
    const isAnimated = (metadata.pages ?? 1) > 1

    let pipeline = sharp(buffer, { animated: true })

    if (width) {
      pipeline = pipeline.resize({
        width,
        withoutEnlargement: true,
      })
    }

    const optimizedBuffer = await pipeline
      .webp({
        quality,
        ...(isAnimated
          ? {
              loop: metadata.loop ?? 0,
              ...(metadata.delay ? { delay: metadata.delay } : {}),
            }
          : {}),
      })
      .toBuffer()

    return new Response(optimizedBuffer, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    })
  } catch (error) {
    console.error("0G_API_ROUTE_ERROR:", error)
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 }
    )
  }
}
import mysql from 'mysql2/promise'
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3'
import { createStatusMonitor } from '@/lib/publicStatus.mjs'
import { LIVE_STATUS_URL } from '@/lib/live'
import { getResourceHealth } from '@/lib/resourceHealth.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const getStatus = createStatusMonitor([
  {
    id: 'website',
    name: 'Website',
    description: 'The Hup app server is responding to requests.',
    check: async () => {},
  },
  {
    id: 'data',
    name: 'Community data',
    description: 'The database used for profiles, feeds, and community activity is reachable.',
    check: async () => {
      if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) return 'unmonitored'
      let connection
      try {
        connection = await mysql.createConnection({
          host: process.env.DB_HOST,
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME,
          port: Number(process.env.DB_PORT || 3306),
          ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
          connectTimeout: 2_500,
        })
        await connection.query({ sql: 'SELECT 1', timeout: 2_500 })
      } finally {
        connection?.destroy()
      }
    },
  },
  {
    id: 'storage',
    name: 'Media storage',
    description: 'Hup can access its upload storage. Individual files and image previews may vary.',
    check: async (signal) => {
      if (!process.env.FILEBASE_S3_KEY || !process.env.FILEBASE_S3_SECRET || !process.env.FILEBASE_S3_BUCKET) return 'unmonitored'
      const client = new S3Client({
        endpoint: 'https://s3.filebase.com',
        region: 'us-east-1',
        maxAttempts: 1,
        credentials: {
          accessKeyId: process.env.FILEBASE_S3_KEY,
          secretAccessKey: process.env.FILEBASE_S3_SECRET,
        },
      })
      try {
        await client.send(new HeadBucketCommand({ Bucket: process.env.FILEBASE_S3_BUCKET }), { abortSignal: signal })
      } finally {
        client.destroy()
      }
    },
  },
  {
    id: 'live',
    name: 'Live stream discovery',
    description: 'The service that reports live streams is responding. Video playback is not tested.',
    check: async (signal) => {
      if (!LIVE_STATUS_URL) return 'unmonitored'
      const response = await fetch(`${LIVE_STATUS_URL}/0x0000000000000000000000000000000000000000`, { signal, cache: 'no-store' })
      if (!response.ok) throw new Error('Live status unavailable')
      const body = await response.json()
      if (body?.status !== 'offline') throw new Error('Invalid live status')
    },
  },
  ...[
    { key: 'cpu', name: 'Processing capacity', description: 'A short sample of server CPU activity.' },
    { key: 'memory', name: 'Memory capacity', description: 'Available server memory, accounting for reusable system cache.' },
    { key: 'disk', name: 'Storage capacity', description: 'Free space on the server’s main disk.' },
  ].map(({ key, name, description }) => ({
    id: `resource-${key}`,
    name,
    description,
    check: async () => (await getResourceHealth())[key],
  })),
])

export async function GET() {
  return Response.json(await getStatus(), {
    headers: { 'Cache-Control': 'no-store' },
  })
}

import { NextResponse } from 'next/server'
import { Client } from 'pg'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const secret = searchParams.get('secret')

  if (secret !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sql = searchParams.get('sql')
  if (!sql) {
    return NextResponse.json({ error: 'Missing sql parameter' }, { status: 400 })
  }

  // Подключаемся к базе по IPv6 (который поддерживается на Vercel)
  const host = 'db.otcktbyxaptxjnkxyili.supabase.co'
  const connectionString = `postgresql://postgres.otcktbyxaptxjnkxyili:mFy6e-n5UujVN9@${host}:5432/postgres`

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  })

  try {
    await client.connect()
    const res = await client.query(sql)
    await client.end()
    return NextResponse.json({ success: true, result: res.rows })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}

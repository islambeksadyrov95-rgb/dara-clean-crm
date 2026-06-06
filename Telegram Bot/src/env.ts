import 'dotenv/config'
import { z } from 'zod'

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1),
  GOOGLE_SPREADSHEET_ID: z.string().min(1),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().min(1),
  GOOGLE_PRIVATE_KEY: z.string().min(1),
  TZ: z.string().min(1).default('Asia/Almaty')
})

export const env = envSchema.parse(process.env)

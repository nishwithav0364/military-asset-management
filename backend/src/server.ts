import 'dotenv/config'
import { createApp } from './app'
import { prisma } from './database'
import { seedDemoData } from '../prisma/seed'

const port = Number(process.env.PORT ?? 4000)

async function start() {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw new Error('JWT_SECRET is required in production')
  await prisma.$connect()
  if (process.env.SEED_DEMO_DATA === 'true') await seedDemoData(prisma)
  const app = createApp(prisma)
  const server = app.listen(port, '0.0.0.0', () => console.log(`Asset Command API listening on port ${port}`))
  const shutdown = async () => {
    server.close(async () => {
      await prisma.$disconnect()
      process.exit(0)
    })
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

void start().catch(async (error: unknown) => {
  console.error(error)
  await prisma.$disconnect()
  process.exitCode = 1
})
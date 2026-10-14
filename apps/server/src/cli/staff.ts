/**
 * Staff accounts from the command line (first admin, lost access):
 *   bun run --filter @manifeste/server staff invite <email> <name> <admin|moderator>
 *   bun run --filter @manifeste/server staff link <email>
 * Prints a one-time link to choose a password. Needs DATABASE_URL, AUTH_SECRET and PUBLIC_URL.
 */
import { loadConfig } from '../config.ts'
import { createContext } from '../context.ts'
import { StaffService } from '../modules/staff/service.ts'

const [command, email, name, role] = process.argv.slice(2)
const usage = 'usage: staff invite <email> <name> <admin|moderator> | staff link <email>'

const config = loadConfig({ ...process.env, ROLE: 'api', LOG_LEVEL: 'warn' })
const ctx = createContext(config)
const service = new StaffService(ctx.db, ctx.auth, config.PUBLIC_URL)

try {
  if (command === 'invite' && email && name && (role === 'admin' || role === 'moderator')) {
    const result = await service.invite({ email, name, role })
    if ('passwordLink' in result) {
      console.log(`Account created for ${email} (${role}).`)
      console.log(`Password link, valid ${result.expiresInHours} h:\n${result.passwordLink}`)
    } else {
      console.error(result.response)
      process.exitCode = 1
    }
  } else if (command === 'link' && email) {
    console.log(await service.passwordLink(email))
  } else {
    console.error(usage)
    process.exitCode = 2
  }
} finally {
  await ctx.close()
}

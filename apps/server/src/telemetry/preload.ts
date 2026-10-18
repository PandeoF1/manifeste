/** Preloaded before the app (`bun --preload`): the SDK must be up before `pg` is imported. */
import { startTelemetry } from './otel.ts'

startTelemetry()

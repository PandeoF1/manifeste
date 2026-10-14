import { publicSettings } from '@manifeste/core'
import { Elysia } from 'elysia'
import { SettingsModel } from './model.ts'
import type { SettingsService } from './service.ts'

/** Public settings: how long a status lasts, when the movement started, whether judge tiers are on. */
export const settingsModule = (service: SettingsService) =>
  new Elysia({ name: 'module.settings', prefix: '/api/settings' }).get(
    '/',
    async ({ set }) => {
      set.headers['cache-control'] = 'public, max-age=60, s-maxage=60'
      return publicSettings(await service.all())
    },
    {
      response: SettingsModel.public,
      detail: { tags: ['settings'], summary: 'Public settings' },
    },
  )

import { Elysia, t } from 'elysia'
import {
  isSettingKey,
  isValidSetting,
  SETTING_KEYS,
  SETTINGS,
  type SettingKey,
} from '@manifeste/core'
import { status } from 'elysia'
import type { Auth } from '../../auth/auth.ts'
import { authPlugin } from '../../auth/plugin.ts'
import { audit } from '../../lib/audit.ts'
import type { Database } from '@manifeste/db'
import type { EventBus } from '../../realtime/bus.ts'
import type { SettingsService } from './service.ts'

/** Every runtime setting with its current value and default (admins). */
export const settingsStaffModule = (
  auth: Auth,
  db: Database,
  service: SettingsService,
  bus: EventBus | null,
) =>
  new Elysia({ name: 'module.settings.staff', prefix: '/api/staff/settings' })
    .use(authPlugin(auth))
    .get(
      '/',
      async () => {
        const values = await service.all()
        return SETTING_KEYS.map((key) => ({
          key,
          value: values[key],
          default: SETTINGS[key].default,
          isDefault: JSON.stringify(values[key]) === JSON.stringify(SETTINGS[key].default),
          public: SETTINGS[key].public,
          schema: JSON.parse(JSON.stringify(SETTINGS[key].schema)) as unknown,
        }))
      },
      {
        staff: { settings: ['manage'] },
        detail: { tags: ['staff'], summary: 'Settings with value, default and schema' },
      },
    )
    .put(
      '/:key',
      async ({ params, body, staff }) => {
        if (!isSettingKey(params.key)) return status(404, 'Unknown setting')
        if (!isValidSetting(params.key, body.value)) return status(422, 'Invalid value')
        const before = (await service.all())[params.key as SettingKey]
        await service.set(params.key, body.value as never, staff.user.id)
        await audit(db, staff, 'settings.set', params.key, before, body.value)
        void bus?.publish({ topic: 'statuses', data: {} }).catch(() => {})
        return { ok: true as const }
      },
      {
        staff: { settings: ['manage'] },
        params: t.Object({ key: t.String() }),
        body: t.Object({ value: t.Unknown() }),
        response: { 200: t.Object({ ok: t.Literal(true) }), 404: t.String(), 422: t.String() },
        detail: { tags: ['staff'], summary: 'Change a setting (validated against its schema)' },
      },
    )
    .delete(
      '/:key',
      async ({ params, staff }) => {
        if (!isSettingKey(params.key)) return status(404, 'Unknown setting')
        const before = (await service.all())[params.key as SettingKey]
        await service.remove(params.key as SettingKey)
        await audit(
          db,
          staff,
          'settings.reset',
          params.key,
          before,
          SETTINGS[params.key as SettingKey].default,
        )
        void bus?.publish({ topic: 'statuses', data: {} }).catch(() => {})
        return { ok: true as const }
      },
      {
        staff: { settings: ['manage'] },
        params: t.Object({ key: t.String() }),
        response: { 200: t.Object({ ok: t.Literal(true) }), 404: t.String() },
        detail: { tags: ['staff'], summary: 'Back to the default' },
      },
    )

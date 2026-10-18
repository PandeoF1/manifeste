/**
 * Runtime settings changed from the admin, with their schema and default. The server validates
 * every read and write; the public subset is served to the web app.
 */
import { type Static, type TSchema, Type as t } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

const day = t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })

export const SETTINGS = {
  /** Hours a status stays on the live map without a new report. */
  status_ttl_hours: { schema: t.Integer({ minimum: 1, maximum: 72 }), default: 5, public: true },
  /** First day of the movement (YYYY-MM-DD), start of the "all" period. */
  movement_start: { schema: day, default: '2026-09-14', public: true },
  /** Judge tiers on: mobilisations are shown apart and only confirmed reports count. */
  judge_tiers: { schema: t.Boolean(), default: false, public: true },
  /**
   * Show the public Mouvements pages (menu entry, /mouvements, /api/movements). Off: they do not
   * exist for visitors, while staff can still prepare movements in the admin.
   */
  movements_public: { schema: t.Boolean(), default: false, public: true },
  /**
   * Show the approved marches (with their route) on the home map. Off until wanted: the
   * dedicated Mouvements pages are a separate switch.
   */
  marches_on_map: { schema: t.Boolean(), default: false, public: true },
  /** Judge probability at or above which a report can be confirmed. */
  judge_keep: { schema: t.Number({ minimum: 0, maximum: 1 }), default: 0.5, public: false },
  /** Judge probability below which a report is not retained (unless gathering or incident). */
  judge_low: { schema: t.Number({ minimum: 0, maximum: 1 }), default: 0.3, public: false },
  /**
   * Analyse how the press treats the mobilisation (admin "Médias" tab). It spends AI calls on
   * every article read and nothing else uses the answers: switch off to stop the spending.
   */
  media_analysis: { schema: t.Boolean(), default: true, public: false },
  /**
   * Look for marches and their routes in the press articles read (admin "Parcours" tab). It
   * spends AI calls; what it finds are proposals that a person approves. Off until wanted.
   */
  route_detection: { schema: t.Boolean(), default: false, public: false },
  /** Two independent sources within this many hours approve each other. */
  concordance_window_hours: {
    schema: t.Integer({ minimum: 1, maximum: 24 }),
    default: 2,
    public: false,
  },
} as const satisfies Record<string, { schema: TSchema; default: unknown; public: boolean }>

export type SettingKey = keyof typeof SETTINGS
export type SettingValue<K extends SettingKey> = Static<(typeof SETTINGS)[K]['schema']>
export type Settings = { [K in SettingKey]: SettingValue<K> }

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[]

export const isSettingKey = (key: string): key is SettingKey => key in SETTINGS

export function isValidSetting<K extends SettingKey>(
  key: K,
  value: unknown,
): value is SettingValue<K> {
  return Value.Check(SETTINGS[key].schema, value)
}

/** Settings from stored rows; a missing or invalid value falls back to its default. */
export function readSettings(rows: Iterable<{ key: string; value: unknown }>): Settings {
  const out = Object.fromEntries(SETTING_KEYS.map((k) => [k, SETTINGS[k].default])) as Settings
  for (const { key, value } of rows) {
    if (isSettingKey(key) && isValidSetting(key, value))
      (out as Record<string, unknown>)[key] = value
  }
  return out
}

export type PublicSettings = Pick<
  Settings,
  'status_ttl_hours' | 'movement_start' | 'judge_tiers' | 'movements_public' | 'marches_on_map'
>

export function publicSettings(s: Settings): PublicSettings {
  return {
    status_ttl_hours: s.status_ttl_hours,
    movement_start: s.movement_start,
    judge_tiers: s.judge_tiers,
    movements_public: s.movements_public,
    marches_on_map: s.marches_on_map,
  }
}

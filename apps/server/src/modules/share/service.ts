import type { OpenDataService } from '../open-data/service.ts'
import type { SchoolsService } from '../schools/service.ts'
import type { StatusesService } from '../statuses/service.ts'
import {
  type ActiveSchool,
  type DataSummary,
  type NationalSummary,
  type SchoolSummary,
} from './html.ts'

/** Reads for robots: the same data as the site, shaped for a page of text. */
export class ShareService {
  constructor(
    private readonly statuses: StatusesService,
    private readonly schools: SchoolsService,
    private readonly openData: OpenDataService,
  ) {}

  async national(): Promise<NationalSummary> {
    const [live, all] = await Promise.all([
      this.statuses.current('live'),
      this.statuses.current('all'),
    ])
    const departments = new Set<string>()
    let blocked = 0
    let filtering = 0
    for (const s of live) {
      if (s.status === 'blocked') blocked++
      if (s.status === 'filtering') filtering++
      if (s.status !== 'lifted' && s.department) departments.add(s.department)
    }
    // Past periods carry each school's strongest status, so lifted ones are blocks that ended.
    const total = all.filter((s) => s.status === 'blocked' || s.status === 'filtering').length
    return { blocked, filtering, departments: departments.size, total }
  }

  /** Schools with a signal in progress (blocked or filtering), the most recent first. */
  async active(limit = 400): Promise<ActiveSchool[]> {
    const live = await this.statuses.current('live')
    return live
      .filter((s) => s.status !== 'lifted')
      .slice(0, limit)
      .map((s) => ({
        uai: s.uai,
        name: s.name,
        city: s.city,
        department: s.department,
        status: s.status,
        lastSignalAt: s.lastSignalAt,
      }))
  }

  /** A school and its status right now (null status when nothing is in progress). */
  async school(uai: string): Promise<SchoolSummary | null> {
    const detail = await this.schools.detail(uai)
    if (!detail) return null
    const live = (await this.statuses.current('live')).find((s) => s.uai === uai)
    return {
      uai,
      name: detail.name,
      city: detail.city,
      department: detail.department,
      status: live?.status ?? null,
      lastSignalAt: live?.lastSignalAt ?? null,
    }
  }

  async dataSummary(): Promise<DataSummary> {
    const r = (await this.openData.get('resume')) as {
      premier_jour: string | null
      etablissements: number
      departements: number
    }
    return { firstDay: r.premier_jour, schools: r.etablissements, departments: r.departements }
  }

  /** Schools with a signal over the whole movement, for the sitemap. */
  async signaled(): Promise<Array<{ uai: string; lastSignalAt: Date }>> {
    const all = await this.statuses.current('all')
    return all.map((s) => ({ uai: s.uai, lastSignalAt: s.lastSignalAt }))
  }
}

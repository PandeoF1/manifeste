// Types de la base, au format de `supabase gen types typescript`.
// À régénérer après chaque migration : npm run gen:types
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type ReportStatus = 'bloque' | 'filtrant' | 'leve'
type SourceType = 'presse' | 'syndicat' | 'utilisateur' | 'collecteur'
type ModerationStatus = 'pending' | 'validated' | 'rejected'
type ScrapeKind = 'telegram' | 'rss' | 'bluesky' | 'mymaps'

export type Database = {
  public: {
    Tables: {
      app_settings: {
        Row: { key: string; value: string }
        Insert: { key: string; value: string }
        Update: { key?: string; value?: string }
        Relationships: []
      }
      schools: {
        Row: {
          uai: string
          name: string
          city: string
          postcode: string | null
          department: string | null
          academy: string | null
          location: unknown
          kind: string | null
          name_norm: string
          city_norm: string
          updated_at: string
        }
        Insert: {
          uai: string
          name: string
          city: string
          postcode?: string | null
          department?: string | null
          academy?: string | null
          location?: unknown
          kind?: string | null
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['schools']['Insert']>
        Relationships: []
      }
      trusted_domains: {
        Row: { domain: string; label: string; kind: SourceType }
        Insert: { domain: string; label: string; kind: SourceType }
        Update: { domain?: string; label?: string; kind?: SourceType }
        Relationships: []
      }
      scrape_sources: {
        Row: {
          id: string
          kind: ScrapeKind
          identifier: string
          label: string
          source_type: SourceType
          trusted: boolean
          enabled: boolean
          reports_hidden: boolean
          last_run_at: string | null
          last_error: string | null
          created_at: string
        }
        Insert: {
          id?: string
          kind: ScrapeKind
          identifier: string
          label: string
          source_type?: SourceType
          trusted?: boolean
          enabled?: boolean
          reports_hidden?: boolean
          last_run_at?: string | null
          last_error?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['scrape_sources']['Insert']>
        Relationships: []
      }
      reports: {
        Row: {
          id: string
          school_uai: string
          status: ReportStatus
          source_type: SourceType
          source_url: string | null
          source_domain: string | null
          source_id: string | null
          moderation: ModerationStatus
          certainty: 'haute' | 'moyenne' | 'faible' | null
          photo_public_path: string | null
          hidden: boolean
          observed_at: string
          created_at: string
        }
        Insert: {
          id?: string
          school_uai: string
          status: ReportStatus
          source_type: SourceType
          source_url?: string | null
          source_domain?: string | null
          source_id?: string | null
          moderation?: ModerationStatus
          certainty?: 'haute' | 'moyenne' | 'faible' | null
          photo_public_path?: string | null
          hidden?: boolean
          observed_at: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['reports']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'reports_school_uai_fkey'
            columns: ['school_uai']
            isOneToOne: false
            referencedRelation: 'schools'
            referencedColumns: ['uai']
          },
          {
            foreignKeyName: 'reports_source_id_fkey'
            columns: ['source_id']
            isOneToOne: false
            referencedRelation: 'scrape_sources'
            referencedColumns: ['id']
          },
        ]
      }
      report_submissions: {
        Row: {
          report_id: string
          photo_path: string | null
          lat: number
          lng: number
          distance_m: number
          created_at: string
        }
        Insert: {
          report_id: string
          photo_path?: string | null
          lat: number
          lng: number
          distance_m: number
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['report_submissions']['Insert']>
        Relationships: [
          {
            foreignKeyName: 'report_submissions_report_id_fkey'
            columns: ['report_id']
            isOneToOne: true
            referencedRelation: 'reports'
            referencedColumns: ['id']
          },
        ]
      }
      collector_trace: {
        Row: {
          id: number
          run_id: string
          t: string
          actor: 'collecteur' | 'lecteurs'
          target: string
          phase: 'start' | 'req' | 'res' | 'err' | 'end'
          label: string
          detail: string | null
          ms: number | null
          n: number | null
          status: number | null
        }
        Insert: Omit<Database['public']['Tables']['collector_trace']['Row'], 'id' | 't'> & {
          t?: string
        }
        Update: Partial<Database['public']['Tables']['collector_trace']['Row']>
        Relationships: []
      }
      collector_runs: {
        Row: {
          id: string
          source_id: string
          ran_at: string
          fetched: number
          new_items: number
          relevant: number
          events: number
          reports: number
          duplicates: number
          unmatched: number
          low_certainty: number
          error: string | null
        }
        Insert: Partial<Database['public']['Tables']['collector_runs']['Row']> & {
          source_id: string
        }
        Update: Partial<Database['public']['Tables']['collector_runs']['Row']>
        Relationships: []
      }
      collector_item_logs: {
        Row: {
          id: number
          run_id: string
          external_id: string
          url: string
          outcome:
            | 'hors_sujet'
            | 'aucun_fait'
            | 'certitude_faible'
            | 'rattache'
            | 'doublon'
            | 'non_rattache'
            | 'erreur'
            | 'reporte'
          school_name: string | null
          city: string | null
          school_uai: string | null
          status: ReportStatus | null
          detail: string | null
        }
        Insert: Omit<Database['public']['Tables']['collector_item_logs']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['collector_item_logs']['Row']>
        Relationships: [
          {
            foreignKeyName: 'collector_item_logs_run_id_fkey'
            columns: ['run_id']
            isOneToOne: false
            referencedRelation: 'collector_runs'
            referencedColumns: ['id']
          },
        ]
      }
      scraped_items: {
        Row: { source_id: string; external_id: string; processed_at: string }
        Insert: { source_id: string; external_id: string; processed_at?: string }
        Update: { source_id?: string; external_id?: string; processed_at?: string }
        Relationships: []
      }
      unmatched_extractions: {
        Row: {
          id: string
          source_id: string | null
          source_domain: string | null
          context: string | null
          school_name: string
          city: string | null
          status: ReportStatus
          source_url: string
          observed_at: string
          created_at: string
        }
        Insert: {
          id?: string
          source_id?: string | null
          source_domain?: string | null
          context?: string | null
          school_name: string
          city?: string | null
          status: ReportStatus
          source_url: string
          observed_at: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['unmatched_extractions']['Insert']>
        Relationships: []
      }
    }
    Views: {
      school_current_status: {
        Row: {
          uai: string
          name: string
          city: string
          department: string | null
          academy: string | null
          lat: number
          lng: number
          status: ReportStatus
          last_signal_at: string
          source_count: number
        }
        Relationships: []
      }
    }
    Functions: {
      school_status_since: {
        Args: { p_since: string }
        Returns: {
          uai: string
          name: string
          city: string
          department: string | null
          academy: string | null
          lat: number
          lng: number
          status: ReportStatus
          last_signal_at: string
          source_count: number
          signal_days: number
        }[]
      }
      admin_set_setting: {
        Args: { p_key: string; p_value: string }
        Returns: undefined
      }
      ping_live: {
        Args: { p_session: string; p_page: string }
        Returns: undefined
      }
      admin_source_report_counts: {
        Args: Record<PropertyKey, never>
        Returns: { source_id: string; total: number; hidden: number }[]
      }
      admin_analytics: {
        Args: { p_days?: number }
        Returns: Json
      }
      national_counts: {
        Args: Record<PropertyKey, never>
        Returns: { bloque: number; filtrant: number; leve: number; last_signal_at: string | null }[]
      }
      match_school: {
        Args: { p_name: string; p_city?: string | null; p_limit?: number }
        Returns: {
          uai: string
          name: string
          city: string
          name_score: number
          city_score: number
          score: number
        }[]
      }
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean }
      nearby_schools: {
        Args: { p_lat: number; p_lng: number; p_radius_m?: number }
        Returns: { uai: string; name: string; city: string; distance_m: number }[]
      }
      admin_update_report: {
        Args: {
          p_id: string
          p_school_uai?: string | null
          p_status?: ReportStatus | null
          p_observed_at?: string | null
          p_moderation?: ModerationStatus | null
        }
        Returns: undefined
      }
      admin_delete_report: { Args: { p_id: string }; Returns: undefined }
      admin_report_to_unmatched: { Args: { p_id: string }; Returns: string }
      retry_unmatched: { Args: Record<PropertyKey, never>; Returns: number }
      link_unmatched: {
        Args: { p_unmatched_id: string; p_uai: string }
        Returns: string
      }
      school_detail: {
        Args: { p_uai: string }
        Returns: {
          uai: string
          name: string
          city: string
          postcode: string | null
          department: string | null
          academy: string | null
          kind: string | null
          lat: number | null
          lng: number | null
        }[]
      }
      search_schools: {
        Args: { p_query: string }
        Returns: { uai: string; name: string; city: string; department: string | null }[]
      }
    }
    Enums: {
      report_status: ReportStatus
      source_type: SourceType
      moderation_status: ModerationStatus
      scrape_kind: ScrapeKind
    }
    CompositeTypes: Record<string, never>
  }
}

type PublicSchema = Database['public']
export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row']
export type Views<T extends keyof PublicSchema['Views']> = PublicSchema['Views'][T]['Row']
export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T]

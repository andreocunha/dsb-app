// Tipos do schema do Supabase (base gerada por `supabase gen types`), com os argumentos
// que aceitam null ajustados à mão (react_to_message.p_emoji e save_lineup.p_team_ids).
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      fantasy_lineups: {
        Row: { double_team_id: string | null; race_id: string; team_ids: string[]; updated_at: string; user_id: string }
        Insert: { race_id: string; team_ids: string[]; updated_at?: string; user_id: string }
        Update: { race_id?: string; team_ids?: string[]; updated_at?: string; user_id?: string }
        Relationships: []
      }
      message_reactions: {
        Row: { created_at: string; emoji: string; message_id: number; user_id: string }
        Insert: { created_at?: string; emoji: string; message_id: number; user_id: string }
        Update: { created_at?: string; emoji?: string; message_id?: number; user_id?: string }
        Relationships: []
      }
      message_reports: {
        Row: { created_at: string; id: number; message_id: number; reason: string | null; reporter_id: string }
        Insert: { created_at?: string; id?: never; message_id: number; reason?: string | null; reporter_id: string }
        Update: { created_at?: string; id?: never; message_id?: number; reason?: string | null; reporter_id?: string }
        Relationships: []
      }
      messages: {
        Row: {
          author_avatar: string | null
          author_name: string
          body: string | null
          conversation_id: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          duration_ms: number | null
          edited_at: string | null
          file_name: string | null
          file_path: string | null
          file_size: number | null
          file_type: string | null
          height: number | null
          id: number
          reply_to: number | null
          thumb_path: string | null
          user_id: string
          waveform: number[] | null
          width: number | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      conversations: {
        Row: { created_at: string; id: string; user_a: string; user_b: string }
        Insert: never
        Update: never
        Relationships: []
      }
      message_plays: {
        Row: { message_id: number; played_at: string; user_id: string }
        Insert: never
        Update: never
        Relationships: []
      }
      conversation_reads: {
        Row: { conversation_id: string; last_delivered_id: number; last_read_id: number; updated_at: string; user_id: string }
        Insert: never
        Update: never
        Relationships: []
      }
      profiles: {
        Row: { avatar_url: string | null; banned_at: string | null; banned_by: string | null; created_at: string; id: string; name: string; role: string; terms_accepted_at: string | null }
        Insert: { avatar_url?: string | null; banned_at?: string | null; banned_by?: string | null; created_at?: string; id: string; name: string; role?: string; terms_accepted_at?: string | null }
        Update: { avatar_url?: string | null; banned_at?: string | null; banned_by?: string | null; created_at?: string; id?: string; name?: string; role?: string; terms_accepted_at?: string | null }
        Relationships: []
      }
      push_devices: {
        Row: { platform: string; token: string; updated_at: string; user_id: string | null }
        Insert: { platform: string; token: string; updated_at?: string; user_id?: string | null }
        Update: { platform?: string; token?: string; updated_at?: string; user_id?: string | null }
        Relationships: []
      }
      match_duels: {
        Row: { race_id: string; slot: number; stage: string; team_a: string | null; team_b: string | null; time_a: number | null; time_b: number | null }
        Insert: { race_id: string; slot: number; stage: string; team_a?: string | null; team_b?: string | null; time_a?: number | null; time_b?: number | null }
        Update: { race_id?: string; slot?: number; stage?: string; team_a?: string | null; team_b?: string | null; time_a?: number | null; time_b?: number | null }
        Relationships: []
      }
      penalties: {
        Row: { created_at: string; id: number; points: number; race_id: string | null; reason: string; team_id: string }
        Insert: { created_at?: string; points: number; race_id?: string | null; reason: string; team_id: string }
        Update: { created_at?: string; points?: number; race_id?: string | null; reason?: string; team_id?: string }
        Relationships: []
      }
      race_laps: {
        Row: { completed_at: string; race_id: string; team_id: string }
        Insert: { completed_at: string; race_id: string; team_id: string }
        Update: { completed_at?: string; race_id?: string; team_id?: string }
        Relationships: []
      }
      race_status: {
        Row: { note: string; position: number | null; race_id: string; status: string; team_id: string }
        Insert: { note?: string; position?: number | null; race_id: string; status?: string; team_id: string }
        Update: { note?: string; position?: number | null; race_id?: string; status?: string; team_id?: string }
        Relationships: []
      }
      races: {
        Row: { duration_minutes: number | null; id: string; kind: string; name: string; number: number; started_at: string | null; starts_at: string }
        Insert: { duration_minutes?: number | null; id: string; kind?: string; name: string; number: number; started_at?: string | null; starts_at: string }
        Update: { duration_minutes?: number | null; id?: string; kind?: string; name?: string; number?: number; started_at?: string | null; starts_at?: string }
        Relationships: []
      }
      teams: {
        Row: { active: boolean; article_delivered: boolean; color: string; docs_delivered: number; id: string; initials: string; logo: string | null; name: string; university: string }
        Insert: { active?: boolean; article_delivered?: boolean; color?: string; docs_delivered?: number; id: string; initials: string; logo?: string | null; name: string; university?: string }
        Update: { active?: boolean; article_delivered?: boolean; color?: string; docs_delivered?: number; id?: string; initials?: string; logo?: string | null; name?: string; university?: string }
        Relationships: []
      }
      user_blocks: {
        Row: { blocked_id: string; blocker_id: string; created_at: string }
        Insert: { blocked_id: string; blocker_id?: string; created_at?: string }
        Update: { blocked_id?: string; blocker_id?: string; created_at?: string }
        Relationships: []
      }
    }
    Views: {
      race_results: {
        Row: { points: number | null; race_id: string | null; team_id: string | null }
        Relationships: []
      }
      race_scores: {
        Row: {
          duel_time: number | null
          last_lap_at: string | null
          laps: number | null
          note: string | null
          points: number | null
          position: number | null
          race_id: string | null
          stage: string | null
          status: string | null
          team_id: string | null
        }
        Relationships: []
      }
      team_standings: {
        Row: {
          article_delivered: boolean | null
          color: string | null
          docs_delivered: number | null
          id: string | null
          initials: string | null
          logo: string | null
          name: string | null
          penalty_points: number | null
          points: number | null
          race_points: number | null
          tiebreak_position: number | null
          university: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_terms: { Args: { p_accepted_at?: string }; Returns: undefined }
      ban_user: { Args: { p_user_id: string }; Returns: undefined }
      chat_messages: {
        Args: { p_before?: number; p_conversation_id?: string; p_limit?: number }
        Returns: {
          author_avatar: string
          author_name: string
          body: string
          conversation_id: string
          duration_ms: number
          played_by_me: boolean
          played_by_others: boolean
          waveform: number[]
          created_at: string
          deleted_at: string
          deleted_by: string
          edited_at: string
          file_name: string
          file_path: string
          file_size: number
          file_type: string
          height: number
          id: number
          reactions: Json
          reply: Json
          reply_to: number
          thumb_path: string
          user_id: string
          width: number
        }[]
      }
      copy_lineup_forward: { Args: { p_race_id: string }; Returns: undefined }
      delete_account: { Args: never; Returns: undefined }
      delete_message: { Args: { p_id: number }; Returns: string[] }
      dm_unread_count: { Args: never; Returns: number }
      mark_played: { Args: { p_message_id: number }; Returns: undefined }
      mark_delivered: { Args: { p_conversation_id?: string }; Returns: undefined }
      mark_conversation_read: { Args: { p_conversation_id: string; p_last_id: number }; Returns: undefined }
      my_conversations: {
        Args: never
        Returns: { id: string; last: Json; other_avatar: string; other_delivered_id: number; other_id: string; other_name: string; other_read_id: number; unread: number }[]
      }
      start_conversation: { Args: { p_user: string }; Returns: string }
      edit_message: { Args: { p_body: string; p_id: number }; Returns: Database["public"]["Tables"]["messages"]["Row"] }
      fantasy_ranking: {
        Args: { p_limit?: number }
        Returns: { avatar_url: string; name: string; points: number; position: number; user_id: string }[]
      }
      placement_points: { Args: { p_position: number }; Returns: number }
      message_reactors: {
        Args: { p_message_id: number }
        Returns: { avatar_url: string; emoji: string; name: string; user_id: string }[]
      }
      react_to_message: { Args: { p_emoji: string | null; p_message_id: number }; Returns: undefined }
      register_push_device: { Args: { p_platform: string; p_token: string }; Returns: undefined }
      report_message: { Args: { p_message_id: number; p_reason?: string }; Returns: undefined }
      save_lineup: { Args: { p_double?: string | null; p_race_id: string; p_team_ids: string[] }; Returns: undefined }
      unread_count: { Args: { p_after?: number }; Returns: number }
      send_message: {
        Args: {
          p_body?: string
          p_conversation_id?: string
          p_duration_ms?: number
          p_file_name?: string
          p_file_path?: string
          p_height?: number
          p_reply_to?: number
          p_thumb_path?: string
          p_waveform?: number[]
          p_width?: number
        }
        Returns: Database["public"]["Tables"]["messages"]["Row"]
      }
      update_profile: { Args: { p_name: string }; Returns: undefined }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

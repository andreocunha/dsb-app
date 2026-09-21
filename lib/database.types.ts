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
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          file_name: string | null
          file_path: string | null
          file_size: number | null
          file_type: string | null
          height: number | null
          id: number
          thumb_path: string | null
          user_id: string
          width: number | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      profiles: {
        Row: { avatar_url: string | null; created_at: string; id: string; name: string; role: string }
        Insert: { avatar_url?: string | null; created_at?: string; id: string; name: string; role?: string }
        Update: { avatar_url?: string | null; created_at?: string; id?: string; name?: string; role?: string }
        Relationships: []
      }
      push_devices: {
        Row: { platform: string; token: string; updated_at: string; user_id: string | null }
        Insert: { platform: string; token: string; updated_at?: string; user_id?: string | null }
        Update: { platform?: string; token?: string; updated_at?: string; user_id?: string | null }
        Relationships: []
      }
      race_results: {
        Row: { points: number; race_id: string; team_id: string }
        Insert: { points?: number; race_id: string; team_id: string }
        Update: { points?: number; race_id?: string; team_id?: string }
        Relationships: []
      }
      races: {
        Row: { id: string; name: string; number: number; starts_at: string }
        Insert: { id: string; name: string; number: number; starts_at: string }
        Update: { id?: string; name?: string; number?: number; starts_at?: string }
        Relationships: []
      }
      teams: {
        Row: { active: boolean; color: string; id: string; initials: string; logo: string | null; name: string; university: string }
        Insert: { active?: boolean; color?: string; id: string; initials: string; logo?: string | null; name: string; university?: string }
        Update: { active?: boolean; color?: string; id?: string; initials?: string; logo?: string | null; name?: string; university?: string }
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
      team_standings: {
        Row: {
          color: string | null
          id: string | null
          initials: string | null
          logo: string | null
          name: string | null
          points: number | null
          university: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      chat_messages: {
        Args: { p_before?: number; p_limit?: number }
        Returns: {
          author_avatar: string
          author_name: string
          body: string
          created_at: string
          deleted_at: string
          deleted_by: string
          file_name: string
          file_path: string
          file_size: number
          file_type: string
          height: number
          id: number
          reactions: Json
          thumb_path: string
          user_id: string
          width: number
        }[]
      }
      copy_lineup_forward: { Args: { p_race_id: string }; Returns: undefined }
      delete_account: { Args: never; Returns: undefined }
      delete_message: { Args: { p_id: number }; Returns: string[] }
      fantasy_ranking: {
        Args: { p_limit?: number }
        Returns: { avatar_url: string; name: string; points: number; position: number; user_id: string }[]
      }
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
          p_file_name?: string
          p_file_path?: string
          p_height?: number
          p_thumb_path?: string
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

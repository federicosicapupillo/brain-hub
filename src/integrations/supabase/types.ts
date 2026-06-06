export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agents: {
        Row: {
          brain_id: string | null
          created_at: string
          description: string | null
          id: string
          instructions: string | null
          model: string | null
          name: string
          role: string | null
          status: string
          tools: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          brain_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          instructions?: string | null
          model?: string | null
          name: string
          role?: string | null
          status?: string
          tools?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          brain_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          instructions?: string | null
          model?: string | null
          name?: string
          role?: string | null
          status?: string
          tools?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agents_brain_id_fkey"
            columns: ["brain_id"]
            isOneToOne: false
            referencedRelation: "brains"
            referencedColumns: ["id"]
          },
        ]
      }
      app_logs: {
        Row: {
          action: string
          brain_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          message: string
          metadata: Json
          severity: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action: string
          brain_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          message: string
          metadata?: Json
          severity?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action?: string
          brain_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          message?: string
          metadata?: Json
          severity?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_logs_brain_id_fkey"
            columns: ["brain_id"]
            isOneToOne: false
            referencedRelation: "brains"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_edges: {
        Row: {
          brain_id: string
          created_at: string
          id: string
          kind: string
          source: string
          target: string
          user_id: string
        }
        Insert: {
          brain_id: string
          created_at?: string
          id?: string
          kind?: string
          source: string
          target: string
          user_id: string
        }
        Update: {
          brain_id?: string
          created_at?: string
          id?: string
          kind?: string
          source?: string
          target?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brain_edges_brain_id_fkey"
            columns: ["brain_id"]
            isOneToOne: false
            referencedRelation: "brains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brain_edges_source_fkey"
            columns: ["source"]
            isOneToOne: false
            referencedRelation: "brain_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brain_edges_target_fkey"
            columns: ["target"]
            isOneToOne: false
            referencedRelation: "brain_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      brain_nodes: {
        Row: {
          brain_id: string
          created_at: string
          id: string
          label: string
          origin: string
          summary: string | null
          tags: string[]
          type: string
          updated_at: string
          user_id: string
          x: number
          y: number
        }
        Insert: {
          brain_id: string
          created_at?: string
          id?: string
          label: string
          origin?: string
          summary?: string | null
          tags?: string[]
          type?: string
          updated_at?: string
          user_id: string
          x?: number
          y?: number
        }
        Update: {
          brain_id?: string
          created_at?: string
          id?: string
          label?: string
          origin?: string
          summary?: string | null
          tags?: string[]
          type?: string
          updated_at?: string
          user_id?: string
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "brain_nodes_brain_id_fkey"
            columns: ["brain_id"]
            isOneToOne: false
            referencedRelation: "brains"
            referencedColumns: ["id"]
          },
        ]
      }
      brains: {
        Row: {
          color: string
          created_at: string
          description: string | null
          id: string
          kind: string
          name: string
          origin: string
          updated_at: string
          user_id: string
          visibility: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          kind?: string
          name: string
          origin?: string
          updated_at?: string
          user_id: string
          visibility?: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          kind?: string
          name?: string
          origin?: string
          updated_at?: string
          user_id?: string
          visibility?: string
        }
        Relationships: []
      }
      connectors: {
        Row: {
          config: Json
          created_at: string
          description: string | null
          id: string
          is_enabled: boolean
          last_sync_at: string | null
          name: string
          status: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          last_sync_at?: string | null
          name: string
          status?: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          last_sync_at?: string | null
          name?: string
          status?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      import_jobs: {
        Row: {
          brain_id: string
          created_at: string
          error_message: string | null
          id: string
          metadata: Json
          processed_items: number
          source_type: string
          status: string
          total_items: number
          updated_at: string
          user_id: string
        }
        Insert: {
          brain_id: string
          created_at?: string
          error_message?: string | null
          id?: string
          metadata?: Json
          processed_items?: number
          source_type: string
          status?: string
          total_items?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          brain_id?: string
          created_at?: string
          error_message?: string | null
          id?: string
          metadata?: Json
          processed_items?: number
          source_type?: string
          status?: string
          total_items?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_brain_id_fkey"
            columns: ["brain_id"]
            isOneToOne: false
            referencedRelation: "brains"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_chunks: {
        Row: {
          brain_id: string
          chunk_index: number
          content: string
          created_at: string
          id: string
          metadata: Json
          node_id: string | null
          source_id: string
          token_estimate: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          brain_id: string
          chunk_index?: number
          content: string
          created_at?: string
          id?: string
          metadata?: Json
          node_id?: string | null
          source_id: string
          token_estimate?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          brain_id?: string
          chunk_index?: number
          content?: string
          created_at?: string
          id?: string
          metadata?: Json
          node_id?: string | null
          source_id?: string
          token_estimate?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_brain_id_fkey"
            columns: ["brain_id"]
            isOneToOne: false
            referencedRelation: "brains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_chunks_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "brain_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_chunks_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "knowledge_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_sources: {
        Row: {
          brain_id: string
          content_hash: string | null
          created_at: string
          description: string | null
          extracted_text: string | null
          file_name: string | null
          file_path: string | null
          file_size: number | null
          id: string
          metadata: Json
          mime_type: string | null
          node_id: string | null
          source_type: string
          status: string
          summary: string | null
          tags: string[]
          title: string
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          brain_id: string
          content_hash?: string | null
          created_at?: string
          description?: string | null
          extracted_text?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          node_id?: string | null
          source_type: string
          status?: string
          summary?: string | null
          tags?: string[]
          title: string
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          brain_id?: string
          content_hash?: string | null
          created_at?: string
          description?: string | null
          extracted_text?: string | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          metadata?: Json
          mime_type?: string | null
          node_id?: string | null
          source_type?: string
          status?: string
          summary?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_sources_brain_id_fkey"
            columns: ["brain_id"]
            isOneToOne: false
            referencedRelation: "brains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_sources_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "brain_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      live_events: {
        Row: {
          brain_id: string | null
          created_at: string
          description: string | null
          event_type: string
          id: string
          is_read: boolean
          payload: Json
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          brain_id?: string | null
          created_at?: string
          description?: string | null
          event_type: string
          id?: string
          is_read?: boolean
          payload?: Json
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          brain_id?: string | null
          created_at?: string
          description?: string | null
          event_type?: string
          id?: string
          is_read?: boolean
          payload?: Json
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_events_brain_id_fkey"
            columns: ["brain_id"]
            isOneToOne: false
            referencedRelation: "brains"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      roadmap_items: {
        Row: {
          brain_id: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          order_index: number
          phase: string | null
          priority: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          brain_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          order_index?: number
          phase?: string | null
          priority?: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          brain_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          order_index?: number
          phase?: string | null
          priority?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_items_brain_id_fkey"
            columns: ["brain_id"]
            isOneToOne: false
            referencedRelation: "brains"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          agent_id: string | null
          brain_id: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          node_id: string | null
          priority: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          brain_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          node_id?: string | null
          priority?: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          brain_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          node_id?: string | null
          priority?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_brain_id_fkey"
            columns: ["brain_id"]
            isOneToOne: false
            referencedRelation: "brains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "brain_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

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
      automation_actions: {
        Row: {
          action_type: string
          approved_at: string | null
          brain_id: string | null
          created_at: string
          description: string | null
          error_text: string | null
          executed_at: string | null
          id: string
          metadata: Json
          parent_execution_log_id: string | null
          priority: string
          project_id: string | null
          prompt_execution_log_id: string | null
          rejected_at: string | null
          requires_confirmation: boolean
          result_text: string | null
          risk_level: string
          roadmap_item_id: string | null
          source: string
          status: string
          task_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action_type: string
          approved_at?: string | null
          brain_id?: string | null
          created_at?: string
          description?: string | null
          error_text?: string | null
          executed_at?: string | null
          id?: string
          metadata?: Json
          parent_execution_log_id?: string | null
          priority?: string
          project_id?: string | null
          prompt_execution_log_id?: string | null
          rejected_at?: string | null
          requires_confirmation?: boolean
          result_text?: string | null
          risk_level?: string
          roadmap_item_id?: string | null
          source?: string
          status?: string
          task_id?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action_type?: string
          approved_at?: string | null
          brain_id?: string | null
          created_at?: string
          description?: string | null
          error_text?: string | null
          executed_at?: string | null
          id?: string
          metadata?: Json
          parent_execution_log_id?: string | null
          priority?: string
          project_id?: string | null
          prompt_execution_log_id?: string | null
          rejected_at?: string | null
          requires_confirmation?: boolean
          result_text?: string | null
          risk_level?: string
          roadmap_item_id?: string | null
          source?: string
          status?: string
          task_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      automation_connectors: {
        Row: {
          browser_profile: string | null
          config: Json
          created_at: string
          id: string
          is_active: boolean
          name: string
          target_tool: string
          type: string
          updated_at: string
          user_id: string
          webhook_url: string | null
        }
        Insert: {
          browser_profile?: string | null
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          target_tool: string
          type: string
          updated_at?: string
          user_id?: string
          webhook_url?: string | null
        }
        Update: {
          browser_profile?: string | null
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          target_tool?: string
          type?: string
          updated_at?: string
          user_id?: string
          webhook_url?: string | null
        }
        Relationships: []
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
      clipboard_execution_logs: {
        Row: {
          action: string
          clipboard_item_id: string | null
          created_at: string
          id: string
          metadata: Json
          new_status: string | null
          notes: string | null
          previous_status: string | null
          user_id: string
        }
        Insert: {
          action: string
          clipboard_item_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          new_status?: string | null
          notes?: string | null
          previous_status?: string | null
          user_id?: string
        }
        Update: {
          action?: string
          clipboard_item_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          new_status?: string | null
          notes?: string | null
          previous_status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clipboard_execution_logs_clipboard_item_id_fkey"
            columns: ["clipboard_item_id"]
            isOneToOne: false
            referencedRelation: "clipboard_items"
            referencedColumns: ["id"]
          },
        ]
      }
      clipboard_items: {
        Row: {
          approval_notes: string | null
          approval_status: string
          approved_at: string | null
          automation_attempts: number
          automation_completed_at: string | null
          automation_connector_id: string | null
          automation_last_error: string | null
          automation_last_run_at: string | null
          automation_payload: Json
          automation_status: string
          automation_target: string
          blocked_reason: string | null
          brain_id: string | null
          content: string
          content_type: string
          copied_count: number
          created_at: string
          execution_instructions: string | null
          expected_output: string | null
          human_review_required: boolean
          id: string
          last_copied_at: string | null
          metadata: Json
          next_action: string
          next_step_generated: boolean
          notes: string
          output_result: string
          project_id: string | null
          project_tool_link_id: string | null
          requires_approval: boolean | null
          risk_level: string | null
          source_tool: string
          source_url: string
          status: string
          success_criteria: string | null
          tags: string[]
          target_tool: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approval_notes?: string | null
          approval_status?: string
          approved_at?: string | null
          automation_attempts?: number
          automation_completed_at?: string | null
          automation_connector_id?: string | null
          automation_last_error?: string | null
          automation_last_run_at?: string | null
          automation_payload?: Json
          automation_status?: string
          automation_target?: string
          blocked_reason?: string | null
          brain_id?: string | null
          content?: string
          content_type?: string
          copied_count?: number
          created_at?: string
          execution_instructions?: string | null
          expected_output?: string | null
          human_review_required?: boolean
          id?: string
          last_copied_at?: string | null
          metadata?: Json
          next_action?: string
          next_step_generated?: boolean
          notes?: string
          output_result?: string
          project_id?: string | null
          project_tool_link_id?: string | null
          requires_approval?: boolean | null
          risk_level?: string | null
          source_tool?: string
          source_url?: string
          status?: string
          success_criteria?: string | null
          tags?: string[]
          target_tool?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          approval_notes?: string | null
          approval_status?: string
          approved_at?: string | null
          automation_attempts?: number
          automation_completed_at?: string | null
          automation_connector_id?: string | null
          automation_last_error?: string | null
          automation_last_run_at?: string | null
          automation_payload?: Json
          automation_status?: string
          automation_target?: string
          blocked_reason?: string | null
          brain_id?: string | null
          content?: string
          content_type?: string
          copied_count?: number
          created_at?: string
          execution_instructions?: string | null
          expected_output?: string | null
          human_review_required?: boolean
          id?: string
          last_copied_at?: string | null
          metadata?: Json
          next_action?: string
          next_step_generated?: boolean
          notes?: string
          output_result?: string
          project_id?: string | null
          project_tool_link_id?: string | null
          requires_approval?: boolean | null
          risk_level?: string | null
          source_tool?: string
          source_url?: string
          status?: string
          success_criteria?: string | null
          tags?: string[]
          target_tool?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clipboard_items_automation_connector_id_fkey"
            columns: ["automation_connector_id"]
            isOneToOne: false
            referencedRelation: "automation_connectors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clipboard_items_brain_id_fkey"
            columns: ["brain_id"]
            isOneToOne: false
            referencedRelation: "brains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clipboard_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "project_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clipboard_items_project_tool_link_id_fkey"
            columns: ["project_tool_link_id"]
            isOneToOne: false
            referencedRelation: "project_tool_links"
            referencedColumns: ["id"]
          },
        ]
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
      content_project_links: {
        Row: {
          content_id: string
          content_type: string
          created_at: string
          id: string
          notes: string | null
          relationship_type: string
          source_project_id: string | null
          target_project_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content_id: string
          content_type: string
          created_at?: string
          id?: string
          notes?: string | null
          relationship_type?: string
          source_project_id?: string | null
          target_project_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content_id?: string
          content_type?: string
          created_at?: string
          id?: string
          notes?: string | null
          relationship_type?: string
          source_project_id?: string | null
          target_project_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_project_links_source_project_id_fkey"
            columns: ["source_project_id"]
            isOneToOne: false
            referencedRelation: "brains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_project_links_target_project_id_fkey"
            columns: ["target_project_id"]
            isOneToOne: false
            referencedRelation: "brains"
            referencedColumns: ["id"]
          },
        ]
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
          embedded_at: string | null
          embedding: string | null
          embedding_error: string | null
          embedding_model: string | null
          embedding_status: string
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
          embedded_at?: string | null
          embedding?: string | null
          embedding_error?: string | null
          embedding_model?: string | null
          embedding_status?: string
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
          embedded_at?: string | null
          embedding?: string | null
          embedding_error?: string | null
          embedding_model?: string | null
          embedding_status?: string
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
      n8n_execution_logs: {
        Row: {
          automation_action_id: string | null
          brain_id: string | null
          created_at: string
          error_text: string | null
          execution_mode: string
          id: string
          metadata: Json
          project_id: string | null
          receipt_json: Json | null
          request_payload: Json | null
          response_body: Json | null
          response_status: number | null
          runbook_instance_id: string | null
          success: boolean
          user_id: string
          workflow_registry_id: string | null
        }
        Insert: {
          automation_action_id?: string | null
          brain_id?: string | null
          created_at?: string
          error_text?: string | null
          execution_mode?: string
          id?: string
          metadata?: Json
          project_id?: string | null
          receipt_json?: Json | null
          request_payload?: Json | null
          response_body?: Json | null
          response_status?: number | null
          runbook_instance_id?: string | null
          success?: boolean
          user_id: string
          workflow_registry_id?: string | null
        }
        Update: {
          automation_action_id?: string | null
          brain_id?: string | null
          created_at?: string
          error_text?: string | null
          execution_mode?: string
          id?: string
          metadata?: Json
          project_id?: string | null
          receipt_json?: Json | null
          request_payload?: Json | null
          response_body?: Json | null
          response_status?: number | null
          runbook_instance_id?: string | null
          success?: boolean
          user_id?: string
          workflow_registry_id?: string | null
        }
        Relationships: []
      }
      n8n_workflow_registry: {
        Row: {
          brain_id: string | null
          created_at: string
          expected_input_schema: Json | null
          expected_output_schema: Json | null
          id: string
          last_manual_test_at: string | null
          last_manual_test_status: string | null
          linked_action_types: Json
          metadata: Json
          notes: string | null
          project_id: string | null
          risk_level: string
          status: string
          tool_link_id: string | null
          updated_at: string
          user_id: string
          verification_method: string | null
          webhook_method: string
          webhook_url: string | null
          workflow_description: string | null
          workflow_name: string
          workflow_url: string | null
        }
        Insert: {
          brain_id?: string | null
          created_at?: string
          expected_input_schema?: Json | null
          expected_output_schema?: Json | null
          id?: string
          last_manual_test_at?: string | null
          last_manual_test_status?: string | null
          linked_action_types?: Json
          metadata?: Json
          notes?: string | null
          project_id?: string | null
          risk_level?: string
          status?: string
          tool_link_id?: string | null
          updated_at?: string
          user_id: string
          verification_method?: string | null
          webhook_method?: string
          webhook_url?: string | null
          workflow_description?: string | null
          workflow_name: string
          workflow_url?: string | null
        }
        Update: {
          brain_id?: string | null
          created_at?: string
          expected_input_schema?: Json | null
          expected_output_schema?: Json | null
          id?: string
          last_manual_test_at?: string | null
          last_manual_test_status?: string | null
          linked_action_types?: Json
          metadata?: Json
          notes?: string | null
          project_id?: string | null
          risk_level?: string
          status?: string
          tool_link_id?: string | null
          updated_at?: string
          user_id?: string
          verification_method?: string | null
          webhook_method?: string
          webhook_url?: string | null
          workflow_description?: string | null
          workflow_name?: string
          workflow_url?: string | null
        }
        Relationships: []
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
      project_console_configs: {
        Row: {
          block_order: Json
          block_settings: Json
          brain_id: string | null
          console_name: string
          created_at: string
          id: string
          metadata: Json
          preset: string
          project_id: string | null
          project_priority: string
          updated_at: string
          user_id: string
          visible_blocks: Json
        }
        Insert: {
          block_order?: Json
          block_settings?: Json
          brain_id?: string | null
          console_name?: string
          created_at?: string
          id?: string
          metadata?: Json
          preset?: string
          project_id?: string | null
          project_priority?: string
          updated_at?: string
          user_id: string
          visible_blocks?: Json
        }
        Update: {
          block_order?: Json
          block_settings?: Json
          brain_id?: string | null
          console_name?: string
          created_at?: string
          id?: string
          metadata?: Json
          preset?: string
          project_id?: string | null
          project_priority?: string
          updated_at?: string
          user_id?: string
          visible_blocks?: Json
        }
        Relationships: [
          {
            foreignKeyName: "project_console_configs_brain_id_fkey"
            columns: ["brain_id"]
            isOneToOne: false
            referencedRelation: "brains"
            referencedColumns: ["id"]
          },
        ]
      }
      project_knowledge_sources: {
        Row: {
          brain_id: string | null
          category: string
          created_at: string
          description: string | null
          external_drive_name: string | null
          id: string
          importance: string
          local_path: string | null
          metadata: Json
          project_id: string | null
          prompt_execution_log_id: string | null
          roadmap_item_id: string | null
          runbook_instance_id: string | null
          source_type: string
          source_url: string | null
          status: string
          tags: Json
          task_id: string | null
          title: string
          tool_link_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          brain_id?: string | null
          category?: string
          created_at?: string
          description?: string | null
          external_drive_name?: string | null
          id?: string
          importance?: string
          local_path?: string | null
          metadata?: Json
          project_id?: string | null
          prompt_execution_log_id?: string | null
          roadmap_item_id?: string | null
          runbook_instance_id?: string | null
          source_type?: string
          source_url?: string | null
          status?: string
          tags?: Json
          task_id?: string | null
          title: string
          tool_link_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          brain_id?: string | null
          category?: string
          created_at?: string
          description?: string | null
          external_drive_name?: string | null
          id?: string
          importance?: string
          local_path?: string | null
          metadata?: Json
          project_id?: string | null
          prompt_execution_log_id?: string | null
          roadmap_item_id?: string | null
          runbook_instance_id?: string | null
          source_type?: string
          source_url?: string | null
          status?: string
          tags?: Json
          task_id?: string | null
          title?: string
          tool_link_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_links: {
        Row: {
          brain_id: string
          category: string | null
          created_at: string
          description: string | null
          id: string
          link_type: string
          notes: string | null
          relation_type: string | null
          status: string | null
          target_brain_id: string | null
          target_id: string | null
          target_table: string | null
          title: string
          tool: string | null
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          brain_id: string
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          link_type: string
          notes?: string | null
          relation_type?: string | null
          status?: string | null
          target_brain_id?: string | null
          target_id?: string | null
          target_table?: string | null
          title: string
          tool?: string | null
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          brain_id?: string
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          link_type?: string
          notes?: string | null
          relation_type?: string | null
          status?: string | null
          target_brain_id?: string | null
          target_id?: string | null
          target_table?: string | null
          title?: string
          tool?: string | null
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_links_brain_id_fkey"
            columns: ["brain_id"]
            isOneToOne: false
            referencedRelation: "brains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_links_target_brain_id_fkey"
            columns: ["target_brain_id"]
            isOneToOne: false
            referencedRelation: "brains"
            referencedColumns: ["id"]
          },
        ]
      }
      project_tool_links: {
        Row: {
          brain_id: string
          connection_mode: string
          connection_status: string
          connection_type: string | null
          created_at: string
          folder_path: string | null
          id: string
          is_recommended: boolean
          is_required: boolean
          last_checked_at: string | null
          last_manual_check_at: string | null
          last_sync_at: string | null
          metadata: Json
          notes: string | null
          repo_url: string | null
          tool_category: string
          tool_name: string
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          brain_id: string
          connection_mode?: string
          connection_status?: string
          connection_type?: string | null
          created_at?: string
          folder_path?: string | null
          id?: string
          is_recommended?: boolean
          is_required?: boolean
          last_checked_at?: string | null
          last_manual_check_at?: string | null
          last_sync_at?: string | null
          metadata?: Json
          notes?: string | null
          repo_url?: string | null
          tool_category?: string
          tool_name: string
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          brain_id?: string
          connection_mode?: string
          connection_status?: string
          connection_type?: string | null
          created_at?: string
          folder_path?: string | null
          id?: string
          is_recommended?: boolean
          is_required?: boolean
          last_checked_at?: string | null
          last_manual_check_at?: string | null
          last_sync_at?: string | null
          metadata?: Json
          notes?: string | null
          repo_url?: string | null
          tool_category?: string
          tool_name?: string
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_tool_links_brain_id_fkey"
            columns: ["brain_id"]
            isOneToOne: false
            referencedRelation: "brains"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_execution_logs: {
        Row: {
          brain_id: string | null
          created_at: string
          execution_package_id: string | null
          generated_prompt_text: string | null
          generation_goal: string | null
          id: string
          internal_notes: string | null
          last_error: string | null
          metadata: Json
          parent_execution_log_id: string | null
          project_id: string | null
          prompt_content: string
          prompt_title: string
          receipt_json: Json | null
          result_text: string | null
          result_type: string | null
          retry_count: number
          roadmap_item_id: string | null
          status: string
          target_tool: string
          task_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          brain_id?: string | null
          created_at?: string
          execution_package_id?: string | null
          generated_prompt_text?: string | null
          generation_goal?: string | null
          id?: string
          internal_notes?: string | null
          last_error?: string | null
          metadata?: Json
          parent_execution_log_id?: string | null
          project_id?: string | null
          prompt_content?: string
          prompt_title?: string
          receipt_json?: Json | null
          result_text?: string | null
          result_type?: string | null
          retry_count?: number
          roadmap_item_id?: string | null
          status?: string
          target_tool?: string
          task_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          brain_id?: string | null
          created_at?: string
          execution_package_id?: string | null
          generated_prompt_text?: string | null
          generation_goal?: string | null
          id?: string
          internal_notes?: string | null
          last_error?: string | null
          metadata?: Json
          parent_execution_log_id?: string | null
          project_id?: string | null
          prompt_content?: string
          prompt_title?: string
          receipt_json?: Json | null
          result_text?: string | null
          result_type?: string | null
          retry_count?: number
          roadmap_item_id?: string | null
          status?: string
          target_tool?: string
          task_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_execution_logs_parent_execution_log_id_fkey"
            columns: ["parent_execution_log_id"]
            isOneToOne: false
            referencedRelation: "prompt_execution_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      result_review_items: {
        Row: {
          brain_id: string | null
          created_at: string
          error_text: string | null
          id: string
          linked_action_id: string | null
          linked_next_prompt_id: string | null
          linked_roadmap_item_id: string | null
          linked_runbook_instance_id: string | null
          linked_workflow_id: string | null
          metadata: Json
          project_id: string | null
          result_text: string | null
          review_note: string | null
          review_status: string
          risk_level: string | null
          source_id: string | null
          source_type: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          brain_id?: string | null
          created_at?: string
          error_text?: string | null
          id?: string
          linked_action_id?: string | null
          linked_next_prompt_id?: string | null
          linked_roadmap_item_id?: string | null
          linked_runbook_instance_id?: string | null
          linked_workflow_id?: string | null
          metadata?: Json
          project_id?: string | null
          result_text?: string | null
          review_note?: string | null
          review_status?: string
          risk_level?: string | null
          source_id?: string | null
          source_type: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          brain_id?: string | null
          created_at?: string
          error_text?: string | null
          id?: string
          linked_action_id?: string | null
          linked_next_prompt_id?: string | null
          linked_roadmap_item_id?: string | null
          linked_runbook_instance_id?: string | null
          linked_workflow_id?: string | null
          metadata?: Json
          project_id?: string | null
          result_text?: string | null
          review_note?: string | null
          review_status?: string
          risk_level?: string | null
          source_id?: string | null
          source_type?: string
          title?: string
          updated_at?: string
          user_id?: string
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
          metadata: Json
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
          metadata?: Json
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
          metadata?: Json
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
      runbook_instances: {
        Row: {
          brain_id: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          current_step_index: number
          description: string | null
          id: string
          metadata: Json
          project_id: string | null
          risk_level: string
          started_at: string | null
          status: string
          template_key: string
          title: string
          total_steps: number
          updated_at: string
          user_id: string
        }
        Insert: {
          brain_id?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          current_step_index?: number
          description?: string | null
          id?: string
          metadata?: Json
          project_id?: string | null
          risk_level?: string
          started_at?: string | null
          status?: string
          template_key: string
          title: string
          total_steps?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          brain_id?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          current_step_index?: number
          description?: string | null
          id?: string
          metadata?: Json
          project_id?: string | null
          risk_level?: string
          started_at?: string | null
          status?: string
          template_key?: string
          title?: string
          total_steps?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      telegram_approval_requests: {
        Row: {
          approval_type: string
          approved_at: string | null
          approved_by: string | null
          automation_action_id: string | null
          brain_id: string | null
          created_at: string
          expired_at: string | null
          id: string
          message_preview: string | null
          metadata: Json
          n8n_execution_log_id: string | null
          payload_preview: Json | null
          project_id: string | null
          rejected_at: string | null
          rejection_reason: string | null
          requested_at: string | null
          risk_level: string
          runbook_instance_id: string | null
          status: string
          telegram_chat_id: string | null
          telegram_message_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approval_type?: string
          approved_at?: string | null
          approved_by?: string | null
          automation_action_id?: string | null
          brain_id?: string | null
          created_at?: string
          expired_at?: string | null
          id?: string
          message_preview?: string | null
          metadata?: Json
          n8n_execution_log_id?: string | null
          payload_preview?: Json | null
          project_id?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          requested_at?: string | null
          risk_level?: string
          runbook_instance_id?: string | null
          status?: string
          telegram_chat_id?: string | null
          telegram_message_id?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          approval_type?: string
          approved_at?: string | null
          approved_by?: string | null
          automation_action_id?: string | null
          brain_id?: string | null
          created_at?: string
          expired_at?: string | null
          id?: string
          message_preview?: string | null
          metadata?: Json
          n8n_execution_log_id?: string | null
          payload_preview?: Json | null
          project_id?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          requested_at?: string | null
          risk_level?: string
          runbook_instance_id?: string | null
          status?: string
          telegram_chat_id?: string | null
          telegram_message_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      warehouses: {
        Row: {
          brain_id: string | null
          commercial_notes: string | null
          covered_sqm: number | null
          created_at: string
          distance_highway_km: number | null
          distance_logistics_hub_km: number | null
          distance_port_km: number | null
          doors_count: number | null
          has_overhead_crane: boolean
          heavy_vehicle_access: boolean
          id: string
          industrial_zone: string | null
          intended_use: string | null
          internal_height_m: number | null
          latitude: number | null
          longitude: number | null
          municipality: string | null
          name: string
          outdoor_area_sqm: number | null
          overhead_crane_capacity_kg: number | null
          property_status: string | null
          province: string | null
          rent_price: number | null
          sale_price: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          brain_id?: string | null
          commercial_notes?: string | null
          covered_sqm?: number | null
          created_at?: string
          distance_highway_km?: number | null
          distance_logistics_hub_km?: number | null
          distance_port_km?: number | null
          doors_count?: number | null
          has_overhead_crane?: boolean
          heavy_vehicle_access?: boolean
          id?: string
          industrial_zone?: string | null
          intended_use?: string | null
          internal_height_m?: number | null
          latitude?: number | null
          longitude?: number | null
          municipality?: string | null
          name: string
          outdoor_area_sqm?: number | null
          overhead_crane_capacity_kg?: number | null
          property_status?: string | null
          province?: string | null
          rent_price?: number | null
          sale_price?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          brain_id?: string | null
          commercial_notes?: string | null
          covered_sqm?: number | null
          created_at?: string
          distance_highway_km?: number | null
          distance_logistics_hub_km?: number | null
          distance_port_km?: number | null
          doors_count?: number | null
          has_overhead_crane?: boolean
          heavy_vehicle_access?: boolean
          id?: string
          industrial_zone?: string | null
          intended_use?: string | null
          internal_height_m?: number | null
          latitude?: number | null
          longitude?: number | null
          municipality?: string | null
          name?: string
          outdoor_area_sqm?: number | null
          overhead_crane_capacity_kg?: number | null
          property_status?: string | null
          province?: string | null
          rent_price?: number | null
          sale_price?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouses_brain_id_fkey"
            columns: ["brain_id"]
            isOneToOne: false
            referencedRelation: "brains"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      match_knowledge_chunks: {
        Args: {
          match_brain_id?: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          brain_id: string
          chunk_id: string
          content: string
          node_id: string
          similarity: number
          source_id: string
          source_tags: string[]
          source_title: string
          source_type: string
        }[]
      }
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

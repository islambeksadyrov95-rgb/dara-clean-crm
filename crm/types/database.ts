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
      _migrations: {
        Row: {
          applied_at: string
          name: string
        }
        Insert: {
          applied_at?: string
          name: string
        }
        Update: {
          applied_at?: string
          name?: string
        }
        Relationships: []
      }
      acquisition_sources: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          synonyms: string[]
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          synonyms?: string[]
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          synonyms?: string[]
        }
        Relationships: []
      }
      agbis_api_log: {
        Row: {
          agbis_contr_id: string | null
          agbis_dor_id: string | null
          billed: boolean
          command: string
          created_at: string
          crm_entity: string | null
          crm_entity_id: string | null
          error_code: number | null
          executed_api_count: number | null
          http_status: number | null
          id: string
          latency_ms: number | null
          op: string | null
          request: Json | null
          response: Json | null
        }
        Insert: {
          agbis_contr_id?: string | null
          agbis_dor_id?: string | null
          billed?: boolean
          command: string
          created_at?: string
          crm_entity?: string | null
          crm_entity_id?: string | null
          error_code?: number | null
          executed_api_count?: number | null
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          op?: string | null
          request?: Json | null
          response?: Json | null
        }
        Update: {
          agbis_contr_id?: string | null
          agbis_dor_id?: string | null
          billed?: boolean
          command?: string
          created_at?: string
          crm_entity?: string | null
          crm_entity_id?: string | null
          error_code?: number | null
          executed_api_count?: number | null
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          op?: string | null
          request?: Json | null
          response?: Json | null
        }
        Relationships: []
      }
      agbis_outbox: {
        Row: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          crm_id: string
          entity: string
          id: string
          last_error: string | null
          max_attempts: number
          next_attempt_at: string
          op: string
          payload: Json
          state: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          crm_id: string
          entity: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          op: string
          payload?: Json
          state?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          crm_id?: string
          entity?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_attempt_at?: string
          op?: string
          payload?: Json
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      agbis_price_items: {
        Row: {
          agbis_tovar_id: string
          code: string | null
          folder_id: string | null
          group_name: string | null
          id: string
          is_active: boolean
          is_price_editable: boolean
          name: string
          order_addon_pack_id: string | null
          price: number
          price_id: string
          synced_at: string
          top_parent: string | null
          tovar_type: number | null
          unit: string | null
        }
        Insert: {
          agbis_tovar_id: string
          code?: string | null
          folder_id?: string | null
          group_name?: string | null
          id?: string
          is_active?: boolean
          is_price_editable?: boolean
          name: string
          order_addon_pack_id?: string | null
          price?: number
          price_id?: string
          synced_at?: string
          top_parent?: string | null
          tovar_type?: number | null
          unit?: string | null
        }
        Update: {
          agbis_tovar_id?: string
          code?: string | null
          folder_id?: string | null
          group_name?: string | null
          id?: string
          is_active?: boolean
          is_price_editable?: boolean
          name?: string
          order_addon_pack_id?: string | null
          price?: number
          price_id?: string
          synced_at?: string
          top_parent?: string | null
          tovar_type?: number | null
          unit?: string | null
        }
        Relationships: []
      }
      agbis_session: {
        Row: {
          expires_at: string | null
          id: number
          refresh_id: string | null
          session_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          expires_at?: string | null
          id?: number
          refresh_id?: string | null
          session_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          expires_at?: string | null
          id?: number
          refresh_id?: string | null
          session_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      agbis_sync_state: {
        Row: {
          backfilled: boolean
          entity: string
          last_error: string | null
          last_run_at: string | null
          last_status: string | null
          last_synced_at: string | null
          updated_at: string
        }
        Insert: {
          backfilled?: boolean
          entity: string
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          last_synced_at?: string | null
          updated_at?: string
        }
        Update: {
          backfilled?: boolean
          entity?: string
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          last_synced_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      broadcast_logs: {
        Row: {
          client_id: string
          error_message: string | null
          id: string
          manager_id: string
          message_text: string
          scenario: string
          sent_at: string
          status: string
        }
        Insert: {
          client_id: string
          error_message?: string | null
          id?: string
          manager_id: string
          message_text: string
          scenario: string
          sent_at?: string
          status: string
        }
        Update: {
          client_id?: string
          error_message?: string | null
          id?: string
          manager_id?: string
          message_text?: string
          scenario?: string
          sent_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_templates: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          id: string
          title: string
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          title: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          title?: string
        }
        Relationships: []
      }
      call_logs: {
        Row: {
          audio_url: string | null
          call_duration: number | null
          call_score: number | null
          client_id: string
          created_at: string
          dialogue: Json | null
          external_call_id: string | null
          id: string
          manager_id: string
          next_call_date: string | null
          next_call_time: string | null
          notes: string | null
          reason: string | null
          status: string
          sub_status: string | null
          summary: string | null
          transcript: string | null
        }
        Insert: {
          audio_url?: string | null
          call_duration?: number | null
          call_score?: number | null
          client_id: string
          created_at?: string
          dialogue?: Json | null
          external_call_id?: string | null
          id?: string
          manager_id: string
          next_call_date?: string | null
          next_call_time?: string | null
          notes?: string | null
          reason?: string | null
          status: string
          sub_status?: string | null
          summary?: string | null
          transcript?: string | null
        }
        Update: {
          audio_url?: string | null
          call_duration?: number | null
          call_score?: number | null
          client_id?: string
          created_at?: string
          dialogue?: Json | null
          external_call_id?: string | null
          id?: string
          manager_id?: string
          next_call_date?: string | null
          next_call_time?: string | null
          notes?: string | null
          reason?: string | null
          status?: string
          sub_status?: string | null
          summary?: string | null
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_tags: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          tag_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          tag_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_tags_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tags_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          acquisition_answer_raw: string | null
          acquisition_source_id: string | null
          address: string | null
          agbis_client_id: string | null
          agbis_synced_at: string | null
          assigned_manager_id: string | null
          avg_order_value: number
          created_at: string
          id: string
          last_call_reason: string | null
          last_called_at: string | null
          last_order_date: string | null
          locked_by: string | null
          locked_until: string | null
          name: string
          next_action_at: string | null
          next_action_note: string | null
          next_action_type: string | null
          phone: string
          segment_override: string | null
          sticky_note: string | null
          sync_error: string | null
          sync_status: string
          total_orders: number
          total_spent: number
          updated_at: string
        }
        Insert: {
          acquisition_answer_raw?: string | null
          acquisition_source_id?: string | null
          address?: string | null
          agbis_client_id?: string | null
          agbis_synced_at?: string | null
          assigned_manager_id?: string | null
          avg_order_value?: number
          created_at?: string
          id?: string
          last_call_reason?: string | null
          last_called_at?: string | null
          last_order_date?: string | null
          locked_by?: string | null
          locked_until?: string | null
          name: string
          next_action_at?: string | null
          next_action_note?: string | null
          next_action_type?: string | null
          phone: string
          segment_override?: string | null
          sticky_note?: string | null
          sync_error?: string | null
          sync_status?: string
          total_orders?: number
          total_spent?: number
          updated_at?: string
        }
        Update: {
          acquisition_answer_raw?: string | null
          acquisition_source_id?: string | null
          address?: string | null
          agbis_client_id?: string | null
          agbis_synced_at?: string | null
          assigned_manager_id?: string | null
          avg_order_value?: number
          created_at?: string
          id?: string
          last_call_reason?: string | null
          last_called_at?: string | null
          last_order_date?: string | null
          locked_by?: string | null
          locked_until?: string | null
          name?: string
          next_action_at?: string | null
          next_action_note?: string | null
          next_action_type?: string | null
          phone?: string
          segment_override?: string | null
          sticky_note?: string | null
          sync_error?: string | null
          sync_status?: string
          total_orders?: number
          total_spent?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_acquisition_source_id_fkey"
            columns: ["acquisition_source_id"]
            isOneToOne: false
            referencedRelation: "acquisition_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      order_history: {
        Row: {
          address: string | null
          agbis_date_out: string | null
          agbis_debet: number | null
          agbis_discount: number | null
          agbis_doc_num: string | null
          agbis_dolg: number | null
          agbis_dor_id: string | null
          agbis_status_id: number | null
          agbis_status_name: string | null
          agbis_user_name: string | null
          amount: number
          client_id: string
          created_at: string
          id: string
          import_batch_id: string | null
          order_date: string
          service: string | null
          source: string
        }
        Insert: {
          address?: string | null
          agbis_date_out?: string | null
          agbis_debet?: number | null
          agbis_discount?: number | null
          agbis_doc_num?: string | null
          agbis_dolg?: number | null
          agbis_dor_id?: string | null
          agbis_status_id?: number | null
          agbis_status_name?: string | null
          agbis_user_name?: string | null
          amount?: number
          client_id: string
          created_at?: string
          id?: string
          import_batch_id?: string | null
          order_date: string
          service?: string | null
          source?: string
        }
        Update: {
          address?: string | null
          agbis_date_out?: string | null
          agbis_debet?: number | null
          agbis_discount?: number | null
          agbis_doc_num?: string | null
          agbis_dolg?: number | null
          agbis_dor_id?: string | null
          agbis_status_id?: number | null
          agbis_status_name?: string | null
          agbis_user_name?: string | null
          amount?: number
          client_id?: string
          created_at?: string
          id?: string
          import_batch_id?: string | null
          order_date?: string
          service?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      order_history_items: {
        Row: {
          addons: Json | null
          agbis_tovar_id: string | null
          created_at: string
          discount_percent: number
          id: string
          is_product: boolean
          kfx: number | null
          line_amount: number
          name: string
          order_history_id: string
          qty: number | null
          unit_price: number
        }
        Insert: {
          addons?: Json | null
          agbis_tovar_id?: string | null
          created_at?: string
          discount_percent?: number
          id?: string
          is_product?: boolean
          kfx?: number | null
          line_amount?: number
          name: string
          order_history_id: string
          qty?: number | null
          unit_price?: number
        }
        Update: {
          addons?: Json | null
          agbis_tovar_id?: string | null
          created_at?: string
          discount_percent?: number
          id?: string
          is_product?: boolean
          kfx?: number | null
          line_amount?: number
          name?: string
          order_history_id?: string
          qty?: number | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_history_items_order_history_id_fkey"
            columns: ["order_history_id"]
            isOneToOne: false
            referencedRelation: "order_history"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          addons: Json | null
          agbis_tovar_id: string | null
          created_at: string
          discount_percent: number
          id: string
          kfx: number | null
          line_amount: number
          name: string
          order_id: string
          qty: number
          unit_price: number
        }
        Insert: {
          addons?: Json | null
          agbis_tovar_id?: string | null
          created_at?: string
          discount_percent?: number
          id?: string
          kfx?: number | null
          line_amount?: number
          name: string
          order_id: string
          qty?: number
          unit_price?: number
        }
        Update: {
          addons?: Json | null
          agbis_tovar_id?: string | null
          created_at?: string
          discount_percent?: number
          id?: string
          kfx?: number | null
          line_amount?: number
          name?: string
          order_id?: string
          qty?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_trips: {
        Row: {
          address: string
          agbis_car_id: string | null
          agbis_trip_id: string | null
          comment: string | null
          created_at: string
          id: string
          kind: string
          order_id: string
          sync_error: string | null
          sync_status: string
          trip_date: string | null
          updated_at: string
          window_from: string | null
          window_to: string | null
        }
        Insert: {
          address: string
          agbis_car_id?: string | null
          agbis_trip_id?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          kind: string
          order_id: string
          sync_error?: string | null
          sync_status?: string
          trip_date?: string | null
          updated_at?: string
          window_from?: string | null
          window_to?: string | null
        }
        Update: {
          address?: string
          agbis_car_id?: string | null
          agbis_trip_id?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          kind?: string
          order_id?: string
          sync_error?: string | null
          sync_status?: string
          trip_date?: string | null
          updated_at?: string
          window_from?: string | null
          window_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_trips_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          agbis_current_sclad_id: string | null
          agbis_date_out_fact: string | null
          agbis_debet: number | null
          agbis_doc_num: string | null
          agbis_dolg: number | null
          agbis_order_id: string | null
          agbis_price_id: string | null
          agbis_sclad_id: string | null
          agbis_sclad_out_id: string | null
          agbis_status_id: number | null
          agbis_status_name: string | null
          agbis_synced_at: string | null
          amount: number
          client_id: string
          comment: string | null
          created_at: string
          delivery_date: string | null
          discount_amount: number
          discount_percent: number
          fast_exec_id: number | null
          id: string
          intake_date: string | null
          manager_id: string
          services: string[]
          sync_error: string | null
          sync_status: string
        }
        Insert: {
          agbis_current_sclad_id?: string | null
          agbis_date_out_fact?: string | null
          agbis_debet?: number | null
          agbis_doc_num?: string | null
          agbis_dolg?: number | null
          agbis_order_id?: string | null
          agbis_price_id?: string | null
          agbis_sclad_id?: string | null
          agbis_sclad_out_id?: string | null
          agbis_status_id?: number | null
          agbis_status_name?: string | null
          agbis_synced_at?: string | null
          amount: number
          client_id: string
          comment?: string | null
          created_at?: string
          delivery_date?: string | null
          discount_amount?: number
          discount_percent?: number
          fast_exec_id?: number | null
          id?: string
          intake_date?: string | null
          manager_id: string
          services: string[]
          sync_error?: string | null
          sync_status?: string
        }
        Update: {
          agbis_current_sclad_id?: string | null
          agbis_date_out_fact?: string | null
          agbis_debet?: number | null
          agbis_doc_num?: string | null
          agbis_dolg?: number | null
          agbis_order_id?: string | null
          agbis_price_id?: string | null
          agbis_sclad_id?: string | null
          agbis_sclad_out_id?: string | null
          agbis_status_id?: number | null
          agbis_status_name?: string | null
          agbis_synced_at?: string | null
          amount?: number
          client_id?: string
          comment?: string | null
          created_at?: string
          delivery_date?: string | null
          discount_amount?: number
          discount_percent?: number
          fast_exec_id?: number | null
          id?: string
          intake_date?: string | null
          manager_id?: string
          services?: string[]
          sync_error?: string | null
          sync_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          agbis_document: string | null
          amount: number
          created_at: string
          id: string
          kassa_name: string | null
          order_id: string
          paid_at: string | null
          updated_at: string
        }
        Insert: {
          agbis_document?: string | null
          amount?: number
          created_at?: string
          id?: string
          kassa_name?: string | null
          order_id: string
          paid_at?: string | null
          updated_at?: string
        }
        Update: {
          agbis_document?: string | null
          amount?: number
          created_at?: string
          id?: string
          kassa_name?: string | null
          order_id?: string
          paid_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          is_active: boolean | null
          name: string | null
          role: string
          sip_extension: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          is_active?: boolean | null
          name?: string | null
          role?: string
          sip_extension?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean | null
          name?: string | null
          role?: string
          sip_extension?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sales_plans: {
        Row: {
          blankets_target: number
          carpets_target: number
          created_at: string
          curtains_target: number
          dry_clean_target: number
          furniture_target: number
          id: string
          manager_id: string
          month: number
          repeat_target: number
          updated_at: string
          year: number
        }
        Insert: {
          blankets_target?: number
          carpets_target?: number
          created_at?: string
          curtains_target?: number
          dry_clean_target?: number
          furniture_target?: number
          id?: string
          manager_id: string
          month: number
          repeat_target?: number
          updated_at?: string
          year: number
        }
        Update: {
          blankets_target?: number
          carpets_target?: number
          created_at?: string
          curtains_target?: number
          dry_clean_target?: number
          furniture_target?: number
          id?: string
          manager_id?: string
          month?: number
          repeat_target?: number
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      saved_filters: {
        Row: {
          conditions: Json
          created_at: string
          created_by: string | null
          id: string
          name: string
          page: string
        }
        Insert: {
          conditions: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          page: string
        }
        Update: {
          conditions?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          page?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_filters_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vpbx_calls: {
        Row: {
          answered_at: string | null
          client_id: string | null
          created_at: string
          direction: string
          duration: number
          external_call_id: string | null
          finish_status: string | null
          finished_at: string | null
          id: string
          is_recorded: boolean
          line_number: string | null
          manager_id: string | null
          number_a: string | null
          number_b: string | null
          record_url: string | null
          score: number | null
          started_at: string | null
          summary: string | null
          transcript: string | null
          transcription_status: string
          updated_at: string
          vpbx_uuid: string | null
        }
        Insert: {
          answered_at?: string | null
          client_id?: string | null
          created_at?: string
          direction?: string
          duration?: number
          external_call_id?: string | null
          finish_status?: string | null
          finished_at?: string | null
          id?: string
          is_recorded?: boolean
          line_number?: string | null
          manager_id?: string | null
          number_a?: string | null
          number_b?: string | null
          record_url?: string | null
          score?: number | null
          started_at?: string | null
          summary?: string | null
          transcript?: string | null
          transcription_status?: string
          updated_at?: string
          vpbx_uuid?: string | null
        }
        Update: {
          answered_at?: string | null
          client_id?: string | null
          created_at?: string
          direction?: string
          duration?: number
          external_call_id?: string | null
          finish_status?: string | null
          finished_at?: string | null
          id?: string
          is_recorded?: boolean
          line_number?: string | null
          manager_id?: string | null
          number_a?: string | null
          number_b?: string | null
          record_url?: string | null
          score?: number | null
          started_at?: string | null
          summary?: string | null
          transcript?: string | null
          transcription_status?: string
          updated_at?: string
          vpbx_uuid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vpbx_calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vpbx_calls_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vpbx_calls_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vpbx_events: {
        Row: {
          event_id: string
          payload: Json
          received_at: string
          type: string
          vpbx_uuid: string | null
        }
        Insert: {
          event_id: string
          payload: Json
          received_at?: string
          type: string
          vpbx_uuid?: string | null
        }
        Update: {
          event_id?: string
          payload?: Json
          received_at?: string
          type?: string
          vpbx_uuid?: string | null
        }
        Relationships: []
      }
      wazzup_api_log: {
        Row: {
          channel_id: string | null
          chat_id: string | null
          command: string
          created_at: string
          crm_entity: string | null
          crm_entity_id: string | null
          direction: string
          error_code: string | null
          http_status: number | null
          id: string
          latency_ms: number | null
          manager_id: string | null
          message_id: string | null
          op: string | null
          request: Json | null
          response: Json | null
        }
        Insert: {
          channel_id?: string | null
          chat_id?: string | null
          command: string
          created_at?: string
          crm_entity?: string | null
          crm_entity_id?: string | null
          direction?: string
          error_code?: string | null
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          manager_id?: string | null
          message_id?: string | null
          op?: string | null
          request?: Json | null
          response?: Json | null
        }
        Update: {
          channel_id?: string | null
          chat_id?: string | null
          command?: string
          created_at?: string
          crm_entity?: string | null
          crm_entity_id?: string | null
          direction?: string
          error_code?: string | null
          http_status?: number | null
          id?: string
          latency_ms?: number | null
          manager_id?: string | null
          message_id?: string | null
          op?: string | null
          request?: Json | null
          response?: Json | null
        }
        Relationships: []
      }
    }
    Views: {
      client_segments: {
        Row: {
          acquisition_source_id: string | null
          address: string | null
          assigned_manager_id: string | null
          avg_order_value: number | null
          created_at: string | null
          days_since_last_order: number | null
          id: string | null
          last_call_reason: string | null
          last_called_at: string | null
          last_order_date: string | null
          locked_by: string | null
          locked_until: string | null
          name: string | null
          next_action_at: string | null
          next_action_type: string | null
          phone: string | null
          rfm_segment: string | null
          segment_override: string | null
          sticky_note: string | null
          total_orders: number | null
          total_spent: number | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_acquisition_source_id_fkey"
            columns: ["acquisition_source_id"]
            isOneToOne: false
            referencedRelation: "acquisition_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      orders_unified: {
        Row: {
          address: string | null
          agbis_date_out: string | null
          agbis_debet: number | null
          agbis_discount: number | null
          agbis_doc_num: string | null
          agbis_dolg: number | null
          agbis_dor_id: string | null
          agbis_status_name: string | null
          agbis_user_name: string | null
          amount: number | null
          client_id: string | null
          client_name: string | null
          client_phone: string | null
          created_at: string | null
          id: string | null
          order_date: string | null
          service: string | null
          source: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      broadcast_no_order_ids: {
        Args: { p_days?: number }
        Returns: {
          client_id: string
        }[]
      }
      claim_agbis_outbox: {
        Args: { p_claimed_by?: string; p_entity: string; p_limit?: number }
        Returns: {
          attempts: number
          crm_id: string
          id: string
          max_attempts: number
          payload: Json
        }[]
      }
      compute_segment: {
        Args: { p_last_order_date: string; p_total_orders: number }
        Returns: string
      }
      create_order_with_items: {
        Args: {
          p_amount: number
          p_client_id: string
          p_comment?: string
          p_discount_amount?: number
          p_discount_percent?: number
          p_items?: Json
          p_services: string[]
        }
        Returns: {
          created_at: string
          order_id: string
        }[]
      }
      distinct_order_services: {
        Args: never
        Returns: {
          service: string
        }[]
      }
      order_list_brief: {
        Args: { p_client_id: string; p_manager_id: string; p_order_id: string }
        Returns: {
          addr: string
          client_name: string
          client_phone: string
          manager_name: string
        }[]
      }
      recalc_client_aggregates: {
        Args: { p_client_ids: string[] }
        Returns: undefined
      }
      settle_agbis_outbox: {
        Args: {
          p_backoff_seconds?: number
          p_error?: string
          p_id: string
          p_success: boolean
        }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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

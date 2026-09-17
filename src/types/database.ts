export interface Agent {
  id: string;
  user_id: string;
  display_name: string;
  phone: string | null;
  role: "admin" | "agent";
  presence: "online" | "offline" | "away";
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  phone: string;
  phone_normalized: string;
  name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  customer_id: string;
  assigned_agent_id: string | null;
  status: "open" | "resolved" | "pending";
  unread_count: number;
  last_message_preview: string | null;
  last_message_at: string | null;
  last_activity_at: string;
  whatsapp_window_expires_at: string | null;
  created_at: string;
  updated_at: string;
  customer?: Customer;
  assigned_agent?: Agent | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  customer_id: string;
  agent_id: string | null;
  direction: "inbound" | "outbound";
  body: string;
  message_type: "text" | "template" | "media";
  status: "pending" | "sent" | "delivered" | "failed" | "read";
  provider_message_id: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CallEvent {
  id: string;
  conversation_id: string | null;
  customer_id: string;
  agent_id: string | null;
  direction: "inbound" | "outbound";
  provider_call_id: string | null;
  status: "initiated" | "ringing" | "answered" | "completed" | "failed" | "busy" | "no-answer" | "cancelled";
  duration_seconds: number | null;
  failure_reason: string | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WhatsappTemplate {
  id: string;
  name: string;
  body: string;
  language: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface AppSettings {
  exotel_sid: string;
  exotel_api_key: string;
  exotel_api_token: string;
  exotel_whatsapp_number: string;
  exotel_caller_id: string;
  exotel_app_id: string;
  exotel_webhook_secret: string;
  [key: string]: string;
}

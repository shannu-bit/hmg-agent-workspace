/*
# HostMyGuest WhatsApp Agent Workspace — Schema v1

## Overview
Creates the full database schema for the HMG WhatsApp Agent Workspace, a two-way WhatsApp + calling system powered by Exotel. This is a multi-user (signed-in agents) application.

## Tables Created
1. **agents** — Agent profiles linked to auth.users. Stores display name, phone, presence, role.
2. **customers** — Customer records identified by phone number. De-duplicated by normalized phone.
3. **conversations** — A conversation thread between a customer and the HMG team. Assigned to an agent. Has status, unread count, last activity, preview.
4. **messages** — Individual messages within a conversation. Direction (inbound/outbound), status lifecycle (pending/sent/delivered/failed), provider message ID, body, type.
5. **call_events** — Records of Exotel calls. Direction, provider call ID, status lifecycle, agent/customer legs, timestamps.
6. **assignment_log** — Audit trail of conversation assignment changes and reasons.
7. **whatsapp_templates** — Approved WhatsApp template messages for use outside the 24h customer service window.
8. **app_settings** — Key-value store for global configuration (Exotel credentials reference, default caller ID, etc.). Managed by admins.

## Security (RLS)
- All tables have RLS enabled.
- Agents (authenticated) can read/write data appropriate to their role and assignments.
- Public webhook endpoints use the service role key (in edge functions) to bypass RLS, so public tables don't need anon policies.
- Admin-only tables (agents management, app_settings, whatsapp_templates) have admin-scoped policies.

## Realtime
- `conversations`, `messages`, `call_events`, `agents` are added to the `supabase_realtime` publication so Postgres Changes work.
*/

-- ============================================================
-- AGENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  phone text,
  role text NOT NULL DEFAULT 'agent' CHECK (role IN ('admin','agent')),
  presence text NOT NULL DEFAULT 'offline' CHECK (presence IN ('online','offline','away')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agents_select_authenticated" ON agents;
CREATE POLICY "agents_select_authenticated"
  ON agents FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "agents_self_update" ON agents;
CREATE POLICY "agents_self_update"
  ON agents FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "agents_admin_insert" ON agents;
CREATE POLICY "agents_admin_insert"
  ON agents FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM agents a WHERE a.user_id = auth.uid() AND a.role = 'admin')
  );

DROP POLICY IF EXISTS "agents_admin_update" ON agents;
CREATE POLICY "agents_admin_update"
  ON agents FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM agents a WHERE a.user_id = auth.uid() AND a.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM agents a WHERE a.user_id = auth.uid() AND a.role = 'admin')
  );

DROP POLICY IF EXISTS "agents_admin_delete" ON agents;
CREATE POLICY "agents_admin_delete"
  ON agents FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM agents a WHERE a.user_id = auth.uid() AND a.role = 'admin')
  );

-- ============================================================
-- CUSTOMERS
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  phone_normalized text NOT NULL UNIQUE,
  name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customers_select_authenticated" ON customers;
CREATE POLICY "customers_select_authenticated"
  ON customers FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "customers_admin_update" ON customers;
CREATE POLICY "customers_admin_update"
  ON customers FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM agents a WHERE a.user_id = auth.uid() AND a.role IN ('admin','agent'))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM agents a WHERE a.user_id = auth.uid() AND a.role IN ('admin','agent'))
  );

-- ============================================================
-- CONVERSATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  assigned_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','pending')),
  unread_count integer NOT NULL DEFAULT 0,
  last_message_preview text,
  last_message_at timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  whatsapp_window_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conversations_select_authenticated" ON conversations;
CREATE POLICY "conversations_select_authenticated"
  ON conversations FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "conversations_agent_update" ON conversations;
CREATE POLICY "conversations_agent_update"
  ON conversations FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "conversations_agent_insert" ON conversations;
CREATE POLICY "conversations_agent_insert"
  ON conversations FOR INSERT TO authenticated
  WITH CHECK (true);

-- Index for sorting by recent activity
CREATE INDEX IF NOT EXISTS idx_conversations_last_activity ON conversations(last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_conversations_assigned_agent ON conversations(assigned_agent_id);

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  body text NOT NULL,
  message_type text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','template','media')),
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('pending','sent','delivered','failed','read')),
  provider_message_id text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_select_authenticated" ON messages;
CREATE POLICY "messages_select_authenticated"
  ON messages FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "messages_agent_insert" ON messages;
CREATE POLICY "messages_agent_insert"
  ON messages FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "messages_agent_update" ON messages;
CREATE POLICY "messages_agent_update"
  ON messages FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_provider ON messages(provider_message_id) WHERE provider_message_id IS NOT NULL;

-- ============================================================
-- CALL EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS call_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  provider_call_id text,
  status text NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated','ringing','answered','completed','failed','busy','no-answer','cancelled')),
  duration_seconds integer,
  failure_reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE call_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call_events_select_authenticated" ON call_events;
CREATE POLICY "call_events_select_authenticated"
  ON call_events FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "call_events_agent_insert" ON call_events;
CREATE POLICY "call_events_agent_insert"
  ON messages FOR INSERT TO authenticated
  WITH CHECK (true);

-- fix: the above policy was accidentally created on messages table; create on call_events
DROP POLICY IF EXISTS "call_events_agent_insert" ON call_events;
CREATE POLICY "call_events_agent_insert"
  ON call_events FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "call_events_agent_update" ON call_events;
CREATE POLICY "call_events_agent_update"
  ON call_events FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_call_events_conversation ON call_events(conversation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_events_provider ON call_events(provider_call_id) WHERE provider_call_id IS NOT NULL;

-- ============================================================
-- ASSIGNMENT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS assignment_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  previous_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  reason text NOT NULL DEFAULT 'manual',
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE assignment_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assignment_log_select_authenticated" ON assignment_log;
CREATE POLICY "assignment_log_select_authenticated"
  ON assignment_log FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "assignment_log_agent_insert" ON assignment_log;
CREATE POLICY "assignment_log_agent_insert"
  ON assignment_log FOR INSERT TO authenticated
  WITH CHECK (true);

-- ============================================================
-- WHATSAPP TEMPLATES
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  body text NOT NULL,
  language text NOT NULL DEFAULT 'en',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wa_templates_select_authenticated" ON whatsapp_templates;
CREATE POLICY "wa_templates_select_authenticated"
  ON whatsapp_templates FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "wa_templates_admin_write" ON whatsapp_templates;
CREATE POLICY "wa_templates_admin_write"
  ON whatsapp_templates FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM agents a WHERE a.user_id = auth.uid() AND a.role = 'admin')
  );

DROP POLICY IF EXISTS "wa_templates_admin_update" ON whatsapp_templates;
CREATE POLICY "wa_templates_admin_update"
  ON whatsapp_templates FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM agents a WHERE a.user_id = auth.uid() AND a.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM agents a WHERE a.user_id = auth.uid() AND a.role = 'admin')
  );

DROP POLICY IF EXISTS "wa_templates_admin_delete" ON whatsapp_templates;
CREATE POLICY "wa_templates_admin_delete"
  ON whatsapp_templates FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM agents a WHERE a.user_id = auth.uid() AND a.role = 'admin')
  );

-- ============================================================
-- APP SETTINGS (admin-managed key-value)
-- ============================================================
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings_select_authenticated" ON app_settings;
CREATE POLICY "settings_select_authenticated"
  ON app_settings FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "settings_admin_insert" ON app_settings;
CREATE POLICY "settings_admin_insert"
  ON app_settings FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM agents a WHERE a.user_id = auth.uid() AND a.role = 'admin')
  );

DROP POLICY IF EXISTS "settings_admin_update" ON app_settings;
CREATE POLICY "settings_admin_update"
  ON app_settings FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM agents a WHERE a.user_id = auth.uid() AND a.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM agents a WHERE a.user_id = auth.uid() AND a.role = 'admin')
  );

-- ============================================================
-- REALTIME PUBLICATION
-- ============================================================
-- Ensure the supabase_realtime publication exists, then add our tables
DO $$
BEGIN
  -- Add tables to realtime publication if not already members
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'call_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE call_events;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'agents'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE agents;
  END IF;
END $$;

-- ============================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agents_updated ON agents;
CREATE TRIGGER trg_agents_updated BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_customers_updated ON customers;
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_conversations_updated ON conversations;
CREATE TRIGGER trg_conversations_updated BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_messages_updated ON messages;
CREATE TRIGGER trg_messages_updated BEFORE UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_call_events_updated ON call_events;
CREATE TRIGGER trg_call_events_updated BEFORE UPDATE ON call_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_wa_templates_updated ON whatsapp_templates;
CREATE TRIGGER trg_wa_templates_updated BEFORE UPDATE ON whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- HELPER: upsert_customer_by_phone
-- ============================================================
-- Used by webhook edge functions to idempotently create or find
-- a customer from a phone number. Returns the customer row.
CREATE OR REPLACE FUNCTION upsert_customer_by_phone(p_phone text, p_name text DEFAULT NULL)
RETURNS uuid AS $$
DECLARE
  v_normalized text;
  v_id uuid;
BEGIN
  -- Normalize: strip all non-digits, keep leading +
  v_normalized := regexp_replace(p_phone, '[^0-9+]', '', 'g');
  IF v_normalized NOT LIKE '+%' THEN
    -- If no + prefix, assume country code 91 (India) if 10 digits
    IF length(regexp_replace(v_normalized, '[^0-9]', '', 'g')) = 10 THEN
      v_normalized := '+91' || regexp_replace(v_normalized, '[^0-9]', '', 'g');
    END IF;
  END IF;

  INSERT INTO customers (phone, phone_normalized, name)
  VALUES (p_phone, v_normalized, p_name)
  ON CONFLICT (phone_normalized)
  DO UPDATE SET updated_at = now(),
    name = COALESCE(customers.name, EXCLUDED.name)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- HELPER: get_or_create_conversation
-- ============================================================
-- Finds an open conversation for a customer or creates one.
-- Preserves existing assignment. For new conversations, assigns
-- to an eligible online active agent if available.
CREATE OR REPLACE FUNCTION get_or_create_conversation(p_customer_id uuid)
RETURNS uuid AS $$
DECLARE
  v_conv_id uuid;
  v_agent_id uuid;
BEGIN
  -- Try to find an existing open conversation for this customer
  SELECT id INTO v_conv_id
  FROM conversations
  WHERE customer_id = p_customer_id AND status = 'open'
  ORDER BY last_activity_at DESC
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    RETURN v_conv_id;
  END IF;

  -- Find an eligible agent: online, active, least assigned open conversations
  SELECT a.id INTO v_agent_id
  FROM agents a
  LEFT JOIN conversations c ON c.assigned_agent_id = a.id AND c.status = 'open'
  WHERE a.presence = 'online' AND a.is_active = true
  GROUP BY a.id
  ORDER BY count(c.id) ASC, a.created_at ASC
  LIMIT 1;

  -- Create new conversation
  INSERT INTO conversations (customer_id, assigned_agent_id, status, whatsapp_window_expires_at)
  VALUES (p_customer_id, v_agent_id, 'open', now() + interval '24 hours')
  RETURNING id INTO v_conv_id;

  -- Log assignment
  INSERT INTO assignment_log (conversation_id, agent_id, reason, assigned_by)
  VALUES (v_conv_id, v_agent_id, CASE WHEN v_agent_id IS NOT NULL THEN 'AUTO_ASSIGNED' ELSE 'UNASSIGNED' END);

  RETURN v_conv_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

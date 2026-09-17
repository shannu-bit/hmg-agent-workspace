import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface AgentRow {
  id: string;
  user_id: string;
  display_name: string;
  phone: string | null;
  role: string;
  presence: string;
  is_active: boolean;
}

interface ConversationRow {
  id: string;
  customer_id: string;
  assigned_agent_id: string | null;
  status: string;
  whatsapp_window_expires_at: string | null;
}

interface CustomerRow {
  id: string;
  phone: string;
  phone_normalized: string;
  name: string | null;
}

interface SettingRow {
  key: string;
  value: string;
}

async function getSettings(supabase: ReturnType<typeof createClient>): Promise<Record<string, string>> {
  const { data, error } = await supabase.from("app_settings").select("key, value");
  if (error) throw new Error(`settings fetch: ${error.message}`);
  const map: Record<string, string> = {};
  for (const row of (data || []) as SettingRow[]) {
    map[row.key] = row.value;
  }
  return map;
}

async function getAgent(supabase: ReturnType<typeof createClient>, userId: string): Promise<AgentRow | null> {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`agent lookup: ${error.message}`);
  return data as AgentRow | null;
}

async function getConversation(supabase: ReturnType<typeof createClient>, convId: string): Promise<ConversationRow | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", convId)
    .maybeSingle();
  if (error) throw new Error(`conversation lookup: ${error.message}`);
  return data as ConversationRow | null;
}

async function getCustomer(supabase: ReturnType<typeof createClient>, custId: string): Promise<CustomerRow | null> {
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("id", custId)
    .maybeSingle();
  if (error) throw new Error(`customer lookup: ${error.message}`);
  return data as CustomerRow | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const supabaseAnon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: {
        headers: {
          Authorization: req.headers.get("Authorization") || "",
        },
      },
    },
  );

  const { data: authData, error: authError } = await supabaseAnon.auth.getUser();
  if (authError || !authData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const userId = authData.user.id;

  let agent: AgentRow;
  try {
    const a = await getAgent(supabase, userId);
    if (!a || !a.is_active) {
      return jsonResponse({ error: "Agent not found or inactive" }, 403);
    }
    agent = a;
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500);
  }

  const url = new URL(req.url);
  const functionMarker = "/hmg-api";
  const markerIndex = url.pathname.indexOf(functionMarker);
  const path = markerIndex >= 0
    ? url.pathname.slice(markerIndex + functionMarker.length).replace(/^\//, "")
    : url.pathname.replace(/^\//, "");

  try {
    // ===== WHATSAPP SEND =====
    if (path === "whatsapp/send" && req.method === "POST") {
      const { conversationId, body } = await req.json();
      if (!conversationId || !body) {
        return jsonResponse({ error: "conversationId and body are required" }, 400);
      }

      const conv = await getConversation(supabase, conversationId);
      if (!conv) return jsonResponse({ error: "Conversation not found" }, 404);

      const customer = await getCustomer(supabase, conv.customer_id);
      if (!customer) return jsonResponse({ error: "Customer not found" }, 404);
      if (!customer.phone) return jsonResponse({ error: "Customer has no phone number" }, 400);

      const settings = await getSettings(supabase);
      const exotelSid = settings["exotel_sid"];
      const exotelApiKey = settings["exotel_api_key"];
      const exotelApiToken = settings["exotel_api_token"];
      const exotelWaNumber = settings["exotel_whatsapp_number"];

      if (!exotelSid || !exotelApiKey || !exotelApiToken) {
        return jsonResponse({ error: "Exotel credentials not configured. Please configure them in Admin settings." }, 500);
      }

      // Check 24h window
      const windowExpiry = conv.whatsapp_window_expires_at ? new Date(conv.whatsapp_window_expires_at) : null;
      const withinWindow = windowExpiry ? windowExpiry > new Date() : false;

      let messageType = "text";
      let messageBody = body;

      if (!withinWindow) {
        // Need to use a template
        const { data: template } = await supabase
          .from("whatsapp_templates")
          .select("*")
          .eq("is_active", true)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (!template) {
          return jsonResponse({
            error: "Conversation is outside the 24-hour WhatsApp window and no approved template is configured. Please add a template in Admin settings.",
          }, 400);
        }
        messageType = "template";
        messageBody = template.body;
      }

      // Insert pending message
      const { data: msgRow, error: msgErr } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          customer_id: conv.customer_id,
          agent_id: agent.id,
          direction: "outbound",
          body: messageBody,
          message_type: messageType,
          status: "pending",
        })
        .select("*")
        .single();
      if (msgErr) throw new Error(`insert message: ${msgErr.message}`);

      // Call Exotel WhatsApp API
      const exotelUrl = `https://${exotelSid}.api.exotel.com/v2/messages`;
      const authHeader = "Basic " + btoa(`${exotelApiKey}:${exotelApiToken}`);
      const payload: Record<string, unknown> = {
        from: exotelWaNumber,
        to: customer.phone,
        type: messageType === "template" ? "template" : "text",
      };
      if (messageType === "template") {
        payload.template = { name: "first_response", language: "en", components: [] };
      } else {
        payload.text = { body: messageBody };
      }

      let exotelResponse: Response;
      try {
        exotelResponse = await fetch(exotelUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": authHeader,
          },
          body: JSON.stringify(payload),
        });
      } catch (fetchErr) {
        await supabase.from("messages").update({
          status: "failed",
          failure_reason: "Network error contacting Exotel",
          updated_at: new Date().toISOString(),
        }).eq("id", msgRow.id);
        return jsonResponse({ error: "Failed to reach Exotel API", messageId: msgRow.id, status: "failed" }, 502);
      }

      if (!exotelResponse.ok) {
        const errText = await exotelResponse.text();
        await supabase.from("messages").update({
          status: "failed",
          failure_reason: `Exotel error ${exotelResponse.status}: ${errText}`,
          updated_at: new Date().toISOString(),
        }).eq("id", msgRow.id);
        return jsonResponse({
          error: `Exotel rejected the message (${exotelResponse.status})`,
          messageId: msgRow.id,
          status: "failed",
        }, 502);
      }

      const exotelData = await exotelResponse.json();
      const providerMsgId = exotelData?.id || exotelData?.message_id || exotelData?.messages?.[0]?.id || null;

      await supabase.from("messages").update({
        status: "sent",
        provider_message_id: providerMsgId,
        updated_at: new Date().toISOString(),
      }).eq("id", msgRow.id);

      // Update conversation preview
      await supabase.from("conversations").update({
        last_message_preview: messageBody.slice(0, 200),
        last_message_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", conversationId);

      return jsonResponse({ success: true, messageId: msgRow.id, status: "sent", providerMessageId: providerMsgId });
    }

    // ===== CALL INITIATE =====
    if (path === "calls/outbound" && req.method === "POST") {
      const { conversationId } = await req.json();
      if (!conversationId) return jsonResponse({ error: "conversationId is required" }, 400);

      const conv = await getConversation(supabase, conversationId);
      if (!conv) return jsonResponse({ error: "Conversation not found" }, 404);

      const customer = await getCustomer(supabase, conv.customer_id);
      if (!customer || !customer.phone) return jsonResponse({ error: "Customer has no phone number" }, 400);

      if (!agent.phone) return jsonResponse({ error: "Your agent phone number is not set. Ask an admin to configure it." }, 400);

      const settings = await getSettings(supabase);
      const exotelSid = settings["exotel_sid"];
      const exotelApiKey = settings["exotel_api_key"];
      const exotelApiToken = settings["exotel_api_token"];
      const callerId = settings["exotel_caller_id"];

      if (!exotelSid || !exotelApiKey || !exotelApiToken) {
        return jsonResponse({ error: "Exotel credentials not configured" }, 500);
      }
      if (!callerId) return jsonResponse({ error: "Exotel caller ID not configured" }, 500);

      // Insert call event as initiated
      const { data: callRow, error: callErr } = await supabase
        .from("call_events")
        .insert({
          conversation_id: conversationId,
          customer_id: conv.customer_id,
          agent_id: agent.id,
          direction: "outbound",
          status: "initiated",
        })
        .select("*")
        .single();
      if (callErr) throw new Error(`insert call_event: ${callErr.message}`);

      // Exotel Click-to-Call (Connect) API
      const exotelUrl = `https://${exotelSid}.exotel.com/v1/accounts/${exotelSid}/calls/connect`;
      const authHeader = "Basic " + btoa(`${exotelApiKey}:${exotelApiToken}`);
      const formData = new URLSearchParams();
      formData.append("From", agent.phone);
      formData.append("To", customer.phone);
      formData.append("CallerId", callerId);
      formData.append("CallType", "trans");
      // Status webhook URL — Exotel will POST events to our call webhook
      formData.append("StatusCallback", `${Deno.env.get("SUPABASE_URL")}/functions/v1/exotel-call-webhook`);

      let exotelResponse: Response;
      try {
        exotelResponse = await fetch(exotelUrl, {
          method: "POST",
          headers: {
            "Authorization": authHeader,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData.toString(),
        });
      } catch (fetchErr) {
        await supabase.from("call_events").update({
          status: "failed",
          failure_reason: "Network error contacting Exotel",
          updated_at: new Date().toISOString(),
        }).eq("id", callRow.id);
        return jsonResponse({ error: "Failed to reach Exotel call API", callId: callRow.id, status: "failed" }, 502);
      }

      if (!exotelResponse.ok) {
        const errText = await exotelResponse.text();
        await supabase.from("call_events").update({
          status: "failed",
          failure_reason: `Exotel error ${exotelResponse.status}: ${errText}`,
          updated_at: new Date().toISOString(),
        }).eq("id", callRow.id);
        return jsonResponse({
          error: `Exotel rejected the call (${exotelResponse.status})`,
          callId: callRow.id,
          status: "failed",
        }, 502);
      }

      const exotelData = await exotelResponse.json();
      const providerCallId = exotelData?.Call?.CallSid || exotelData?.CallSid || exotelData?.call_id || null;

      await supabase.from("call_events").update({
        provider_call_id: providerCallId,
        updated_at: new Date().toISOString(),
      }).eq("id", callRow.id);

      // Update conversation activity
      await supabase.from("conversations").update({
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", conversationId);

      return jsonResponse({ success: true, callId: callRow.id, providerCallId, status: "initiated" });
    }

    // ===== CONVERSATION TRANSFER =====
    if (path === "conversations/transfer" && req.method === "POST") {
      const { conversationId, targetAgentId } = await req.json();
      if (!conversationId || !targetAgentId) return jsonResponse({ error: "conversationId and targetAgentId are required" }, 400);

      const conv = await getConversation(supabase, conversationId);
      if (!conv) return jsonResponse({ error: "Conversation not found" }, 404);

      const { data: targetAgent } = await supabase.from("agents").select("*").eq("id", targetAgentId).maybeSingle();
      if (!targetAgent || !(targetAgent as AgentRow).is_active) {
        return jsonResponse({ error: "Target agent not found or inactive" }, 400);
      }

      const prevAgent = conv.assigned_agent_id;
      await supabase.from("conversations").update({
        assigned_agent_id: targetAgentId,
        updated_at: new Date().toISOString(),
      }).eq("id", conversationId);

      await supabase.from("assignment_log").insert({
        conversation_id: conversationId,
        agent_id: targetAgentId,
        previous_agent_id: prevAgent,
        reason: "TRANSFER",
        assigned_by: userId,
      });

      return jsonResponse({ success: true });
    }

    // ===== CONVERSATION RESOLVE =====
    if (path === "conversations/resolve" && req.method === "POST") {
      const { conversationId } = await req.json();
      if (!conversationId) return jsonResponse({ error: "conversationId is required" }, 400);

      await supabase.from("conversations").update({
        status: "resolved",
        updated_at: new Date().toISOString(),
      }).eq("id", conversationId);

      return jsonResponse({ success: true });
    }

    // ===== CONVERSATION REOPEN =====
    if (path === "conversations/reopen" && req.method === "POST") {
      const { conversationId } = await req.json();
      if (!conversationId) return jsonResponse({ error: "conversationId is required" }, 400);

      await supabase.from("conversations").update({
        status: "open",
        updated_at: new Date().toISOString(),
      }).eq("id", conversationId);

      return jsonResponse({ success: true });
    }

    // ===== MARK READ =====
    if (path === "conversations/mark-read" && req.method === "POST") {
      const { conversationId } = await req.json();
      if (!conversationId) return jsonResponse({ error: "conversationId is required" }, 400);

      await supabase.from("conversations").update({
        unread_count: 0,
        updated_at: new Date().toISOString(),
      }).eq("id", conversationId);

      return jsonResponse({ success: true });
    }

    // ===== PRESENCE UPDATE =====
    if (path === "agent/presence" && req.method === "POST") {
      const { presence } = await req.json();
      if (!["online", "offline", "away"].includes(presence)) {
        return jsonResponse({ error: "Invalid presence value" }, 400);
      }

      await supabase.from("agents").update({
        presence,
        updated_at: new Date().toISOString(),
      }).eq("id", agent.id);

      return jsonResponse({ success: true, presence });
    }

    // ===== ADMIN: AGENT CRUD =====
    if (path === "admin/agents" && req.method === "POST") {
      if (agent.role !== "admin") return jsonResponse({ error: "Admin access required" }, 403);
      const { email, displayName, phone, role, password } = await req.json();
      if (!email || !displayName || !password) return jsonResponse({ error: "email, displayName, and password are required" }, 400);

      // Create auth user
      const { data: newUser, error: signupErr } = await supabaseAnon.auth.signUp({
        email,
        password,
      });
      if (signupErr || !newUser.user) {
        return jsonResponse({ error: signupErr?.message || "Failed to create user" }, 400);
      }

      // Create agent profile
      const { error: agentErr } = await supabase.from("agents").insert({
        user_id: newUser.user.id,
        display_name: displayName,
        phone: phone || null,
        role: role || "agent",
      });
      if (agentErr) throw new Error(`create agent: ${agentErr.message}`);

      return jsonResponse({ success: true, userId: newUser.user.id });
    }

    if (path === "admin/agents" && req.method === "PUT") {
      if (agent.role !== "admin") return jsonResponse({ error: "Admin access required" }, 403);
      const { agentId, displayName, phone, role, isActive } = await req.json();
      if (!agentId) return jsonResponse({ error: "agentId is required" }, 400);

      const updates: Record<string, unknown> = {};
      if (displayName !== undefined) updates.display_name = displayName;
      if (phone !== undefined) updates.phone = phone;
      if (role !== undefined) updates.role = role;
      if (isActive !== undefined) updates.is_active = isActive;

      const { error: updErr } = await supabase.from("agents").update(updates).eq("id", agentId);
      if (updErr) throw new Error(`update agent: ${updErr.message}`);

      return jsonResponse({ success: true });
    }

    if (path === "admin/agents" && req.method === "DELETE") {
      if (agent.role !== "admin") return jsonResponse({ error: "Admin access required" }, 403);
      const { agentId } = await req.json();
      if (!agentId) return jsonResponse({ error: "agentId is required" }, 400);

      const { error: delErr } = await supabase.from("agents").update({
        is_active: false,
        updated_at: new Date().toISOString(),
      }).eq("id", agentId);
      if (delErr) throw new Error(`deactivate agent: ${delErr.message}`);

      return jsonResponse({ success: true });
    }

    // ===== ADMIN: WHATSAPP TEMPLATES =====
    if (path === "admin/templates" && req.method === "POST") {
      if (agent.role !== "admin") return jsonResponse({ error: "Admin access required" }, 403);
      const { name, body, language } = await req.json();
      if (!name || !body) return jsonResponse({ error: "name and body are required" }, 400);

      const { data, error } = await supabase.from("whatsapp_templates").insert({
        name, body, language: language || "en", is_active: true,
      }).select("*").single();
      if (error) throw new Error(`create template: ${error.message}`);

      return jsonResponse({ success: true, template: data });
    }

    if (path === "admin/templates" && req.method === "PUT") {
      if (agent.role !== "admin") return jsonResponse({ error: "Admin access required" }, 403);
      const { templateId, name, body, language, isActive } = await req.json();
      if (!templateId) return jsonResponse({ error: "templateId is required" }, 400);

      const updates: Record<string, unknown> = {};
      if (name !== undefined) updates.name = name;
      if (body !== undefined) updates.body = body;
      if (language !== undefined) updates.language = language;
      if (isActive !== undefined) updates.is_active = isActive;

      const { error } = await supabase.from("whatsapp_templates").update(updates).eq("id", templateId);
      if (error) throw new Error(`update template: ${error.message}`);

      return jsonResponse({ success: true });
    }

    if (path === "admin/templates" && req.method === "DELETE") {
      if (agent.role !== "admin") return jsonResponse({ error: "Admin access required" }, 403);
      const { templateId } = await req.json();
      if (!templateId) return jsonResponse({ error: "templateId is required" }, 400);

      const { error } = await supabase.from("whatsapp_templates").delete().eq("id", templateId);
      if (error) throw new Error(`delete template: ${error.message}`);

      return jsonResponse({ success: true });
    }

    // ===== ADMIN: SETTINGS UPDATE =====
    if (path === "admin/settings" && req.method === "PUT") {
      if (agent.role !== "admin") return jsonResponse({ error: "Admin access required" }, 403);
      const { settings } = await req.json();
      if (!settings || typeof settings !== "object") return jsonResponse({ error: "settings object is required" }, 400);

      for (const [key, value] of Object.entries(settings)) {
        await supabase.from("app_settings").upsert({
          key,
          value: String(value),
          updated_by: userId,
          updated_at: new Date().toISOString(),
        }, { onConflict: "key" });
      }

      return jsonResponse({ success: true });
    }

    // ===== ADMIN: GET SETTINGS =====
    if (path === "admin/settings" && req.method === "GET") {
      if (agent.role !== "admin") return jsonResponse({ error: "Admin access required" }, 403);
      const settings = await getSettings(supabase);
      // Don't return actual secret values, just whether they're set
      const safe: Record<string, boolean | string> = {};
      for (const [k, v] of Object.entries(settings)) {
        if (k.includes("key") || k.includes("token") || k.includes("secret")) {
          safe[k] = v ? true : false;
        } else {
          safe[k] = v;
        }
      }
      return jsonResponse({ settings: safe });
    }

    return jsonResponse({ error: `Not found: ${path}` }, 404);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

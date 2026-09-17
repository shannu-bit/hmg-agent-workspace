import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Normalize Exotel call status to our internal status
function normalizeCallStatus(status: string): string {
  const lower = status.toLowerCase();
  const map: Record<string, string> = {
    "ringing": "ringing",
    "in-progress": "answered",
    "answered": "answered",
    "completed": "completed",
    "failed": "failed",
    "busy": "busy",
    "no-answer": "no-answer",
    "canceled": "cancelled",
    "cancelled": "cancelled",
    "initiated": "initiated",
  };
  return map[lower] || lower;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    let data: Record<string, unknown> = {};

    const contentType = req.headers.get("Content-Type") || "";

    if (contentType.includes("application/json")) {
      data = await req.json();
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      for (const [key, value] of formData.entries()) {
        data[key] = value;
      }
    } else if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      for (const [key, value] of formData.entries()) {
        data[key] = value;
      }
    } else {
      try {
        data = await req.json();
      } catch {
        const text = await req.text();
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }
      }
    }

    // Exotel call webhook fields can be nested or flat
    const callData = (data.Call || data.call || data) as Record<string, unknown>;
    const callSid = String(callData.CallSid || callData.callSid || callData.CallId || callData.call_id || data.CallSid || data.callSid || "");
    const status = String(callData.Status || callData.status || data.Status || data.status || "");

    if (!callSid && !status) {
      return jsonResponse({ error: "No call SID or status in payload" }, 400);
    }

    const normalizedStatus = normalizeCallStatus(status);

    // Find the call event by provider call ID
    const { data: callEvent, error: lookupErr } = await supabase
      .from("call_events")
      .select("*")
      .eq("provider_call_id", callSid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lookupErr) throw new Error(`call event lookup: ${lookupErr.message}`);

    if (callEvent) {
      // Update existing call event
      const updates: Record<string, unknown> = {
        status: normalizedStatus,
        updated_at: new Date().toISOString(),
      };

      if (normalizedStatus === "answered" && !callEvent.answered_at) {
        updates.answered_at = new Date().toISOString();
      }
      if (["completed", "failed", "busy", "no-answer", "cancelled"].includes(normalizedStatus)) {
        updates.ended_at = new Date().toISOString();
        const start = new Date(callEvent.started_at).getTime();
        const end = Date.now();
        updates.duration_seconds = Math.round((end - start) / 1000);
      }
      if (normalizedStatus === "failed") {
        updates.failure_reason = String(callData.CallFailureReason || callData.Reason || "Call failed");
      }

      await supabase.from("call_events").update(updates).eq("id", callEvent.id);

      // Update conversation activity
      if (callEvent.conversation_id) {
        await supabase.from("conversations").update({
          last_activity_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", callEvent.conversation_id);
      }

      return jsonResponse({ success: true, callEventId: callEvent.id, status: normalizedStatus });
    }

    // ===== INBOUND CALL (no existing call event found) =====
    // This is an incoming call from a customer
    const fromPhone = String(callData.From || callData.from || data.From || data.from || "");
    const toPhone = String(callData.To || callData.to || data.To || data.to || "");
    const agentPhone = String(callData.To || callData.to || ""); // For inbound, agent leg is "To"

    if (!fromPhone) {
      return jsonResponse({ error: "Cannot determine caller phone" }, 400);
    }

    // Create/find customer
    const { data: customerId } = await supabase.rpc("upsert_customer_by_phone", {
      p_phone: fromPhone,
    });
    if (!customerId) throw new Error("Failed to upsert customer");

    // Find or create conversation
    const { data: conversationId } = await supabase.rpc("get_or_create_conversation", {
      p_customer_id: customerId,
    });
    if (!conversationId) throw new Error("Failed to get/create conversation");

    // Try to identify the answering agent by the destination phone
    let answeringAgentId: string | null = null;
    if (agentPhone) {
      const { data: agentByPhone } = await supabase
        .from("agents")
        .select("id")
        .eq("phone", agentPhone)
        .maybeSingle();
      if (agentByPhone) {
        answeringAgentId = (agentByPhone as { id: string }).id;
      }
    }

    const normalizedDir = "inbound";

    // Insert call event
    const { data: newCallEvent, error: callErr } = await supabase
      .from("call_events")
      .insert({
        conversation_id: conversationId,
        customer_id: customerId,
        agent_id: answeringAgentId,
        direction: normalizedDir,
        provider_call_id: callSid || null,
        status: normalizedStatus,
      })
      .select("*")
      .single();
    if (callErr) throw new Error(`insert call event: ${callErr.message}`);

    // If call was answered, assign conversation to the answering agent
    if (normalizedStatus === "answered" || normalizedStatus === "completed") {
      if (answeringAgentId) {
        const { data: conv } = await supabase
          .from("conversations")
          .select("assigned_agent_id")
          .eq("id", conversationId)
          .maybeSingle();

        const prevAgent = conv?.assigned_agent_id || null;
        await supabase.from("conversations").update({
          assigned_agent_id: answeringAgentId,
          updated_at: new Date().toISOString(),
        }).eq("id", conversationId);

        await supabase.from("assignment_log").insert({
          conversation_id: conversationId,
          agent_id: answeringAgentId,
          previous_agent_id: prevAgent,
          reason: "ANSWERED_CALL",
        });
      }
    }

    // If call was missed (no-answer, busy, failed) — do NOT auto-call back
    if (["no-answer", "busy", "failed"].includes(normalizedStatus)) {
      // Record MISSED_CALL and attempt template response if nobody is online
      const { data: onlineAgents } = await supabase
        .from("agents")
        .select("id")
        .eq("presence", "online")
        .eq("is_active", true);

      if (!onlineAgents || onlineAgents.length === 0) {
        // Nobody online — optionally send first-response template
        // Check if within WhatsApp window before sending
        const { data: conv } = await supabase
          .from("conversations")
          .select("whatsapp_window_expires_at")
          .eq("id", conversationId)
          .maybeSingle();

        const windowExpiry = conv?.whatsapp_window_expires_at ? new Date(conv.whatsapp_window_expires_at) : null;
        const withinWindow = windowExpiry ? windowExpiry > new Date() : false;

        if (!withinWindow) {
          // Use template since outside 24h window
          const { data: template } = await supabase
            .from("whatsapp_templates")
            .select("*")
            .eq("is_active", true)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();

          if (template) {
            // Insert template message as outbound
            const { data: settingsData } = await supabase.from("app_settings").select("key, value");
            const settings: Record<string, string> = {};
            for (const row of (settingsData || []) as { key: string; value: string }[]) {
              settings[row.key] = row.value;
            }

            const exotelSid = settings["exotel_sid"];
            const exotelApiKey = settings["exotel_api_key"];
            const exotelApiToken = settings["exotel_api_token"];
            const exotelWaNumber = settings["exotel_whatsapp_number"];

            if (exotelSid && exotelApiKey && exotelApiToken && exotelWaNumber) {
              const { data: customerRow } = await supabase
                .from("customers")
                .select("phone")
                .eq("id", customerId)
                .maybeSingle();

              if (customerRow?.phone) {
                const { data: pendingMsg } = await supabase.from("messages").insert({
                  conversation_id: conversationId,
                  customer_id: customerId,
                  agent_id: null,
                  direction: "outbound",
                  body: template.body,
                  message_type: "template",
                  status: "pending",
                }).select("*").single();

                const exotelUrl = `https://${exotelSid}.api.exotel.com/v2/messages`;
                const authHeader = "Basic " + btoa(`${exotelApiKey}:${exotelApiToken}`);
                const payload = {
                  from: exotelWaNumber,
                  to: customerRow.phone,
                  type: "template",
                  template: { name: template.name, language: template.language, components: [] },
                };

                try {
                  const exResp = await fetch(exotelUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Authorization": authHeader },
                    body: JSON.stringify(payload),
                  });

                  if (exResp.ok) {
                    const exData = await exResp.json();
                    const pMsgId = exData?.id || exData?.message_id || null;
                    await supabase.from("messages").update({
                      status: "sent",
                      provider_message_id: pMsgId,
                      updated_at: new Date().toISOString(),
                    }).eq("id", pendingMsg?.id);

                    await supabase.from("conversations").update({
                      last_message_preview: template.body.slice(0, 200),
                      last_message_at: new Date().toISOString(),
                      last_activity_at: new Date().toISOString(),
                      whatsapp_window_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                      updated_at: new Date().toISOString(),
                    }).eq("id", conversationId);
                  } else {
                    const errText = await exResp.text();
                    await supabase.from("messages").update({
                      status: "failed",
                      failure_reason: `Exotel error: ${errText}`,
                      updated_at: new Date().toISOString(),
                    }).eq("id", pendingMsg?.id);
                  }
                } catch (fetchErr) {
                  await supabase.from("messages").update({
                    status: "failed",
                    failure_reason: "Network error contacting Exotel",
                    updated_at: new Date().toISOString(),
                  }).eq("id", pendingMsg?.id);
                }
              }
            }
          }
        }
      }
    }

    return jsonResponse({ success: true, callEventId: newCallEvent.id, status: normalizedStatus });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

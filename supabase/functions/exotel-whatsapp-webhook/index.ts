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

// Extract phone number from various Exotel payload shapes
function extractPhone(data: Record<string, unknown>): string | null {
  if (data.from) return String(data.from);
  if (data.From) return String(data.From);
  if (data.sender) return String(data.sender);
  if (data.waNumber) return String(data.waNumber);
  if (data.messages?.[0]?.from) return String((data.messages as Record<string, unknown>[])[0].from);
  if (data.message?.from) return String((data.message as Record<string, unknown>).from);
  return null;
}

// Extract message body/text from various Exotel payload shapes
function extractBody(data: Record<string, unknown>): string | null {
  if (data.body) return String(data.body);
  if (data.Body) return String(data.Body);
  if (data.text) {
    if (typeof data.text === "string") return data.text;
    if (typeof data.text === "object" && data.text !== null) {
      const textObj = data.text as Record<string, unknown>;
      if (textObj.body) return String(textObj.body);
    }
  }
  if (data.messages?.[0]?.text?.body) return String((data.messages as Record<string, unknown>[])  [0]?.text && ((data.messages as Record<string, Record<string, Record<string, unknown>>>[])[0].text.body));
  if (data.message?.text?.body) return String((data.message as Record<string, Record<string, unknown>>).text?.body);
  return null;
}

// Extract provider message ID
function extractProviderMsgId(data: Record<string, unknown>): string | null {
  if (data.id) return String(data.id);
  if (data.messageId) return String(data.messageId);
  if (data.MessageId) return String(data.MessageId);
  if (data.messages?.[0]?.id) return String((data.messages as Record<string, unknown>[])[0].id);
  if (data.message?.id) return String((data.message as Record<string, unknown>).id);
  return null;
}

// Extract customer name if available
function extractName(data: Record<string, unknown>): string | null {
  if (data.name) return String(data.name);
  if (data.Name) return String(data.Name);
  if (data.profileName) return String(data.profileName);
  if (data.messages?.[0]?.profileName) return String((data.messages as Record<string, unknown>[])[0].profileName);
  return null;
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
      // Try JSON anyway
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

    // Handle Exotel status callbacks for outbound messages
    const statusValue = (data.status || data.Status || data.Statuses) as string | undefined;
    const providerMsgId = extractProviderMsgId(data);

    if (statusValue && providerMsgId && !extractPhone(data)) {
      // This is likely a status callback for an outbound message
      const lowerStatus = String(statusValue).toLowerCase();
      const statusMap: Record<string, string> = {
        "sent": "sent",
        "delivered": "delivered",
        "read": "read",
        "failed": "failed",
        "queued": "pending",
      };
      const mappedStatus = statusMap[lowerStatus] || null;

      if (mappedStatus) {
        await supabase.from("messages")
          .update({
            status: mappedStatus,
            failure_reason: mappedStatus === "failed" ? `Exotel status: ${statusValue}` : null,
            updated_at: new Date().toISOString(),
          })
          .eq("provider_message_id", providerMsgId);
        return jsonResponse({ success: true, status: mappedStatus });
      }
    }

    // ===== INBOUND MESSAGE =====
    const phone = extractPhone(data);
    const body = extractBody(data);
    const name = extractName(data);

    if (!phone) {
      return jsonResponse({ error: "Could not determine sender phone from webhook payload" }, 400);
    }

    const providerMessageId = extractProviderMsgId(data);

    // Idempotency: if we have a provider message ID, check for duplicate
    if (providerMessageId) {
      const { data: existing } = await supabase
        .from("messages")
        .select("id")
        .eq("provider_message_id", providerMessageId)
        .maybeSingle();
      if (existing) {
        return jsonResponse({ success: true, message: "Duplicate message ignored", messageId: existing.id });
      }
    }

    // Create or find customer
    const { data: customerId } = await supabase.rpc("upsert_customer_by_phone", {
      p_phone: phone,
      p_name: name,
    });
    if (!customerId) throw new Error("Failed to upsert customer");

    // Create or find conversation (preserves assignment, auto-assigns if new)
    const { data: conversationId } = await supabase.rpc("get_or_create_conversation", {
      p_customer_id: customerId,
    });
    if (!conversationId) throw new Error("Failed to get/create conversation");

    // Store inbound message
    const messageBody = body || "(media or unsupported message type)";
    const { data: msgRow, error: msgErr } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        customer_id: customerId,
        agent_id: null,
        direction: "inbound",
        body: messageBody,
        message_type: "text",
        status: "sent",
        provider_message_id: providerMessageId,
      })
      .select("*")
      .single();
    if (msgErr) throw new Error(`insert inbound message: ${msgErr.message}`);

    // Update conversation: preview, unread, last activity, WhatsApp window
    const now = new Date();
    await supabase.from("conversations").update({
      last_message_preview: messageBody.slice(0, 200),
      last_message_at: now.toISOString(),
      last_activity_at: now.toISOString(),
      unread_count: 1, // Will be incremented — see below
      whatsapp_window_expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      status: "open",
      updated_at: now.toISOString(),
    }).eq("id", conversationId);

    // Increment unread count atomically
    await supabase.rpc("increment_unread", { p_conv_id: conversationId });

    return jsonResponse({ success: true, messageId: msgRow.id, conversationId, customerId });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});

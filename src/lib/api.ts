import { supabase, API_URL } from "@/lib/supabase";
import type { AppSettings } from "@/types/database";

async function getAuthHeader(): Promise<Record<string, string>> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new Error("Your session has expired. Please sign in again.");
  }

  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${data.session.access_token}`,
    "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
  };
}

async function apiCall(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = await getAuthHeader();
  return fetch(`${API_URL}/${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
}

export async function sendWhatsApp(conversationId: string, body: string) {
  const resp = await apiCall("whatsapp/send", {
    method: "POST",
    body: JSON.stringify({ conversationId, body }),
  });
  return resp;
}

export async function initiateCall(conversationId: string) {
  const resp = await apiCall("calls/outbound", {
    method: "POST",
    body: JSON.stringify({ conversationId }),
  });
  return resp;
}

export async function transferConversation(conversationId: string, targetAgentId: string) {
  const resp = await apiCall("conversations/transfer", {
    method: "POST",
    body: JSON.stringify({ conversationId, targetAgentId }),
  });
  return resp;
}

export async function resolveConversation(conversationId: string) {
  const resp = await apiCall("conversations/resolve", {
    method: "POST",
    body: JSON.stringify({ conversationId }),
  });
  return resp;
}

export async function reopenConversation(conversationId: string) {
  const resp = await apiCall("conversations/reopen", {
    method: "POST",
    body: JSON.stringify({ conversationId }),
  });
  return resp;
}

export async function markConversationRead(conversationId: string) {
  const resp = await apiCall("conversations/mark-read", {
    method: "POST",
    body: JSON.stringify({ conversationId }),
  });
  return resp;
}

export async function updatePresence(presence: "online" | "offline" | "away") {
  const resp = await apiCall("agent/presence", {
    method: "POST",
    body: JSON.stringify({ presence }),
  });
  return resp;
}

export async function adminCreateAgent(email: string, displayName: string, phone: string, role: string, password: string) {
  const resp = await apiCall("admin/agents", {
    method: "POST",
    body: JSON.stringify({ email, displayName, phone, role, password }),
  });
  return resp;
}

export async function adminUpdateAgent(agentId: string, updates: Record<string, unknown>) {
  const resp = await apiCall("admin/agents", {
    method: "PUT",
    body: JSON.stringify({ agentId, ...updates }),
  });
  return resp;
}

export async function adminDeactivateAgent(agentId: string) {
  const resp = await apiCall("admin/agents", {
    method: "DELETE",
    body: JSON.stringify({ agentId }),
  });
  return resp;
}

export async function adminCreateTemplate(name: string, body: string, language: string) {
  const resp = await apiCall("admin/templates", {
    method: "POST",
    body: JSON.stringify({ name, body, language }),
  });
  return resp;
}

export async function adminUpdateTemplate(templateId: string, updates: Record<string, unknown>) {
  const resp = await apiCall("admin/templates", {
    method: "PUT",
    body: JSON.stringify({ templateId, ...updates }),
  });
  return resp;
}

export async function adminDeleteTemplate(templateId: string) {
  const resp = await apiCall("admin/templates", {
    method: "DELETE",
    body: JSON.stringify({ templateId }),
  });
  return resp;
}

export async function adminGetSettings() {
  const resp = await apiCall("admin/settings", { method: "GET" });
  return resp;
}

export async function adminUpdateSettings(settings: Partial<AppSettings>) {
  const resp = await apiCall("admin/settings", {
    method: "PUT",
    body: JSON.stringify({ settings }),
  });
  return resp;
}

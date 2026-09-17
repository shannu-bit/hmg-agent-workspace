import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  sendWhatsApp,
  initiateCall,
  transferConversation,
  resolveConversation,
  reopenConversation,
  markConversationRead,
} from "@/lib/api";
import type { Conversation, Customer, Message, CallEvent, Agent } from "@/types/database";
import { formatPhone, formatTime, formatRelative, formatDuration } from "@/lib/format";
import { useAuth } from "@/contexts/AuthContext";
import {
  Phone,
  PhoneCall,
  PhoneOff,
  PhoneIncoming,
  PhoneOutgoing,
  Send,
  Check,
  CheckCheck,
  AlertCircle,
  Loader2,
  UserCog,
  CheckCircle2,
  RotateCcw,
  Clock,
  X,
  ArrowRight,
} from "lucide-react";

interface ConversationDetailProps {
  conversationId: string;
  onBack: () => void;
}

type ConversationWithRelations = Conversation & {
  customer?: Customer;
  assigned_agent?: Agent | null;
};

type CallStatus = "ready" | "calling" | "ringing" | "answered" | "completed" | "failed" | "busy" | "no-answer";

export default function ConversationDetail({ conversationId, onBack }: ConversationDetailProps) {
  const { agent } = useAuth();
  const [conversation, setConversation] = useState<ConversationWithRelations | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [callEvents, setCallEvents] = useState<CallEvent[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [callStatus, setCallStatus] = useState<CallStatus>("ready");
  const [callError, setCallError] = useState<string | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load conversation + messages + call events
  const loadData = useCallback(async () => {
    const [convResp, msgResp, callResp] = await Promise.all([
      supabase
        .from("conversations")
        .select(`
          *,
          customer:customers(*),
          assigned_agent:agents!conversations_assigned_agent_id_fkey(*)
        `)
        .eq("id", conversationId)
        .maybeSingle(),
      supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true }),
      supabase
        .from("call_events")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("started_at", { ascending: true }),
    ]);

    if (convResp.data) setConversation(convResp.data as ConversationWithRelations);
    if (msgResp.data) setMessages(msgResp.data as Message[]);
    if (callResp.data) setCallEvents(callResp.data as CallEvent[]);
  }, [conversationId]);

  // Load agents for transfer
  useEffect(() => {
    supabase
      .from("agents")
      .select("*")
      .eq("is_active", true)
      .order("display_name")
      .then(({ data }) => {
        if (data) setAgents(data as Agent[]);
      });
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Mark as read when opened
  useEffect(() => {
    if (conversation && conversation.unread_count > 0) {
      markConversationRead(conversationId).then(() => {
        setConversation((prev) => prev ? { ...prev, unread_count: 0 } : prev);
      });
    }
  }, [conversationId, conversation?.unread_count]);

  // Realtime subscriptions
  useEffect(() => {
    const channel = supabase
      .channel(`conv_${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          setMessages((prev) => {
            const newMsg = payload.new as Message;
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === (payload.new as Message).id ? (payload.new as Message) : m))
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "call_events",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const callEvent = payload.new as CallEvent;
          setCallEvents((prev) => {
            const existing = prev.find((c) => c.id === callEvent.id);
            if (existing) {
              return prev.map((c) => (c.id === callEvent.id ? callEvent : c));
            }
            return [...prev, callEvent];
          });
          // Update call status UI
          const statusMap: Record<string, CallStatus> = {
            initiated: "calling",
            ringing: "ringing",
            answered: "answered",
            completed: "completed",
            failed: "failed",
            busy: "busy",
            "no-answer": "no-answer",
            cancelled: "failed",
          };
          if (callEvent.agent_id === agent?.id || payload.eventType === "INSERT") {
            setCallStatus(statusMap[callEvent.status] || "ready");
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          filter: `id=eq.${conversationId}`,
        },
        (payload) => {
          const updated = payload.new as Conversation;
          setConversation((prev) => {
            if (!prev) return prev;
            return { ...prev, ...updated };
          });
          // Reload to get relations
          loadData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, agent?.id, loadData]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Reset call status after a delay when completed/failed
  useEffect(() => {
    if (["completed", "failed", "busy", "no-answer"].includes(callStatus)) {
      const timer = setTimeout(() => setCallStatus("ready"), 5000);
      return () => clearTimeout(timer);
    }
  }, [callStatus]);

  async function handleSend() {
    if (!messageText.trim() || sending) return;
    setSending(true);
    setSendError(null);

    try {
      const resp = await sendWhatsApp(conversationId, messageText.trim());
      const data = await resp.json();

      if (!resp.ok) {
        setSendError(data.error || "Failed to send message");
      } else {
        setMessageText("");
      }
    } catch {
      setSendError("Network error sending message");
    } finally {
      setSending(false);
    }
  }

  async function handleCall() {
    if (callStatus !== "ready" || !agent) return;
    setCallStatus("calling");
    setCallError(null);

    try {
      const resp = await initiateCall(conversationId);
      const data = await resp.json();

      if (!resp.ok) {
        setCallError(data.error || "Failed to initiate call");
        setCallStatus("failed");
      }
    } catch {
      setCallError("Network error initiating call");
      setCallStatus("failed");
    }
  }

  async function handleTransfer(targetAgentId: string) {
    setTransferring(true);
    try {
      await transferConversation(conversationId, targetAgentId);
      setShowTransfer(false);
      loadData();
    } catch {
      // error
    } finally {
      setTransferring(false);
    }
  }

  async function handleResolve() {
    if (conversation?.status === "resolved") {
      await reopenConversation(conversationId);
    } else {
      await resolveConversation(conversationId);
    }
    loadData();
  }

  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const customer = conversation.customer;
  const isResolved = conversation.status === "resolved";
  const windowExpiry = conversation.whatsapp_window_expires_at ? new Date(conversation.whatsapp_window_expires_at) : null;
  const withinWindow = windowExpiry ? windowExpiry > new Date() : false;
  const callButtonLabel =
    callStatus === "ready" ? "Call Guest" :
    callStatus === "calling" ? "Calling..." :
    callStatus === "ringing" ? "Ringing..." :
    callStatus === "answered" ? "Connected" :
    callStatus === "completed" ? "Completed" :
    callStatus === "failed" ? "Failed" :
    callStatus === "busy" ? "Busy" :
    callStatus === "no-answer" ? "No Answer" : "Call Guest";

  const callButtonColor =
    callStatus === "ready" ? "from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500" :
    callStatus === "calling" || callStatus === "ringing" ? "from-amber-500 to-orange-600" :
    callStatus === "answered" ? "from-green-500 to-emerald-600" :
    callStatus === "completed" ? "from-slate-600 to-slate-700" :
    "from-red-500 to-red-600";

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950">
      {/* Header */}
      <div className="h-16 border-b border-slate-800 flex items-center gap-3 px-4 shrink-0 bg-slate-900/50">
        <button
          onClick={onBack}
          className="md:hidden text-slate-400 hover:text-white transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-white font-semibold truncate">
              {customer?.name || formatPhone(customer?.phone || "Unknown")}
            </h2>
            {isResolved && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                <CheckCircle2 className="w-3 h-3" />
                Resolved
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 truncate">
            {customer?.phone && formatPhone(customer.phone)}
            {conversation.assigned_agent && ` · ${conversation.assigned_agent.display_name}`}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {/* Call button */}
          <button
            onClick={handleCall}
            disabled={callStatus !== "ready" && callStatus !== "failed" && callStatus !== "busy" && callStatus !== "no-answer" && callStatus !== "completed"}
            className={`flex items-center gap-2 bg-gradient-to-r ${callButtonColor} text-white text-sm font-medium rounded-lg px-3 py-2 transition shadow-lg disabled:opacity-60 disabled:cursor-not-allowed`}
          >
            {callStatus === "calling" || callStatus === "ringing" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : callStatus === "answered" ? (
              <PhoneCall className="w-4 h-4" />
            ) : callStatus === "completed" ? (
              <Check className="w-4 h-4" />
            ) : callStatus === "failed" || callStatus === "busy" || callStatus === "no-answer" ? (
              <PhoneOff className="w-4 h-4" />
            ) : (
              <Phone className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">{callButtonLabel}</span>
          </button>

          {/* Transfer button */}
          <button
            onClick={() => setShowTransfer(true)}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-lg px-3 py-2 transition"
            title="Transfer conversation"
          >
            <UserCog className="w-4 h-4" />
            <span className="hidden sm:inline">Transfer</span>
          </button>

          {/* Resolve button */}
          <button
            onClick={handleResolve}
            className={`flex items-center gap-2 text-sm font-medium rounded-lg px-3 py-2 transition ${
              isResolved
                ? "bg-slate-800 hover:bg-slate-700 text-slate-300"
                : "bg-slate-800 hover:bg-emerald-500/10 text-slate-300 hover:text-emerald-400"
            }`}
          >
            {isResolved ? (
              <>
                <RotateCcw className="w-4 h-4" />
                <span className="hidden sm:inline">Reopen</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span className="hidden sm:inline">Resolve</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Call status banner */}
      {callError && (
        <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 text-sm text-red-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {callError}
        </div>
      )}
      {(callStatus === "calling" || callStatus === "ringing" || callStatus === "answered") && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-sm text-amber-400 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          {callStatus === "calling" ? "Initiating call through Exotel..." : callStatus === "ringing" ? "Ringing..." : "Call connected"}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.length === 0 && callEvents.length === 0 && (
          <div className="text-center text-slate-500 text-sm py-12">
            No messages yet. When the customer sends a WhatsApp message, it will appear here.
          </div>
        )}

        {/* Call events inline */}
        {callEvents.map((call) => (
          <div key={`call-${call.id}`} className="flex justify-center my-3">
            <div className={`flex items-center gap-2 text-xs rounded-full px-3 py-1.5 ${
              call.status === "completed" ? "bg-slate-800 text-slate-400" :
              call.status === "failed" || call.status === "busy" || call.status === "no-answer" ? "bg-red-500/10 text-red-400" :
              call.status === "answered" ? "bg-emerald-500/10 text-emerald-400" :
              "bg-amber-500/10 text-amber-400"
            }`}>
              {call.direction === "inbound" ? <PhoneIncoming className="w-3 h-3" /> : <PhoneOutgoing className="w-3 h-3" />}
              <span>
                {call.direction === "inbound" ? "Incoming" : "Outgoing"} call · {call.status}
                {call.duration_seconds ? ` · ${formatDuration(call.duration_seconds)}` : ""}
              </span>
              <span className="text-slate-600">· {formatTime(call.started_at)}</span>
            </div>
          </div>
        ))}

        {/* Messages */}
        {messages.map((msg) => {
          const isOutbound = msg.direction === "outbound";
          return (
            <div
              key={msg.id}
              className={`flex ${isOutbound ? "justify-end" : "justify-start"} mb-2`}
            >
              <div className={`max-w-[75%] ${isOutbound ? "items-end" : "items-start"} flex flex-col`}>
                <div
                  className={`rounded-2xl px-4 py-2.5 text-sm break-words ${
                    isOutbound
                      ? msg.status === "failed"
                        ? "bg-red-500/20 text-red-100 border border-red-500/30"
                        : msg.status === "pending"
                        ? "bg-slate-700 text-slate-300"
                        : "bg-emerald-600 text-white"
                      : "bg-slate-800 text-slate-100"
                  }`}
                >
                  {msg.body}
                  {msg.message_type === "template" && (
                    <div className="text-xs opacity-60 mt-1">Template message</div>
                  )}
                </div>
                <div className={`flex items-center gap-1 mt-1 text-xs ${isOutbound ? "text-slate-500" : "text-slate-600"}`}>
                  <span>{formatTime(msg.created_at)}</span>
                  {isOutbound && (
                    <>
                      {msg.status === "pending" && <Clock className="w-3 h-3" />}
                      {msg.status === "sent" && <Check className="w-3 h-3" />}
                      {msg.status === "delivered" && <CheckCheck className="w-3 h-3" />}
                      {msg.status === "read" && <CheckCheck className="w-3 h-3 text-emerald-400" />}
                      {msg.status === "failed" && (
                        <span className="text-red-400 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          {msg.failure_reason ? "Failed" : "Failed"}
                        </span>
                      )}
                    </>
                  )}
                </div>
                {isOutbound && msg.status === "failed" && msg.failure_reason && (
                  <div className="text-xs text-red-400 mt-0.5 max-w-xs">{msg.failure_reason}</div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-slate-800 p-3 shrink-0 bg-slate-900/50">
        {!withinWindow && (
          <div className="mb-2 text-xs text-amber-400/80 bg-amber-500/10 rounded-lg px-3 py-1.5 flex items-center gap-2">
            <Clock className="w-3 h-3" />
            Outside 24h window — a template will be sent instead of your message.
          </div>
        )}
        {sendError && (
          <div className="mb-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-1.5 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {sendError}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            rows={1}
            placeholder="Type a message..."
            className="flex-1 bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/30 transition resize-none max-h-32"
            style={{ minHeight: "42px" }}
          />
          <button
            onClick={handleSend}
            disabled={!messageText.trim() || sending}
            className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white rounded-xl p-2.5 transition shadow-lg disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Transfer modal */}
      {showTransfer && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setShowTransfer(false)}
        >
          <div
            className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">Transfer Conversation</h3>
              <button onClick={() => setShowTransfer(false)} className="text-slate-500 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-400 mb-4">
              Select an agent to transfer this conversation to. The current agent will no longer have access to reply.
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {agents.filter((a) => a.id !== agent?.id).map((a) => (
                <button
                  key={a.id}
                  onClick={() => handleTransfer(a.id)}
                  disabled={transferring}
                  className="w-full flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition text-left disabled:opacity-50"
                >
                  <div className="w-9 h-9 bg-slate-700 rounded-full flex items-center justify-center shrink-0">
                    <span className="text-sm font-semibold text-slate-300">
                      {a.display_name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{a.display_name}</div>
                    <div className="text-xs text-slate-500 flex items-center gap-1.5">
                      <span className={`inline-flex items-center gap-1 ${
                        a.presence === "online" ? "text-emerald-400" : "text-slate-500"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          a.presence === "online" ? "bg-emerald-400" : "bg-slate-600"
                        }`} />
                        {a.presence}
                      </span>
                      {a.role === "admin" && <span className="text-slate-600">· Admin</span>}
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-600" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

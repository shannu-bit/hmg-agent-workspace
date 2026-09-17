import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import type { Conversation, Customer, Agent } from "@/types/database";
import { formatRelative } from "@/lib/format";
import { Search, Inbox, Phone, CheckCheck } from "lucide-react";

interface ConversationListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: "all" | "open" | "resolved" | "mine";
  onFilterChange: (f: "all" | "open" | "resolved" | "mine") => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}

type ConversationWithRelations = Conversation & {
  customer?: Customer;
  assigned_agent?: Agent | null;
};

export default function ConversationList({
  selectedId,
  onSelect,
  filter,
  onFilterChange,
  searchQuery,
  onSearchChange,
}: ConversationListProps) {
  const { agent } = useAuth();
  const [conversations, setConversations] = useState<ConversationWithRelations[]>([]);
  const [loading, setLoading] = useState(true);

  const loadConversations = useCallback(async () => {
    let query = supabase
      .from("conversations")
      .select(`
        *,
        customer:customers(*),
        assigned_agent:agents!conversations_assigned_agent_id_fkey(*)
      `)
      .order("last_activity_at", { ascending: false })
      .limit(100);

    if (filter === "open") {
      query = query.eq("status", "open");
    } else if (filter === "resolved") {
      query = query.eq("status", "resolved");
    } else if (filter === "mine" && agent) {
      query = query.eq("assigned_agent_id", agent.id);
    }

    const { data, error } = await query;
    if (error) {
      console.error("Error loading conversations:", error);
      return;
    }
    setConversations((data || []) as ConversationWithRelations[]);
    setLoading(false);
  }, [filter, agent]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Realtime: listen for conversation changes
  useEffect(() => {
    const channel = supabase
      .channel("conversations_list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        () => {
          loadConversations();
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => {
          loadConversations();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadConversations]);

  // Also reload when agent changes (for "mine" filter)
  useEffect(() => {
    if (agent) loadConversations();
  }, [agent, loadConversations]);

  const filtered = searchQuery
    ? conversations.filter((c) => {
        const name = c.customer?.name?.toLowerCase() || "";
        const phone = c.customer?.phone || "";
        const preview = c.last_message_preview?.toLowerCase() || "";
        const q = searchQuery.toLowerCase();
        return name.includes(q) || phone.includes(q) || preview.includes(q);
      })
    : conversations;

  const filters: { key: typeof filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "open", label: "Open" },
    { key: "mine", label: "Mine" },
    { key: "resolved", label: "Resolved" },
  ];

  return (
    <div className="w-full md:w-80 lg:w-96 bg-slate-900/50 border-r border-slate-800 flex flex-col h-full">
      {/* Search */}
      <div className="p-3 border-b border-slate-800 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search conversations..."
            className="w-full bg-slate-800/50 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/30 transition"
          />
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mt-2">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => onFilterChange(f.key)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                filter === f.key
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "text-slate-500 hover:text-slate-300 hover:bg-slate-800"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-slate-500 text-sm">Loading conversations...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center">
            <Inbox className="w-10 h-10 text-slate-700 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">No conversations found</p>
          </div>
        ) : (
          filtered.map((conv) => {
            const isSelected = conv.id === selectedId;
            const hasUnread = conv.unread_count > 0;
            const isResolved = conv.status === "resolved";
            const windowExpiry = conv.whatsapp_window_expires_at ? new Date(conv.whatsapp_window_expires_at) : null;
            const withinWindow = windowExpiry ? windowExpiry > new Date() : false;

            return (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={`w-full text-left p-3 border-b border-slate-800/50 transition relative ${
                  isSelected ? "bg-emerald-500/10" : "hover:bg-slate-800/30"
                }`}
              >
                {isSelected && (
                  <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-emerald-500" />
                )}
                <div className="flex items-start gap-2.5">
                  {/* Avatar */}
                  <div className="w-10 h-10 bg-slate-700 rounded-full flex items-center justify-center shrink-0 relative">
                    <span className="text-sm font-semibold text-slate-300">
                      {(conv.customer?.name || conv.customer?.phone || "?").charAt(0).toUpperCase()}
                    </span>
                    {hasUnread && (
                      <span className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                        {conv.unread_count > 9 ? "9+" : conv.unread_count}
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-sm truncate ${hasUnread ? "font-semibold text-white" : "font-medium text-slate-300"}`}>
                        {conv.customer?.name || conv.customer?.phone || "Unknown"}
                      </span>
                      <span className="text-xs text-slate-500 shrink-0">
                        {conv.last_message_at ? formatRelative(conv.last_message_at) : ""}
                      </span>
                    </div>
                    <p className={`text-xs truncate mt-0.5 ${hasUnread ? "text-slate-300" : "text-slate-500"}`}>
                      {conv.last_message_preview || "No messages yet"}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      {isResolved && (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                          <CheckCheck className="w-3 h-3" />
                          Resolved
                        </span>
                      )}
                      {!isResolved && !withinWindow && (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-500/70">
                          <Phone className="w-3 h-3" />
                          24h expired
                        </span>
                      )}
                      {conv.assigned_agent && (
                        <span className="text-xs text-slate-600 truncate">
                          {conv.assigned_agent.display_name}
                        </span>
                      )}
                      {!conv.assigned_agent && !isResolved && (
                        <span className="text-xs text-slate-600">Unassigned</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}


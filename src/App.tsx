import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import LoginScreen from "@/components/LoginScreen";
import Sidebar from "@/components/Sidebar";
import ConversationList from "@/components/ConversationList";
import ConversationDetail from "@/components/ConversationDetail";
import AdminPanel from "@/components/AdminPanel";
import { updatePresence } from "@/lib/api";
import { Loader2 } from "lucide-react";

type View = "inbox" | "admin";

function Workspace() {
  const { agent, loading } = useAuth();
  const [view, setView] = useState<View>("inbox");
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "resolved" | "mine">("open");
  const [searchQuery, setSearchQuery] = useState("");
  const [unreadTotal, setUnreadTotal] = useState(0);

  // Track total unread for sidebar badge
  useEffect(() => {
    if (!agent) return;

    async function loadUnread() {
      const { count } = await supabase
        .from("conversations")
        .select("*", { count: "exact", head: true })
        .gt("unread_count", 0)
        .eq("status", "open");
      setUnreadTotal(count || 0);
    }

    loadUnread();

    const channel = supabase
      .channel("unread_tracker")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        () => loadUnread()
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => loadUnread()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [agent]);

  // Set agent online on login, offline on logout
  useEffect(() => {
    if (agent && agent.presence === "offline") {
      updatePresence("online");
    }
  }, [agent?.id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  if (!agent) {
    return <LoginScreen />;
  }

  return (
    <div className="h-screen flex bg-slate-950 overflow-hidden">
      <Sidebar
        currentView={view}
        onViewChange={(v) => {
          setView(v);
          if (v !== "inbox") setSelectedConversationId(null);
        }}
        unreadTotal={unreadTotal}
      />

      {view === "inbox" ? (
        <div className="flex-1 flex overflow-hidden">
          {/* Conversation list - hidden on mobile when a conversation is selected */}
          <div className={`${selectedConversationId ? "hidden md:flex" : "flex"} flex-col`}>
            <ConversationList
              selectedId={selectedConversationId}
              onSelect={setSelectedConversationId}
              filter={filter}
              onFilterChange={setFilter}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
            />
          </div>

          {/* Conversation detail */}
          {selectedConversationId ? (
            <ConversationDetail
              key={selectedConversationId}
              conversationId={selectedConversationId}
              onBack={() => setSelectedConversationId(null)}
            />
          ) : (
            <div className="hidden md:flex flex-1 items-center justify-center bg-slate-950">
              <div className="text-center">
                <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Loader2 className="w-8 h-8 text-slate-600" />
                </div>
                <p className="text-slate-500 text-sm">Select a conversation to view messages</p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <AdminPanel />
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Workspace />
    </AuthProvider>
  );
}

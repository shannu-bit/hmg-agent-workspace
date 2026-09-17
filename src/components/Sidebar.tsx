import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { updatePresence } from "@/lib/api";
import {
  MessageSquare,
  Settings,
  LogOut,
  Circle,
  Users,
  Phone,
  Headphones,
} from "lucide-react";

type View = "inbox" | "admin";

interface SidebarProps {
  currentView: View;
  onViewChange: (view: View) => void;
  unreadTotal: number;
}

export default function Sidebar({ currentView, onViewChange, unreadTotal }: SidebarProps) {
  const { agent, signOut, refreshAgent } = useAuth();
  const [presenceLoading, setPresenceLoading] = useState(false);

  if (!agent) return null;

  async function handlePresenceChange(p: "online" | "offline" | "away") {
    if (!agent || agent.presence === p) return;
    setPresenceLoading(true);
    await updatePresence(p);
    await refreshAgent();
    setPresenceLoading(false);
  }

  const presenceColor =
    agent.presence === "online" ? "text-emerald-400" :
    agent.presence === "away" ? "text-amber-400" : "text-slate-500";

  const presenceBg =
    agent.presence === "online" ? "bg-emerald-400" :
    agent.presence === "away" ? "bg-amber-400" : "bg-slate-500";

  return (
    <div className="w-16 lg:w-64 bg-slate-900 border-r border-slate-800 flex flex-col h-full transition-all">
      {/* Logo */}
      <div className="h-16 flex items-center gap-3 px-4 border-b border-slate-800 shrink-0">
        <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/20">
          <MessageSquare className="w-5 h-5 text-white" />
        </div>
        <div className="hidden lg:block overflow-hidden">
          <div className="text-white font-bold text-sm tracking-tight whitespace-nowrap">HostMyGuest</div>
          <div className="text-slate-500 text-xs whitespace-nowrap">Agent Workspace</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 lg:p-3 space-y-1">
        <button
          onClick={() => onViewChange("inbox")}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition text-sm font-medium relative ${
            currentView === "inbox"
              ? "bg-emerald-500/10 text-emerald-400"
              : "text-slate-400 hover:text-white hover:bg-slate-800"
          }`}
        >
          <Headphones className="w-5 h-5 shrink-0" />
          <span className="hidden lg:inline">Inbox</span>
          {unreadTotal > 0 && (
            <span className="ml-auto hidden lg:flex bg-emerald-500 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[20px] justify-center">
              {unreadTotal > 99 ? "99+" : unreadTotal}
            </span>
          )}
          {unreadTotal > 0 && (
            <span className="lg:hidden absolute top-1 right-1 w-2 h-2 bg-emerald-500 rounded-full" />
          )}
        </button>

        {agent.role === "admin" && (
          <button
            onClick={() => onViewChange("admin")}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition text-sm font-medium ${
              currentView === "admin"
                ? "bg-emerald-500/10 text-emerald-400"
                : "text-slate-400 hover:text-white hover:bg-slate-800"
            }`}
          >
            <Settings className="w-5 h-5 shrink-0" />
            <span className="hidden lg:inline">Admin</span>
          </button>
        )}
      </nav>

      {/* Presence + User */}
      <div className="p-2 lg:p-3 border-t border-slate-800 space-y-2 shrink-0">
        {/* Presence toggle */}
        <div className="hidden lg:block">
          <div className="flex items-center gap-1 bg-slate-800/50 rounded-lg p-1">
            <button
              onClick={() => handlePresenceChange("online")}
              disabled={presenceLoading}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition ${
                agent.presence === "online" ? "bg-emerald-500/20 text-emerald-400" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Circle className="w-2 h-2 fill-current" />
              Online
            </button>
            <button
              onClick={() => handlePresenceChange("away")}
              disabled={presenceLoading}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition ${
                agent.presence === "away" ? "bg-amber-500/20 text-amber-400" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Circle className="w-2 h-2 fill-current" />
              Away
            </button>
            <button
              onClick={() => handlePresenceChange("offline")}
              disabled={presenceLoading}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition ${
                agent.presence === "offline" ? "bg-slate-700 text-slate-300" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Circle className="w-2 h-2 fill-current" />
              Off
            </button>
          </div>
        </div>

        {/* Mobile presence dot */}
        <div className="lg:hidden flex justify-center">
          <button
            onClick={() => {
              const next = agent.presence === "online" ? "offline" : "online";
              handlePresenceChange(next);
            }}
            disabled={presenceLoading}
            className="p-2"
          >
            <Circle className={`w-3 h-3 ${presenceBg} ${presenceColor} fill-current`} />
          </button>
        </div>

        {/* User info */}
        <div className="flex items-center gap-2.5 px-2 lg:px-1">
          <div className="w-8 h-8 bg-slate-700 rounded-full flex items-center justify-center shrink-0">
            <Users className="w-4 h-4 text-slate-400" />
          </div>
          <div className="hidden lg:block flex-1 min-w-0">
            <div className="text-sm font-medium text-white truncate">{agent.display_name}</div>
            <div className="text-xs text-slate-500 truncate">
              {agent.role === "admin" ? "Administrator" : "Agent"}
            </div>
          </div>
          <button
            onClick={signOut}
            className="text-slate-500 hover:text-red-400 transition p-1.5 shrink-0"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

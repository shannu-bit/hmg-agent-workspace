import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  adminCreateAgent,
  adminUpdateAgent,
  adminDeactivateAgent,
  adminCreateTemplate,
  adminUpdateTemplate,
  adminDeleteTemplate,
  adminGetSettings,
  adminUpdateSettings,
} from "@/lib/api";
import type { Agent, WhatsappTemplate } from "@/types/database";
import { useAuth } from "@/contexts/AuthContext";
import {
  Users,
  FileText,
  Settings,
  Plus,
  X,
  Trash2,
  Edit2,
  Check,
  Loader2,
  Phone,
  Circle,
  Save,
} from "lucide-react";

type Tab = "agents" | "templates" | "settings";

export default function AdminPanel() {
  const [tab, setTab] = useState<Tab>("agents");

  const tabs: { key: Tab; label: string; icon: typeof Users }[] = [
    { key: "agents", label: "Agents", icon: Users },
    { key: "templates", label: "Templates", icon: FileText },
    { key: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 overflow-hidden">
      {/* Header */}
      <div className="h-16 border-b border-slate-800 flex items-center px-6 shrink-0 bg-slate-900/50">
        <h2 className="text-white font-semibold text-lg">Admin Panel</h2>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-800 px-6 shrink-0">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${
                tab === t.key
                  ? "border-emerald-500 text-emerald-400"
                  : "border-transparent text-slate-400 hover:text-white"
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === "agents" && <AgentsTab />}
        {tab === "templates" && <TemplatesTab />}
        {tab === "settings" && <SettingsTab />}
      </div>
    </div>
  );
}

// ============================================================
// AGENTS TAB
// ============================================================
function AgentsTab() {
  const { agent: currentAgent, refreshAgent } = useAuth();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ display_name: "", phone: "", role: "agent" });

  // Add form
  const [addForm, setAddForm] = useState({ email: "", displayName: "", phone: "", role: "agent", password: "" });
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function loadAgents() {
    const { data } = await supabase.from("agents").select("*").order("created_at", { ascending: true });
    setAgents((data || []) as Agent[]);
    setLoading(false);
  }

  useEffect(() => {
    loadAgents();

    // Realtime for agents
    const channel = supabase
      .channel("admin_agents")
      .on("postgres_changes", { event: "*", schema: "public", table: "agents" }, () => {
        loadAgents();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function handleAddAgent() {
    setAddLoading(true);
    setAddError(null);
    try {
      const resp = await adminCreateAgent(addForm.email, addForm.displayName, addForm.phone, addForm.role, addForm.password);
      const data = await resp.json();
      if (!resp.ok) {
        setAddError(data.error || "Failed to create agent");
      } else {
        setShowAdd(false);
        setAddForm({ email: "", displayName: "", phone: "", role: "agent", password: "" });
        loadAgents();
      }
    } catch {
      setAddError("Network error");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleSaveEdit(agentId: string) {
    await adminUpdateAgent(agentId, editForm);
    setEditingId(null);
    loadAgents();
    if (agentId === currentAgent?.id) refreshAgent();
  }

  async function handleDeactivate(agentId: string) {
    if (!confirm("Deactivate this agent? They will no longer be able to sign in.")) return;
    await adminDeactivateAgent(agentId);
    loadAgents();
  }

  if (loading) {
    return <div className="text-center text-slate-500 py-12"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-white font-semibold">Team Agents</h3>
          <p className="text-sm text-slate-500 mt-0.5">Manage agent accounts and their access</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white text-sm font-medium rounded-lg px-4 py-2 transition shadow-lg"
        >
          <Plus className="w-4 h-4" />
          Add Agent
        </button>
      </div>

      <div className="space-y-2">
        {agents.map((a) => (
          <div
            key={a.id}
            className={`bg-slate-900/50 border border-slate-800 rounded-xl p-4 ${!a.is_active ? "opacity-50" : ""}`}
          >
            {editingId === a.id ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Name</label>
                    <input
                      value={editForm.display_name}
                      onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Phone</label>
                    <input
                      value={editForm.phone}
                      onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                      placeholder="+91..."
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Role</label>
                    <select
                      value={editForm.role}
                      onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    >
                      <option value="agent">Agent</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSaveEdit(a.id)}
                    className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-medium rounded-lg px-3 py-1.5 transition"
                  >
                    <Check className="w-4 h-4" />
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="text-slate-400 hover:text-white text-sm font-medium rounded-lg px-3 py-1.5 transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-slate-700 rounded-full flex items-center justify-center shrink-0">
                  <span className="text-sm font-semibold text-slate-300">
                    {a.display_name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{a.display_name}</span>
                    {a.role === "admin" && (
                      <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">Admin</span>
                    )}
                    {!a.is_active && (
                      <span className="text-xs text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">Inactive</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                    <span className={`flex items-center gap-1 ${
                      a.presence === "online" ? "text-emerald-400" : a.presence === "away" ? "text-amber-400" : "text-slate-500"
                    }`}>
                      <Circle className={`w-2 h-2 fill-current ${a.presence}`} />
                      {a.presence}
                    </span>
                    {a.phone && (
                      <span className="flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {a.phone}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setEditingId(a.id);
                      setEditForm({ display_name: a.display_name, phone: a.phone || "", role: a.role });
                    }}
                    className="text-slate-500 hover:text-emerald-400 transition p-2"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  {a.id !== currentAgent?.id && a.is_active && (
                    <button
                      onClick={() => handleDeactivate(a.id)}
                      className="text-slate-500 hover:text-red-400 transition p-2"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add Agent Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">Add New Agent</h3>
              <button onClick={() => setShowAdd(false)} className="text-slate-500 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Email</label>
                <input
                  type="email"
                  value={addForm.email}
                  onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  placeholder="agent@hostmyguest.com"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Display Name</label>
                <input
                  value={addForm.displayName}
                  onChange={(e) => setAddForm({ ...addForm, displayName: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  placeholder="John Doe"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Phone (for calling)</label>
                <input
                  value={addForm.phone}
                  onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  placeholder="+91XXXXXXXXXX"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Role</label>
                  <select
                    value={addForm.role}
                    onChange={(e) => setAddForm({ ...addForm, role: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  >
                    <option value="agent">Agent</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Password</label>
                  <input
                    type="password"
                    value={addForm.password}
                    onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    placeholder="Set initial password"
                  />
                </div>
              </div>
              {addError && (
                <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{addError}</div>
              )}
              <button
                onClick={handleAddAgent}
                disabled={addLoading || !addForm.email || !addForm.displayName || !addForm.password}
                className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-medium rounded-lg py-2.5 transition shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {addLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create Agent
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// TEMPLATES TAB
// ============================================================
function TemplatesTab() {
  const [templates, setTemplates] = useState<WhatsappTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", body: "", language: "en" });
  const [addLoading, setAddLoading] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", body: "", language: "en", is_active: true });

  async function loadTemplates() {
    const { data } = await supabase.from("whatsapp_templates").select("*").order("created_at", { ascending: true });
    setTemplates((data || []) as WhatsappTemplate[]);
    setLoading(false);
  }

  useEffect(() => {
    loadTemplates();
    const channel = supabase
      .channel("admin_templates")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_templates" }, () => {
        loadTemplates();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function handleAdd() {
    setAddLoading(true);
    try {
      await adminCreateTemplate(addForm.name, addForm.body, addForm.language);
      setShowAdd(false);
      setAddForm({ name: "", body: "", language: "en" });
      loadTemplates();
    } finally {
      setAddLoading(false);
    }
  }

  async function handleSaveEdit(id: string) {
    await adminUpdateTemplate(id, editForm);
    setEditId(null);
    loadTemplates();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this template?")) return;
    await adminDeleteTemplate(id);
    loadTemplates();
  }

  if (loading) {
    return <div className="text-center text-slate-500 py-12"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-white font-semibold">WhatsApp Templates</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            Approved templates for messaging outside the 24-hour customer service window
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white text-sm font-medium rounded-lg px-4 py-2 transition shadow-lg"
        >
          <Plus className="w-4 h-4" />
          Add Template
        </button>
      </div>

      <div className="space-y-3">
        {templates.map((t) => (
          <div key={t.id} className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            {editId === t.id ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Name</label>
                    <input
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Language</label>
                    <input
                      value={editForm.language}
                      onChange={(e) => setEditForm({ ...editForm, language: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Body</label>
                  <textarea
                    value={editForm.body}
                    onChange={(e) => setEditForm({ ...editForm, body: e.target.value })}
                    rows={3}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 resize-none"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={editForm.is_active}
                    onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })}
                    className="rounded"
                  />
                  Active
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSaveEdit(t.id)}
                    className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-medium rounded-lg px-3 py-1.5 transition"
                  >
                    <Check className="w-4 h-4" />
                    Save
                  </button>
                  <button
                    onClick={() => setEditId(null)}
                    className="text-slate-400 hover:text-white text-sm font-medium rounded-lg px-3 py-1.5 transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{t.name}</span>
                    <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">{t.language}</span>
                    {t.is_active ? (
                      <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">Active</span>
                    ) : (
                      <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded">Inactive</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setEditId(t.id);
                        setEditForm({ name: t.name, body: t.body, language: t.language, is_active: t.is_active });
                      }}
                      className="text-slate-500 hover:text-emerald-400 transition p-1.5"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(t.id)}
                      className="text-slate-500 hover:text-red-400 transition p-1.5"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-slate-400">{t.body}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">Add Template</h3>
              <button onClick={() => setShowAdd(false)} className="text-slate-500 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Template Name</label>
                <input
                  value={addForm.name}
                  onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  placeholder="first_response"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Language</label>
                <input
                  value={addForm.language}
                  onChange={(e) => setAddForm({ ...addForm, language: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  placeholder="en"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Message Body</label>
                <textarea
                  value={addForm.body}
                  onChange={(e) => setAddForm({ ...addForm, body: e.target.value })}
                  rows={4}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 resize-none"
                  placeholder="Hello, thank you for contacting us..."
                />
              </div>
              <button
                onClick={handleAdd}
                disabled={addLoading || !addForm.name || !addForm.body}
                className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-medium rounded-lg py-2.5 transition shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {addLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create Template
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// SETTINGS TAB
// ============================================================
function SettingsTab() {
  const [settings, setSettings] = useState<Record<string, boolean | string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  async function loadSettings() {
    setLoading(true);
    setError(null);
    try {
      const resp = await adminGetSettings();
      const data = await resp.json();
      if (!resp.ok || !data.settings) {
        throw new Error(data.error || "Unable to load settings");
      }
      setSettings(data.settings);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load settings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  // Initialize form values from settings
  useEffect(() => {
    const values: Record<string, string> = {};
    for (const [k, v] of Object.entries(settings)) {
      if (typeof v === "string") values[k] = v;
      else if (typeof v === "boolean") values[k] = v ? "(set)" : "";
    }
    setFormValues(values);
  }, [settings]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    // Only send non-secret values that changed; for secrets, send the new value if not "(set)"
    const toSave: Record<string, string> = {};
    for (const [k, v] of Object.entries(formValues)) {
      if (v && v !== "(set)") {
        toSave[k] = v;
      }
    }
    await adminUpdateSettings(toSave);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    loadSettings();
  }

  if (loading) {
    return <div className="text-center text-slate-500 py-12"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;
  }

  if (error) {
    return (
      <div className="max-w-2xl bg-red-500/10 border border-red-500/20 rounded-xl p-5">
        <p className="text-sm text-red-400">{error}</p>
        <button onClick={loadSettings} className="mt-4 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 transition">
          Try again
        </button>
      </div>
    );
  }

  const fields: { key: string; label: string; isSecret: boolean; placeholder: string }[] = [
    { key: "exotel_sid", label: "Exotel SID", isSecret: false, placeholder: "your-exotel-sid" },
    { key: "exotel_api_key", label: "Exotel API Key", isSecret: true, placeholder: "Enter API key" },
    { key: "exotel_api_token", label: "Exotel API Token", isSecret: true, placeholder: "Enter API token" },
    { key: "exotel_whatsapp_number", label: "WhatsApp Sender Number", isSecret: false, placeholder: "+91XXXXXXXXXX" },
    { key: "exotel_caller_id", label: "Caller ID (Virtual Number)", isSecret: false, placeholder: "0XXXXXXXXXX" },
    { key: "exotel_app_id", label: "Exotel App ID", isSecret: false, placeholder: "optional" },
  ];

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h3 className="text-white font-semibold">Exotel Integration Settings</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          Configure your Exotel credentials for WhatsApp messaging and calling
        </p>
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 space-y-4">
        {fields.map((f) => {
          const currentValue = settings[f.key];
          const isSet = typeof currentValue === "boolean" ? currentValue : !!currentValue;
          return (
            <div key={f.key}>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                {f.label}
                {f.isSecret && isSet && (
                  <span className="ml-2 text-xs text-emerald-400">configured</span>
                )}
              </label>
              <input
                type={f.isSecret ? "password" : "text"}
                value={formValues[f.key] || ""}
                onChange={(e) => setFormValues({ ...formValues, [f.key]: e.target.value })}
                placeholder={f.isSecret && isSet ? "(set — enter new to change)" : f.placeholder}
                className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/30 transition"
              />
            </div>
          );
        })}

        <div className="pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-medium rounded-lg px-4 py-2.5 transition shadow-lg disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saving ? "Saving..." : saved ? "Saved!" : "Save Settings"}
          </button>
        </div>
      </div>

      {/* Webhook URLs info */}
      <div className="mt-6 bg-slate-900/30 border border-slate-800 rounded-xl p-5">
        <h4 className="text-sm font-medium text-slate-300 mb-3">Webhook URLs</h4>
        <p className="text-xs text-slate-500 mb-3">
          Configure these URLs in your Exotel dashboard to receive inbound messages and call events.
        </p>
        <div className="space-y-2">
          <div>
            <span className="text-xs text-slate-400">WhatsApp inbound:</span>
            <code className="block mt-1 text-xs text-emerald-400 bg-slate-800/50 rounded-lg px-3 py-2 font-mono">
              {import.meta.env.VITE_SUPABASE_URL}/functions/v1/exotel-whatsapp-webhook
            </code>
          </div>
          <div>
            <span className="text-xs text-slate-400">Call events:</span>
            <code className="block mt-1 text-xs text-emerald-400 bg-slate-800/50 rounded-lg px-3 py-2 font-mono">
              {import.meta.env.VITE_SUPABASE_URL}/functions/v1/exotel-call-webhook
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}

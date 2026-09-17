import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Agent } from "@/types/database";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  agent: Agent | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshAgent: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadAgent(userId: string) {
    const { data, error } = await supabase
      .from("agents")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.error("Error loading agent:", error);
      return;
    }
    setAgent(data as Agent | null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        (async () => {
          await loadAgent(s.user.id);
          setLoading(false);
        })();
      } else {
        setLoading(false);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        (async () => {
          await loadAgent(s.user.id);
          setLoading(false);
        })();
      } else {
        setAgent(null);
        setLoading(false);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message || null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setAgent(null);
  }

  async function refreshAgent() {
    if (user) await loadAgent(user.id);
  }

  return (
    <AuthContext.Provider value={{ session, user, agent, loading, signIn, signOut, refreshAgent }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

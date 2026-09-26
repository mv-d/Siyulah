import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getToken, setToken } from "../api/client";
import type { Me } from "../api/types";
import { useI18n } from "../i18n";

interface AuthValue {
  token: string | null;
  me: Me | undefined;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  demo: (profile?: "retail" | "services") => Promise<void>;
  register: (body: Record<string, unknown>) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(getToken);
  const qc = useQueryClient();
  const { setLocale } = useI18n();

  const meQuery = useQuery({
    queryKey: ["me", token],
    queryFn: () => api<Me>("/auth/me"),
    enabled: !!token,
    staleTime: 60_000,
  });

  useEffect(() => {
    const onLogout = () => {
      setTokenState(null);
      qc.clear();
    };
    window.addEventListener("siyulah:logout", onLogout);
    return () => window.removeEventListener("siyulah:logout", onLogout);
  }, [qc]);

  const accept = useCallback(
    (t: string) => {
      setToken(t);
      qc.clear();
      setTokenState(t);
    },
    [qc],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const r = await api<{ access_token: string }>("/auth/login", { method: "POST", body: { email, password } });
      accept(r.access_token);
    },
    [accept],
  );
  const demo = useCallback(
    async (profile: "retail" | "services" = "retail") => {
      const r = await api<{ access_token: string }>(`/auth/demo?profile=${profile}`, { method: "POST" });
      accept(r.access_token);
    },
    [accept],
  );
  const register = useCallback(
    async (body: Record<string, unknown>) => {
      const r = await api<{ access_token: string }>("/auth/register", { method: "POST", body });
      accept(r.access_token);
      if (body.locale === "ar" || body.locale === "en") setLocale(body.locale);
    },
    [accept, setLocale],
  );
  const logout = useCallback(() => {
    setToken(null);
    setTokenState(null);
    qc.clear();
  }, [qc]);

  return (
    <AuthContext.Provider
      value={{ token, me: meQuery.data, loading: !!token && meQuery.isLoading, login, demo, register, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}

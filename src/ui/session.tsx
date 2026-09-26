"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, get, post, setCsrfToken, UNAUTHENTICATED_EVENT } from "./api";

export type Role = "OWNER" | "ADMIN" | "SALES" | "INVENTORY" | "VIEWER";
export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}
interface Me {
  user: SessionUser;
  csrfToken: string;
  mustChangePassword: boolean;
  permissions: string[];
  shopName: string;
  features?: { sampleData?: boolean };
}
interface SessionState {
  status: "loading" | "anonymous" | "ready";
  needsSetup: boolean;
  shopName: string;
  me: Me | null;
  can(permission: string): boolean;
  reload(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  setup(input: { email: string; displayName: string; password: string; shopName: string }): Promise<void>;
  signOut(): Promise<void>;
}
const Ctx = createContext<SessionState | null>(null);
export const useSession = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionState["status"]>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [shopName, setShopName] = useState("");

  const load = useCallback(async () => {
    try {
      const m = await get<Me>("/auth/me");
      setCsrfToken(m.csrfToken);
      setMe(m);
      setShopName(m.shopName);
      setStatus("ready");
    } catch {
      setMe(null);
      setCsrfToken("");
      try {
        const s = await get<{ needsSetup: boolean; shopName: string }>("/auth/status");
        setNeedsSetup(s.needsSetup);
        setShopName(s.shopName);
      } catch {
        /* server unreachable: the login screen reports it on submit */
      }
      setStatus("anonymous");
    }
  }, []);
  useEffect(() => {
    void load();
    const onOut = () => {
      setMe(null);
      setStatus("anonymous");
    };
    window.addEventListener(UNAUTHENTICATED_EVENT, onOut);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onOut);
  }, [load]);

  const value = useMemo<SessionState>(
    () => ({
      status,
      needsSetup,
      shopName,
      me,
      can: (p) => Boolean(me?.permissions.includes(p)),
      reload: load,
      async signIn(email, password) {
        await api("POST", "/auth/login", { email, password });
        await load();
      },
      async setup(input) {
        await api("POST", "/auth/setup", input);
        setNeedsSetup(false);
        await load();
      },
      async signOut() {
        await post("/auth/logout").catch(() => undefined);
        setMe(null);
        setCsrfToken("");
        setStatus("anonymous");
        await load();
      },
    }),
    [status, needsSetup, shopName, me, load],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Role = "ADMIN" | "SRE" | "CSM" | "EXECUTIVE";

export interface Identity {
  vendorId: string;
  actor: string;
  role: Role;
}

interface IdentityContextValue {
  identity: Identity | null;
  loading: boolean;
  signIn: (actor: string, role: Role) => Promise<void>;
  signOut: () => Promise<void>;
}

const IdentityContext = createContext<IdentityContextValue | null>(null);

export function IdentityProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json())
      .then((d) => setIdentity(d.identity))
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (actor: string, role: Role) => {
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor, role }),
    });
    const d = await res.json();
    setIdentity(d.identity ?? null);
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/session", { method: "DELETE" });
    setIdentity(null);
  }, []);

  return (
    <IdentityContext.Provider value={{ identity, loading, signIn, signOut }}>
      {children}
    </IdentityContext.Provider>
  );
}

export function useIdentity() {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error("useIdentity must be used within IdentityProvider");
  return ctx;
}

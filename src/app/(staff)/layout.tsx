import { IdentityProvider } from "@/components/IdentityContext";
import { AppShell } from "@/components/AppShell";

// Staff-only chrome (sidebar, role switcher). Deliberately NOT in the
// root layout -- the Trust Portal (src/app/portal/*) is the
// customer-facing surface and must never show SLAPulse's own staff nav
// (PF1: "no SLAPulse branding on the customer-facing surface").
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <IdentityProvider>
      <AppShell>{children}</AppShell>
    </IdentityProvider>
  );
}

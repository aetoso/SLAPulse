import { IdentityProvider } from "@/components/IdentityContext";
import { AppShell } from "@/components/AppShell";

// Staff-only chrome (sidebar, role switcher). Deliberately NOT in the
// root layout -- the public status page (src/app/status/[vendorId]) is
// the only external-facing surface and must never show staff nav.
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <IdentityProvider>
      <AppShell>{children}</AppShell>
    </IdentityProvider>
  );
}

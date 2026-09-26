"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  Box,
  LayoutDashboard,
  Library,
  Package,
  Warehouse,
  ScanLine,
  Inbox,
  FileText,
  ShoppingCart,
  Receipt,
  Truck,
  Users,
  Building2,
  BarChart3,
  UserCog,
  Settings,
  ScrollText,
  LogOut,
  Search,
  PanelLeftClose,
  Upload,
} from "lucide-react";
import { SessionProvider, useSession } from "./session";
import { ToastProvider, ErrorBanner, FormModal, errorText } from "./kit";
import { post } from "./api";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  perm: string;
}
const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Overview",
    items: [
      {
        href: "/",
        label: "Dashboard",
        icon: <LayoutDashboard size={17} />,
        perm: "settings.read",
      },
    ],
  },
  {
    group: "Catalogue",
    items: [
      {
        href: "/catalogue",
        label: "Reference Catalogue",
        icon: <Library size={17} />,
        perm: "catalogue.read",
      },
      {
        href: "/catalogue/import",
        label: "Import",
        icon: <Upload size={17} />,
        perm: "catalogue.import",
      },
    ],
  },
  {
    group: "Inventory",
    items: [
      {
        href: "/products",
        label: "My Products",
        icon: <Package size={17} />,
        perm: "products.read",
      },
      {
        href: "/inventory",
        label: "Stock & Locations",
        icon: <Warehouse size={17} />,
        perm: "inventory.read",
      },
      {
        href: "/scan",
        label: "Scan / Lookup",
        icon: <ScanLine size={17} />,
        perm: "products.read",
      },
      {
        href: "/purchasing",
        label: "Purchase Orders",
        icon: <Truck size={17} />,
        perm: "purchasing.read",
      },
    ],
  },
  {
    group: "Sales",
    items: [
      {
        href: "/enquiries",
        label: "Enquiries",
        icon: <Inbox size={17} />,
        perm: "enquiries.read",
      },
      {
        href: "/quotations",
        label: "Quotations",
        icon: <FileText size={17} />,
        perm: "quotations.read",
      },
      {
        href: "/orders",
        label: "Orders",
        icon: <ShoppingCart size={17} />,
        perm: "orders.read",
      },
      {
        href: "/invoices",
        label: "Invoices & Payments",
        icon: <Receipt size={17} />,
        perm: "invoices.read",
      },
    ],
  },
  {
    group: "Contacts",
    items: [
      {
        href: "/customers",
        label: "Customers",
        icon: <Users size={17} />,
        perm: "customers.read",
      },
      {
        href: "/suppliers",
        label: "Suppliers",
        icon: <Building2 size={17} />,
        perm: "suppliers.read",
      },
    ],
  },
  {
    group: "Insights",
    items: [
      {
        href: "/reports",
        label: "Reports",
        icon: <BarChart3 size={17} />,
        perm: "settings.read",
      },
    ],
  },
  {
    group: "Administration",
    items: [
      {
        href: "/admin/users",
        label: "Users",
        icon: <UserCog size={17} />,
        perm: "users.manage",
      },
      {
        href: "/admin/settings",
        label: "Shop settings",
        icon: <Settings size={17} />,
        perm: "settings.manage",
      },
      {
        href: "/admin/audit",
        label: "Audit log",
        icon: <ScrollText size={17} />,
        perm: "audit.read",
      },
    ],
  },
];

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>{children}</ToastProvider>
    </SessionProvider>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const s = useSession();
  if (s.status === "loading")
    return (
      <div className="boot" role="status">
        Loading…
      </div>
    );
  if (s.status === "anonymous") return <AuthScreen />;
  if (s.me?.mustChangePassword) return <ChangePasswordScreen />;
  return <AppFrame>{children}</AppFrame>;
}

function AppFrame({ children }: { children: ReactNode }) {
  const s = useSession();
  const path = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [q, setQ] = useState("");
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const up = () => setOffline(false);
    const down = () => setOffline(true);
    setOffline(!navigator.onLine);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  const active = (href: string) =>
    href === "/"
      ? path === "/"
      : path === href ||
        (path.startsWith(href + "/") &&
          !NAV.flatMap((g) => g.items).some(
            (i) =>
              i.href !== href &&
              i.href.startsWith(href + "/") &&
              (path === i.href || path.startsWith(i.href + "/")),
          ));
  const initials = (s.me?.user.displayName ?? "?")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div
      className="app"
      style={
        collapsed ? { gridTemplateColumns: "64px minmax(0, 1fr)" } : undefined
      }
    >
      <aside className="sidebar no-print" aria-label="Main navigation">
        <div className="brandmark">
          <Box /> {!collapsed && <span>{s.shopName || "Spare Parts"}</span>}
        </div>
        <nav>
          {NAV.map((g) => {
            const items = g.items.filter((i) => s.can(i.perm));
            if (!items.length) return null;
            return (
              <div className="nav-group" key={g.group}>
                {!collapsed && (
                  <small
                    style={{
                      display: "block",
                      padding: "12px 12px 4px",
                      opacity: 0.6,
                      textTransform: "uppercase",
                      fontSize: 10,
                      letterSpacing: 0.6,
                    }}
                  >
                    {g.group}
                  </small>
                )}
                {items.map((i) => (
                  <Link
                    key={i.href}
                    href={i.href}
                    className={`nav-item button ${active(i.href) ? "active" : ""}`}
                    aria-current={active(i.href) ? "page" : undefined}
                    title={i.label}
                  >
                    {i.icon} {!collapsed && i.label}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          {!collapsed && (
            <>
              <span
                className="status-dot"
                style={offline ? { background: "#e0a030" } : undefined}
              />{" "}
              {offline ? "Offline — working locally" : "Connected"}
              <small style={{ display: "block" }}>
                All data is stored on this server
              </small>
            </>
          )}
          <button
            aria-label="Collapse sidebar"
            onClick={() => setCollapsed(!collapsed)}
          >
            <PanelLeftClose size={18} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar no-print">
          <form
            className="global-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              const term = q.trim();
              if (!term) return;
              setQ("");
              router.push(`/scan?code=${encodeURIComponent(term)}`);
            }}
          >
            <Search size={17} />
            <input
              aria-label="Quick find"
              placeholder="Scan or type a SKU / part number…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </form>
          <details className="account">
            <summary>
              <span className="avatar">{initials}</span>
              <span>
                {s.me?.user.displayName}
                <small>{s.me?.user.role}</small>
              </span>
            </summary>
            <button onClick={() => void s.signOut()}>
              <LogOut size={15} /> Sign out
            </button>
          </details>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}

function AuthScreen() {
  const s = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [shop, setShop] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (s.needsSetup)
        await s.setup({ email, displayName: name, password, shopName: shop });
      else await s.signIn(email, password);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <div className="login-brand">
        <Box size={42} />
        <h1>{s.shopName || "Spare Parts"}</h1>
        <p>
          Catalogue, stock, quotations and invoices in one place — running on
          your own server.
        </p>
      </div>
      <form className="login-card" onSubmit={submit}>
        <div className="brandmark">
          <Box /> {s.shopName || "Spare Parts"}
        </div>
        <h2>{s.needsSetup ? "Set up your shop" : "Sign in"}</h2>
        {s.needsSetup && (
          <p className="muted">
            Create the Owner account. You can add staff afterwards.
          </p>
        )}
        <ErrorBanner message={error} />
        {s.needsSetup && (
          <>
            <div className="field">
              <label htmlFor="shop">Shop name</label>
              <input
                id="shop"
                value={shop}
                onChange={(e) => setShop(e.target.value)}
                required
                autoComplete="organization"
              />
            </div>
            <div className="field">
              <label htmlFor="name">Your name</label>
              <input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
              />
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={s.needsSetup ? "new-password" : "current-password"}
          />
          {s.needsSetup && (
            <small className="muted">At least 10 characters.</small>
          )}
        </div>
        <button className="primary" disabled={busy}>
          {busy
            ? "Please wait…"
            : s.needsSetup
              ? "Create Owner account"
              : "Sign in"}
        </button>
      </form>
    </main>
  );
}

function ChangePasswordScreen() {
  const s = useSession();
  return (
    <main className="login" style={{ gridTemplateColumns: "1fr" }}>
      <div className="login-card">
        <h2>Choose a new password</h2>
        <p className="muted">
          Your account was created with a temporary password. Set your own to
          continue.
        </p>
        <FormModal
          title="Change password"
          submitLabel="Change password"
          fields={[
            {
              name: "currentPassword",
              label: "Temporary password",
              type: "password",
              required: true,
            },
            {
              name: "newPassword",
              label: "New password",
              type: "password",
              required: true,
              help: "At least 10 characters.",
            },
          ]}
          onSubmit={async (v) => {
            await post("/auth/password", v);
            await s.signOut();
          }}
          onClose={() => void s.signOut()}
        />
      </div>
    </main>
  );
}

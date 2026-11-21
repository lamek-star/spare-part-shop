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
  CalendarClock,
  Pill,
} from "lucide-react";
import {
  SessionProvider,
  productNameOf,
  useSession,
  type Edition,
} from "./session";
import { ToastProvider, ErrorBanner, FormModal, errorText } from "./kit";
import { post } from "./api";
import { I18nProvider, LANGUAGES, useI18n, useT, type Language } from "./i18n";
import type { MessageKey } from "./messages";

interface NavItem {
  href: string;
  /** Message key of the label (ui/messages). */
  label: MessageKey;
  icon: ReactNode;
  perm: string;
  /** Shown only in this edition. */
  only?: Edition;
  /** The label in the pharmacy edition, when it differs. */
  pharmacyLabel?: MessageKey;
}
const NAV: { group: MessageKey; items: NavItem[] }[] = [
  {
    group: "nav.group.overview",
    items: [
      {
        href: "/",
        label: "nav.dashboard",
        icon: <LayoutDashboard size={17} />,
        perm: "settings.read",
      },
    ],
  },
  {
    group: "nav.group.catalogue",
    items: [
      {
        href: "/catalogue",
        label: "nav.catalogue",
        icon: <Library size={17} />,
        perm: "catalogue.read",
        only: "spare-parts",
      },
      {
        href: "/catalogue/import",
        label: "nav.import",
        icon: <Upload size={17} />,
        perm: "catalogue.import",
        only: "spare-parts",
      },
    ],
  },
  {
    group: "nav.group.inventory",
    items: [
      {
        href: "/products",
        label: "nav.products",
        pharmacyLabel: "nav.productsPharmacy",
        icon: <Package size={17} />,
        perm: "products.read",
      },
      {
        href: "/inventory",
        label: "nav.inventory",
        icon: <Warehouse size={17} />,
        perm: "inventory.read",
      },
      {
        href: "/scan",
        label: "nav.scan",
        icon: <ScanLine size={17} />,
        perm: "products.read",
      },
      {
        href: "/expiry",
        label: "nav.expiry",
        icon: <CalendarClock size={17} />,
        perm: "inventory.read",
        only: "pharmacy",
      },
      {
        href: "/purchasing",
        label: "nav.purchasing",
        icon: <Truck size={17} />,
        perm: "purchasing.read",
      },
    ],
  },
  {
    group: "nav.group.sales",
    items: [
      {
        href: "/sell",
        label: "nav.sell",
        icon: <Pill size={17} />,
        perm: "payments.record",
        only: "pharmacy",
      },
      {
        href: "/enquiries",
        label: "nav.enquiries",
        icon: <Inbox size={17} />,
        perm: "enquiries.read",
        only: "spare-parts",
      },
      {
        href: "/quotations",
        label: "nav.quotations",
        icon: <FileText size={17} />,
        perm: "quotations.read",
      },
      {
        href: "/orders",
        label: "nav.orders",
        icon: <ShoppingCart size={17} />,
        perm: "orders.read",
      },
      {
        href: "/invoices",
        label: "nav.invoices",
        icon: <Receipt size={17} />,
        perm: "invoices.read",
      },
    ],
  },
  {
    group: "nav.group.contacts",
    items: [
      {
        href: "/customers",
        label: "nav.customers",
        icon: <Users size={17} />,
        perm: "customers.read",
      },
      {
        href: "/suppliers",
        label: "nav.suppliers",
        icon: <Building2 size={17} />,
        perm: "suppliers.read",
      },
    ],
  },
  {
    group: "nav.group.insights",
    items: [
      {
        href: "/reports",
        label: "nav.reports",
        icon: <BarChart3 size={17} />,
        perm: "settings.read",
      },
    ],
  },
  {
    group: "nav.group.admin",
    items: [
      {
        href: "/admin/users",
        label: "nav.users",
        icon: <UserCog size={17} />,
        perm: "users.manage",
      },
      {
        href: "/admin/settings",
        label: "nav.settings",
        icon: <Settings size={17} />,
        perm: "settings.manage",
      },
      {
        href: "/admin/audit",
        label: "nav.audit",
        icon: <ScrollText size={17} />,
        perm: "audit.read",
      },
    ],
  },
];

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <I18nProvider>
        <ToastProvider>{children}</ToastProvider>
      </I18nProvider>
    </SessionProvider>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const s = useSession();
  const t = useT();
  if (s.status === "loading")
    return (
      <div className="boot" role="status">
        {t("shell.loading")}
      </div>
    );
  if (s.status === "anonymous") return <AuthScreen />;
  if (s.me?.mustChangePassword) return <ChangePasswordScreen />;
  return <AppFrame>{children}</AppFrame>;
}

function AppFrame({ children }: { children: ReactNode }) {
  const s = useSession();
  const t = useT();
  const path = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [q, setQ] = useState("");
  const [offline, setOffline] = useState(false);
  // One image serves both editions, so the tab title follows the running edition, not the build.
  useEffect(() => {
    document.title = s.shopName || productNameOf(s.edition);
  }, [s.shopName, s.edition]);
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
      <aside className="sidebar no-print" aria-label={t("shell.mainNav")}>
        <div className="brandmark">
          <Box />{" "}
          {!collapsed && <span>{s.shopName || productNameOf(s.edition)}</span>}
        </div>
        <nav>
          {NAV.map((g) => {
            const items = g.items
              .filter((i) => s.can(i.perm) && (!i.only || i.only === s.edition))
              .map((i) =>
                s.edition === "pharmacy" && i.pharmacyLabel
                  ? { ...i, label: i.pharmacyLabel }
                  : i,
              );
            if (!items.length) return null;
            return (
              <div className="nav-group" key={g.group}>
                {!collapsed && (
                  <small
                    className="nav-group-label"
                    style={{
                      display: "block",
                      padding: "12px 12px 4px",
                      opacity: 0.6,
                      textTransform: "uppercase",
                      fontSize: 10,
                      letterSpacing: 0.6,
                    }}
                  >
                    {t(g.group)}
                  </small>
                )}
                {items.map((i) => (
                  <Link
                    key={i.href}
                    href={i.href}
                    className={`nav-item button ${active(i.href) ? "active" : ""}`}
                    aria-current={active(i.href) ? "page" : undefined}
                    title={t(i.label)}
                  >
                    {i.icon} {!collapsed && <span>{t(i.label)}</span>}
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
              <span className="sidebar-status">
                {offline ? t("shell.offline") : t("shell.connected")}
              </span>
              <small style={{ display: "block" }}>{t("shell.localData")}</small>
            </>
          )}
          <button
            aria-label={t("shell.collapse")}
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
              aria-label={t("shell.quickFind")}
              placeholder={t("shell.searchPlaceholder")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </form>
          <details className="account">
            <summary>
              <span className="avatar">{initials}</span>
              <span>
                {s.me?.user.displayName}
                <small>
                  {s.me ? t(`role.${s.me.user.role}` as MessageKey) : ""}
                </small>
              </span>
            </summary>
            <div className="account-menu">
              <LanguagePicker />
              <button onClick={() => void s.signOut()}>
                <LogOut size={15} /> {t("shell.signOut")}
              </button>
            </div>
          </details>
        </header>
        <main key={path} className="page-enter">
          {children}
        </main>
      </div>
    </div>
  );
}

function AuthScreen() {
  const s = useSession();
  const t = useT();
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
        <h1>{s.shopName || productNameOf(s.edition)}</h1>
        <p>
          {s.edition === "pharmacy"
            ? t("auth.taglinePharmacy")
            : t("auth.taglineParts")}
        </p>
      </div>
      <form className="login-card" onSubmit={submit}>
        <div className="brandmark">
          <Box /> {s.shopName || productNameOf(s.edition)}
        </div>
        <h2>{s.needsSetup ? t("auth.setupTitle") : t("auth.signIn")}</h2>
        {s.needsSetup && <p className="muted">{t("auth.setupHelp")}</p>}
        <ErrorBanner message={error} />
        {s.needsSetup && (
          <>
            <div className="field">
              <label htmlFor="shop">{t("auth.shopName")}</label>
              <input
                id="shop"
                value={shop}
                onChange={(e) => setShop(e.target.value)}
                required
                autoComplete="organization"
              />
            </div>
            <div className="field">
              <label htmlFor="name">{t("auth.yourName")}</label>
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
          <label htmlFor="email">{t("auth.email")}</label>
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
          <label htmlFor="password">{t("auth.password")}</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={s.needsSetup ? "new-password" : "current-password"}
          />
          {s.needsSetup && <small className="muted">{t("auth.min10")}</small>}
        </div>
        <button className="primary" disabled={busy}>
          {busy
            ? t("auth.wait")
            : s.needsSetup
              ? t("auth.createOwner")
              : t("auth.signIn")}
        </button>
      </form>
    </main>
  );
}

function ChangePasswordScreen() {
  const s = useSession();
  const t = useT();
  return (
    <main className="login" style={{ gridTemplateColumns: "1fr" }}>
      <div className="login-card">
        <h2>{t("pw.title")}</h2>
        <p className="muted">{t("pw.help")}</p>
        <FormModal
          title={t("pw.change")}
          submitLabel={t("pw.change")}
          fields={[
            {
              name: "currentPassword",
              label: t("pw.temporary"),
              type: "password",
              required: true,
            },
            {
              name: "newPassword",
              label: t("pw.new"),
              type: "password",
              required: true,
              help: t("auth.min10"),
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

/** The person's own language, in the account menu; "Shop default" follows the shop's setting. */
function LanguagePicker() {
  const { t, choice, choose } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <label className="language-picker">
      <span>{t("lang.label")}</span>
      <select
        value={choice?.personal ?? ""}
        disabled={busy || !choice}
        onChange={async (e) => {
          setBusy(true);
          setError("");
          try {
            await choose(e.target.value ? (e.target.value as Language) : null);
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <option value="">
          {t("lang.followShop", {
            language: LANGUAGES[choice?.shop ?? "en"].native,
          })}
        </option>
        {(Object.keys(LANGUAGES) as Language[]).map((l) => (
          <option key={l} value={l} lang={l}>
            {LANGUAGES[l].native}
          </option>
        ))}
      </select>
      {error && <small role="alert">{error}</small>}
    </label>
  );
}

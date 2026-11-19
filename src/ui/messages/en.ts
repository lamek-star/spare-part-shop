/**
 * English: the source of every message key. The other languages translate
 * these keys; a key they lack shows in English (never blank). "{name}" marks a
 * value filled in at run time.
 */
export const en = {
  // The main navigation
  "nav.group.overview": "Overview",
  "nav.group.catalogue": "Catalogue",
  "nav.group.inventory": "Inventory",
  "nav.group.sales": "Sales",
  "nav.group.contacts": "Contacts",
  "nav.group.insights": "Insights",
  "nav.group.admin": "Administration",
  "nav.dashboard": "Dashboard",
  "nav.catalogue": "Reference Catalogue",
  "nav.import": "Import",
  "nav.products": "My Products",
  "nav.productsPharmacy": "Medicines & Products",
  "nav.inventory": "Stock & Locations",
  "nav.scan": "Scan / Lookup",
  "nav.expiry": "Expiry & Batches",
  "nav.purchasing": "Purchase Orders",
  "nav.sell": "Sell (till)",
  "nav.enquiries": "Enquiries",
  "nav.quotations": "Quotations",
  "nav.orders": "Orders",
  "nav.invoices": "Invoices & Payments",
  "nav.customers": "Customers",
  "nav.suppliers": "Suppliers",
  "nav.reports": "Reports",
  "nav.users": "Users",
  "nav.settings": "Shop settings",
  "nav.audit": "Audit log",

  // The frame around every page
  "shell.loading": "Loading…",
  "shell.mainNav": "Main navigation",
  "shell.offline": "Offline — working locally",
  "shell.connected": "Connected",
  "shell.localData": "All data is stored on this server",
  "shell.collapse": "Collapse sidebar",
  "shell.quickFind": "Quick find",
  "shell.searchPlaceholder": "Scan or type a SKU / part number…",
  "shell.signOut": "Sign out",

  // Choosing a language
  "lang.label": "Language",
  "lang.followShop": "Shop default ({language})",
  "lang.saved": "Language saved",
  "lang.shopDefault": "Language for everyone",
  "lang.shopDefaultHelp":
    "Screens and printed documents use this language unless a person chooses their own (in their account menu).",

  // Roles
  "role.OWNER": "Owner",
  "role.ADMIN": "Admin",
  "role.SALES": "Sales",
  "role.INVENTORY": "Inventory",
  "role.VIEWER": "Viewer",

  // Signing in and first-run setup
  "auth.taglineParts":
    "Catalogue, stock, quotations and invoices in one place — running on your own server.",
  "auth.taglinePharmacy":
    "Medicines, batches and expiry, the till, and the accounts in one place — running on your own server.",
  "auth.setupTitle": "Set up your shop",
  "auth.signIn": "Sign in",
  "auth.setupHelp": "Create the Owner account. You can add staff afterwards.",
  "auth.shopName": "Shop name",
  "auth.yourName": "Your name",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.min10": "At least 10 characters.",
  "auth.wait": "Please wait…",
  "auth.createOwner": "Create Owner account",

  // A temporary password must be replaced
  "pw.title": "Choose a new password",
  "pw.help":
    "Your account was created with a temporary password. Set your own to continue.",
  "pw.change": "Change password",
  "pw.temporary": "Temporary password",
  "pw.new": "New password",
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Partial<Record<MessageKey, string>>;

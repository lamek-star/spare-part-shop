# UI structure

The App Router root renders the browser adapter bootstrap and an operational shell. `Workspace` coordinates navigation, search, selection and service subscriptions. Reusable UI primitives (Table, Badge, Field, Modal) live in components/ui.tsx. Forms, contact details, catalogue relationship tools and management screens are independent components. All commands go through Services; component-local state holds only navigation, filters and form drafts.

Navigation includes every requested module. Part detail tabs provide overview, numbers, cross references, compatibility, inventory, supplier references, purchases, sales, documents, images and movement history. Contacts have overview, products, orders, documents, audit and edit tabs. Purchase and sales details expose only valid next actions.

Responsive behavior: desktop sidebar; narrow-screen icon rail and visible active-group links; horizontally scrollable data tables; stacked forms; native modal dialogs with Escape, focus containment and explicit labels. The invoice has a print stylesheet. Demo account menu is a local session selector, not security.

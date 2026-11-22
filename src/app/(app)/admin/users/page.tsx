"use client";
import { useState } from "react";
import {
  Badge,
  DataTable,
  ErrorBanner,
  FormModal,
  PageHead,
  Panel,
  useAction,
  useApi,
} from "../../../../ui/kit";
import { formatDateTime, patch, post, titleCase } from "../../../../ui/api";
import { useT, type Translate } from "../../../../ui/i18n";
import { AccessRequestsPanel } from "../../../../ui/accessRequests";

interface User {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}
const roles = (t: Translate) => [
  { value: "OWNER", label: t("users.ownerEverythingIncludingUsers") },
  { value: "ADMIN", label: t("users.adminEverythingExceptUsers") },
  { value: "SALES", label: t("users.salesCustomersQuotationsOrdersInvoices") },
  { value: "INVENTORY", label: t("users.inventoryProductsStockPurchasing") },
  { value: "VIEWER", label: t("users.viewerReadOnlyCatalogueProducts") },
];
export default function Users() {
  const t = useT();
  const users = useApi<User[]>("/users");
  const [modal, setModal] = useState<
    { kind: "new" } | { kind: "edit" | "reset"; user: User } | null
  >(null);
  const act = useAction(users.reload);
  return (
    <>
      <PageHead
        title={t("nav.users")}
        subtitle={t("users.whoCanSignInAnd")}
        actions={
          <button className="primary" onClick={() => setModal({ kind: "new" })}>
            {t("users.addUser")}
          </button>
        }
      />
      <ErrorBanner message={users.error || act.error} onClose={act.clear} />
      <AccessRequestsPanel />
      <Panel>
        {users.data && (
          <DataTable
            rowKey={(u) => u.id}
            rows={users.data}
            columns={[
              { header: t("users.name"), cell: (u) => u.displayName },
              { header: t("auth.email"), cell: (u) => u.email },
              { header: t("users.role"), cell: (u) => titleCase(u.role) },
              {
                header: t("common.status"),
                cell: (u) => <Badge value={u.status} />,
              },
              {
                header: t("users.lastSignIn"),
                cell: (u) => formatDateTime(u.lastLoginAt),
              },
              {
                header: "",
                cell: (u) => (
                  <div className="actions">
                    <button onClick={() => setModal({ kind: "edit", user: u })}>
                      {t("users.edit")}
                    </button>
                    <button
                      onClick={() => setModal({ kind: "reset", user: u })}
                    >
                      {t("users.resetPassword")}
                    </button>
                    {u.status === "ACTIVE" ? (
                      <button
                        className="danger"
                        onClick={() =>
                          void act.run(
                            () =>
                              patch(`/users/${u.id}`, { status: "DISABLED" }),
                            t("users.disabled"),
                          )
                        }
                      >
                        {t("users.disable")}
                      </button>
                    ) : (
                      <button
                        onClick={() =>
                          void act.run(
                            () => patch(`/users/${u.id}`, { status: "ACTIVE" }),
                            t("users.enabled"),
                          )
                        }
                      >
                        {t("users.enable")}
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Panel>
      {modal?.kind === "new" && (
        <FormModal
          title={t("users.addUser")}
          fields={[
            { name: "displayName", label: t("users.name"), required: true },
            {
              name: "email",
              label: t("users.emailUsedToSignIn"),
              type: "email",
              required: true,
            },
            {
              name: "role",
              label: t("users.role"),
              type: "select",
              options: roles(t),
            },
            {
              name: "password",
              label: t("pw.temporary"),
              type: "password",
              required: true,
              help: t("users.atLeast10CharactersThey"),
            },
          ]}
          initial={{ role: "SALES" }}
          onClose={() => setModal(null)}
          onSubmit={async (v) => (await post("/users", v), users.reload())}
        />
      )}
      {modal?.kind === "edit" && (
        <FormModal
          title={`Edit ${modal.user.displayName}`}
          fields={[
            { name: "displayName", label: t("users.name"), required: true },
            {
              name: "role",
              label: t("users.role"),
              type: "select",
              options: roles(t),
            },
          ]}
          initial={modal.user as unknown as Record<string, unknown>}
          onClose={() => setModal(null)}
          onSubmit={async (v) => (
            await patch(`/users/${modal.user.id}`, v),
            users.reload()
          )}
        />
      )}
      {modal?.kind === "reset" && (
        <FormModal
          title={`Reset password — ${modal.user.displayName}`}
          fields={[
            {
              name: "password",
              label: t("users.newTemporaryPassword"),
              type: "password",
              required: true,
              help: t("users.theirExistingSessionsEndImmediately"),
            },
          ]}
          onClose={() => setModal(null)}
          onSubmit={async (v) => (
            await patch(`/users/${modal.user.id}`, v),
            users.reload()
          )}
        />
      )}
    </>
  );
}

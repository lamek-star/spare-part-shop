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

interface User {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}
const ROLES = [
  { value: "OWNER", label: "Owner — everything, including users" },
  { value: "ADMIN", label: "Admin — everything except users" },
  { value: "SALES", label: "Sales — customers, quotations, orders, invoices" },
  { value: "INVENTORY", label: "Inventory — products, stock, purchasing" },
  { value: "VIEWER", label: "Viewer — read-only catalogue, products, stock" },
];
export default function Users() {
  const users = useApi<User[]>("/users");
  const [modal, setModal] = useState<
    { kind: "new" } | { kind: "edit" | "reset"; user: User } | null
  >(null);
  const act = useAction(users.reload);
  return (
    <>
      <PageHead
        title="Users"
        subtitle="Who can sign in, and what they can do. Permissions are enforced by the server."
        actions={
          <button className="primary" onClick={() => setModal({ kind: "new" })}>
            Add user
          </button>
        }
      />
      <ErrorBanner message={users.error || act.error} onClose={act.clear} />
      <Panel>
        {users.data && (
          <DataTable
            rowKey={(u) => u.id}
            rows={users.data}
            columns={[
              { header: "Name", cell: (u) => u.displayName },
              { header: "Email", cell: (u) => u.email },
              { header: "Role", cell: (u) => titleCase(u.role) },
              { header: "Status", cell: (u) => <Badge value={u.status} /> },
              {
                header: "Last sign-in",
                cell: (u) => formatDateTime(u.lastLoginAt),
              },
              {
                header: "",
                cell: (u) => (
                  <div className="actions">
                    <button onClick={() => setModal({ kind: "edit", user: u })}>
                      Edit
                    </button>
                    <button
                      onClick={() => setModal({ kind: "reset", user: u })}
                    >
                      Reset password
                    </button>
                    {u.status === "ACTIVE" ? (
                      <button
                        className="danger"
                        onClick={() =>
                          void act.run(
                            () =>
                              patch(`/users/${u.id}`, { status: "DISABLED" }),
                            "User disabled",
                          )
                        }
                      >
                        Disable
                      </button>
                    ) : (
                      <button
                        onClick={() =>
                          void act.run(
                            () => patch(`/users/${u.id}`, { status: "ACTIVE" }),
                            "User enabled",
                          )
                        }
                      >
                        Enable
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
          title="Add user"
          fields={[
            { name: "displayName", label: "Name", required: true },
            {
              name: "email",
              label: "Email (used to sign in)",
              type: "email",
              required: true,
            },
            { name: "role", label: "Role", type: "select", options: ROLES },
            {
              name: "password",
              label: "Temporary password",
              type: "password",
              required: true,
              help: "At least 10 characters. They must change it at first sign-in.",
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
            { name: "displayName", label: "Name", required: true },
            { name: "role", label: "Role", type: "select", options: ROLES },
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
              label: "New temporary password",
              type: "password",
              required: true,
              help: "Their existing sessions end immediately.",
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

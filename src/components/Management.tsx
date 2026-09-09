"use client";
import { useState } from "react";
import { Services } from "../services/contracts";
import { uid } from "../adapters/demo";
import { Badge, Field, Modal, Table } from "./ui";
export default function Management({
  page,
  services,
}: {
  page: string;
  services: Services;
}) {
  const s = services.snapshot();
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const user = s.users.find((u) => u.id === editing);
  const role = s.roles.find((r) => r.id === editing);
  const branch = s.branches.find((b) => b.id === editing);
  const warehouse = s.warehouses.find((w) => w.id === editing);
  const singular =
    page === "Users"
      ? "user"
      : page === "Roles"
        ? "role"
        : page === "Branches"
          ? "branch"
          : "warehouse";
  const edit = (id: string) => {
    setError("");
    setEditing(id);
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>{page}</h3>
        <button onClick={() => edit("new")}>+ New {singular}</button>
      </div>
      {["Users", "Roles"].includes(page) && (
        <p className="notice">
          Demo identity and permission design only. These records do not grant
          or restrict access. IntraForge will provide authoritative identity and
          permissions.
        </p>
      )}
      {page === "Users" ? (
        <Table
          headers={["Name", "Email", "Role", "Branch", "Status", ""]}
          rows={s.users.map((u) => [
            u.name,
            u.email,
            u.role,
            s.branches.find((b) => b.id === u.branchId)?.name,
            <Badge>{u.status}</Badge>,
            <button onClick={() => edit(u.id)}>Edit</button>,
          ])}
        />
      ) : page === "Roles" ? (
        <Table
          headers={["Role", "Proposed permissions", ""]}
          rows={s.roles.map((r) => [
            r.name,
            r.permissions.join(", "),
            <button onClick={() => edit(r.id)}>Edit design</button>,
          ])}
        />
      ) : page === "Branches" ? (
        <Table
          headers={["Branch", "Address", "Status", ""]}
          rows={s.branches.map((b) => [
            b.name,
            b.address,
            <Badge>{b.status}</Badge>,
            <button onClick={() => edit(b.id)}>Edit</button>,
          ])}
        />
      ) : (
        <Table
          headers={["Warehouse", "Branch", "Address", "On hand", ""]}
          rows={s.warehouses.map((w) => [
            w.name,
            w.branch,
            w.address,
            services.inventory
              .list()
              .filter((x) => x.warehouseId === w.id)
              .reduce((n, x) => n + x.onHand, 0),
            <button onClick={() => edit(w.id)}>Edit</button>,
          ])}
        />
      )}
      {editing !== null && (
        <Modal
          title={`${editing === "new" ? "New" : "Edit"} ${singular}`}
          onClose={() => setEditing(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const v = (k: string) => String(f.get(k) ?? "");
              const id = editing === "new" ? uid() : editing;
              try {
                if (page === "Users")
                  await services.management.saveUser({
                    id,
                    name: v("name"),
                    email: v("email"),
                    role: v("role"),
                    branchId: v("branchId"),
                    status: v("status"),
                  });
                else if (page === "Roles")
                  await services.management.saveRole({
                    id,
                    name: v("name"),
                    permissions: f.getAll("permission").map(String),
                  });
                else if (page === "Branches")
                  await services.management.saveBranch({
                    id,
                    name: v("name"),
                    address: v("address"),
                    status: v("status"),
                  });
                else
                  await services.management.saveWarehouse({
                    id,
                    name: v("name"),
                    address: v("address"),
                    branch: v("branch"),
                  });
                setEditing(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <Field label="Name">
              <input
                name="name"
                required
                defaultValue={
                  user?.name ?? role?.name ?? branch?.name ?? warehouse?.name
                }
              />
            </Field>
            {page === "Users" ? (
              <>
                <Field label="Email">
                  <input
                    type="email"
                    required
                    name="email"
                    defaultValue={user?.email}
                  />
                </Field>
                <Field label="Role">
                  <select name="role" defaultValue={user?.role}>
                    {s.roles.map((r) => (
                      <option key={r.id}>{r.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Branch">
                  <select name="branchId" defaultValue={user?.branchId}>
                    {s.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            ) : page === "Roles" ? (
              <fieldset>
                <legend>Proposed access</legend>
                {[
                  "catalogue.read",
                  "inventory.write",
                  "purchasing.write",
                  "sales.write",
                  "management.write",
                ].map((p) => (
                  <label className="permission-option" key={p}>
                    <input
                      type="checkbox"
                      name="permission"
                      value={p}
                      defaultChecked={role?.permissions.includes(p)}
                    />
                    {p}
                  </label>
                ))}
              </fieldset>
            ) : (
              <>
                <Field label="Address">
                  <input
                    name="address"
                    defaultValue={branch?.address ?? warehouse?.address}
                  />
                </Field>
                {page === "Warehouses" && (
                  <Field label="Branch">
                    <select name="branch" defaultValue={warehouse?.branch}>
                      {s.branches.map((b) => (
                        <option key={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </Field>
                )}
              </>
            )}
            {["Users", "Branches"].includes(page) && (
              <Field label="Status">
                <select
                  name="status"
                  defaultValue={user?.status ?? branch?.status}
                >
                  <option>Active</option>
                  <option>Inactive</option>
                </select>
              </Field>
            )}
            <div className="form-actions">
              <button className="primary">Save {singular}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

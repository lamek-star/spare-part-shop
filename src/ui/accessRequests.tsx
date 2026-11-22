"use client";
/**
 * Requests to work in this app (IntraForge access requests, ADR-0026), on the Users page in platform mode. IntraForge
 * decides who may see and decide them; the role chosen here is the one given (what the person asked for is only a
 * suggestion). Approving a new account shows its one-time activation link to hand over.
 */
import { useState } from "react";
import { Badge, DataTable, ErrorBanner, FormModal, Modal, Panel, useAction, useApi } from "./kit";
import { formatDateTime, post } from "./api";
import { useT } from "./i18n";

interface Request {
  id: string;
  status: "pending" | "approved" | "rejected";
  email: string;
  name: string;
  phone: string;
  requested_role: string;
  requested_role_name: string;
  message: string;
  new_account: boolean;
  activated: boolean;
  created_at: string;
}
interface Answer {
  available: boolean;
  results: Request[];
  roles: { slug: string; name: string; summary: string }[];
}

export function AccessRequestsPanel() {
  const t = useT();
  const list = useApi<Answer>("/access-requests");
  const act = useAction(list.reload);
  const [modal, setModal] = useState<{ kind: "approve" | "reject"; request: Request } | null>(null);
  const [link, setLink] = useState<{ who: string; link: string; emailed: boolean } | null>(null);
  if (!list.data?.available) return null;
  const rows = list.data.results.filter((r) => r.status === "pending" || (r.new_account && !r.activated && r.status === "approved"));
  const roles = list.data.roles.map((r) => ({ value: r.slug, label: `${r.name} — ${r.summary}` }));

  return (
    <>
      <Panel title={t("access.title")}>
        <ErrorBanner message={act.error} onClose={act.clear} />
        <p className="muted">{t("access.help")}</p>
        <DataTable
          rowKey={(r) => r.id}
          rows={rows}
          empty={t("access.none")}
          columns={[
            {
              header: t("users.name"),
              cell: (r) => (
                <>
                  <strong>{r.name || r.email}</strong>
                  <small style={{ display: "block" }}>
                    {r.email}
                    {r.phone ? ` · ${r.phone}` : ""}
                  </small>
                  {r.message && <small style={{ display: "block" }}>“{r.message}”</small>}
                </>
              ),
            },
            { header: t("access.askedFor"), cell: (r) => r.requested_role_name || t("access.adminChooses") },
            { header: t("access.asked"), cell: (r) => formatDateTime(r.created_at) },
            {
              header: t("common.status"),
              cell: (r) => (
                <Badge
                  value={r.status === "pending" ? "PENDING" : "ISSUED"}
                  label={r.status === "pending" ? t("access.waiting") : t("access.waitingForLink")}
                />
              ),
            },
            {
              header: "",
              cell: (r) =>
                r.status === "pending" ? (
                  <div className="actions">
                    <button className="primary" onClick={() => setModal({ kind: "approve", request: r })}>
                      {t("access.approve")}
                    </button>
                    <button onClick={() => setModal({ kind: "reject", request: r })}>{t("access.reject")}</button>
                  </div>
                ) : (
                  <button
                    onClick={() =>
                      void act
                        .run(() => post<{ link: string | null; emailed: boolean }>(`/access-requests/${r.id}/decide`, { decision: "link" }))
                        .then((d) => d?.link && setLink({ who: r.email, link: d.link, emailed: d.emailed }))
                    }
                  >
                    {t("access.newLink")}
                  </button>
                ),
            },
          ]}
        />
      </Panel>
      {modal?.kind === "approve" && (
        <FormModal
          title={`${t("access.approve")}: ${modal.request.email}`}
          fields={[
            {
              name: "roleSlug",
              label: t("access.roleToGive"),
              type: "select",
              options: roles,
              required: true,
              help: t("access.youDecide"),
            },
            { name: "note", label: t("access.note"), type: "textarea", optional: true },
          ]}
          initial={{ roleSlug: modal.request.requested_role || roles[0]?.value || "" }}
          submitLabel={t("access.approve")}
          onClose={() => setModal(null)}
          onSubmit={async (v) => {
            const d = await post<{ link: string | null; emailed: boolean }>(`/access-requests/${modal.request.id}/decide`, {
              decision: "approve",
              ...v,
            });
            const who = modal.request.email;
            setModal(null);
            list.reload();
            if (d.link) setLink({ who, link: d.link, emailed: d.emailed });
          }}
        />
      )}
      {modal?.kind === "reject" && (
        <FormModal
          title={`${t("access.reject")}: ${modal.request.email}`}
          fields={[{ name: "note", label: t("access.reason"), type: "textarea", optional: true }]}
          submitLabel={t("access.reject")}
          onClose={() => setModal(null)}
          onSubmit={async (v) => {
            await post(`/access-requests/${modal.request.id}/decide`, { decision: "reject", ...v });
            setModal(null);
            list.reload();
          }}
        />
      )}
      {link && (
        <Modal title={t("access.handOver")} onClose={() => setLink(null)}>
          <p>{link.emailed ? t("access.emailed", { email: link.who }) : t("access.giveInPerson", { email: link.who })}</p>
          <p>
            <code style={{ wordBreak: "break-all" }}>{link.link}</code>
          </p>
          <div className="actions">
            <button onClick={() => void navigator.clipboard?.writeText(link.link)}>{t("access.copy")}</button>
            <button className="primary" onClick={() => setLink(null)}>
              {t("access.done")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

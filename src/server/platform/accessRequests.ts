import { AppError } from "../kernel/errors";
import type { AccessRequestsGateway, AccessRequestView } from "../providers/core";
import type { IntraForgeClient } from "./intraforge";

const PATH = "/access-requests/";

/** IntraForge's access requests made from this app (ADR-0026), through the internal service API. IntraForge decides
 * who may see and decide them (users.manage and permissions.manage for the signed-in person). */
export class PlatformAccessRequests implements AccessRequestsGateway {
  constructor(private readonly client: IntraForgeClient) {}

  async list(actorId: string) {
    const { status, data } = await this.client.json<{
      results?: AccessRequestView[];
      roles?: { slug: string; name: string; summary: string }[];
      detail?: string;
    }>("GET", `${PATH}?actorId=${encodeURIComponent(actorId)}`, undefined, [200, 403]);
    if (status === 403) return { results: [], roles: [] };
    return { results: data.results ?? [], roles: data.roles ?? [] };
  }

  async decide(input: {
    actorId: string;
    requestId: string;
    decision: "approve" | "reject" | "link";
    roleSlug?: string;
    note?: string;
    origin: string;
  }) {
    const { status, data } = await this.client.json<{
      link?: string | null;
      emailed?: boolean;
      detail?: string;
    }>("POST", PATH, input, [200, 400, 403, 404, 409]);
    if (status !== 200) {
      const message = data?.detail || "This request could not be decided.";
      if (status === 403) throw new AppError("FORBIDDEN", message, 403);
      if (status === 404) throw new AppError("NOT_FOUND", message, 404);
      if (status === 409) throw new AppError("CONFLICT", message, 409);
      throw new AppError("VALIDATION", message, 400);
    }
    return { link: data.link ?? null, emailed: Boolean(data.emailed) };
  }
}

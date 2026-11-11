import { AppError } from "../kernel/errors";
import type { PayCharge, PayGateway } from "../providers/core";
import type { IntraForgeClient } from "./intraforge";

/**
 * IntraForge Pay through IntraForge (its internal service-app API, ADR-0018):
 * Spare Parts never talks to Pay itself. IntraForge picks the Pay installed in
 * this same shop, checks the person may take Pay payments there, and answers a
 * status question only for payments this Spare Parts asked for.
 */
interface Answer {
  id: string;
  status: PayCharge["status"];
  amount_minor: number;
  receipt_number: string | null;
  expires_at: string;
  merchant?: { name?: string | null };
  notice?: string;
  code?: string;
  qr_svg?: string;
}

const PATH = "/pay/payment-requests/";

export class PlatformPayGateway implements PayGateway {
  constructor(private readonly client: IntraForgeClient) {}

  async create(input: {
    actorId: string;
    amountMinor: number;
    reference: string;
    externalId: string;
  }): Promise<PayCharge> {
    const { status, data } = await this.client.json<Answer>(
      "POST",
      PATH,
      input,
      [201, 403, 404, 409, 503],
    );
    if (status !== 201) throw refusal(status, data);
    return charge(data);
  }

  async status(requestId: string): Promise<PayCharge> {
    const { status, data } = await this.client.json<Answer>(
      "GET",
      `${PATH}${encodeURIComponent(requestId)}/`,
      undefined,
      [200, 403, 404, 409, 503],
    );
    if (status !== 200) throw refusal(status, data);
    return charge(data);
  }
}

function charge(d: Answer): PayCharge {
  if (!d || typeof d.id !== "string" || !Number.isInteger(d.amount_minor))
    throw refusal(503, null);
  return {
    requestId: d.id,
    status: d.status,
    amountMinor: d.amount_minor,
    receiptNumber: d.receipt_number ?? null,
    expiresAt: d.expires_at,
    shopName: d.merchant?.name ?? null,
    notice: d.notice ?? "SIMULATED VALUE — NO CASH VALUE",
    code: d.code,
    qrSvg: d.qr_svg,
  };
}

/** IntraForge's refusal, in its own words (it never contains a secret). */
function refusal(status: number, data: unknown): AppError {
  const message = messageOf(data);
  if (status === 403)
    return new AppError(
      "FORBIDDEN",
      message ?? "You may not take IntraForge Pay payments in this shop.",
      403,
    );
  if (status === 404)
    return new AppError(
      "PAY_NOT_FOUND",
      message ?? "IntraForge Pay is not installed in this shop.",
      404,
    );
  if (status === 409)
    return new AppError(
      "PAY_REFUSED",
      message ?? "IntraForge Pay refused this payment.",
      409,
    );
  return new AppError(
    "PAY_UNAVAILABLE",
    "IntraForge Pay is not answering. Try again in a moment.",
    503,
  );
}

function messageOf(data: unknown): string | null {
  const err = (data as { error?: { message?: unknown } } | null)?.error
    ?.message;
  if (typeof err === "string") return err.slice(0, 300);
  if (err && typeof err === "object") {
    const detail = (err as Record<string, unknown>).detail;
    if (typeof detail === "string") return detail.slice(0, 300);
    const first = Object.values(err as Record<string, unknown>)[0];
    if (Array.isArray(first) && typeof first[0] === "string")
      return first[0].slice(0, 300);
  }
  return null;
}

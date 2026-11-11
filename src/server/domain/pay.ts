import type { PayCharge, PayGateway } from "../providers/core";
import type { UnitOfWork } from "../providers/uow";
import { AppError, conflict, notFound } from "../kernel/errors";
import { newId, nowIso } from "../kernel/ids";
import { can, requirePermission } from "./permissions";
import { applyPayment } from "./sales";
import type { Actor, Invoice, PayRequest } from "./types";

/** What the invoice screen shows while a Pay payment is open. */
export interface PayView {
  id: string;
  status: PayRequest["status"];
  amountMinor: number;
  receiptNumber: string;
  expiresAt?: string;
  shopName?: string | null;
  notice?: string;
  qrSvg?: string;
  code?: string;
  invoice?: Invoice;
}

const unavailable = () =>
  new AppError(
    "PAY_UNAVAILABLE",
    "IntraForge Pay is not available in this shop. Record the payment another way.",
    503,
  );

/**
 * Taking an invoice's payment with IntraForge Pay (platform mode).
 *
 * The shop shows a Pay QR for the invoice balance; the customer pays it in
 * their own wallet. The invoice is marked paid ONLY when Pay itself confirms
 * the payment, asked server-side through IntraForge -- never because a browser
 * says so -- and each Pay payment is recorded on the invoice at most once.
 */
export class PayService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly gateway?: PayGateway,
  ) {}

  get available() {
    return !!this.gateway;
  }

  async start(actor: Actor, invoiceId: string): Promise<PayView> {
    requirePermission(actor, "payments.record");
    const gateway = this.gateway;
    if (!gateway) throw unavailable();
    // An earlier QR for this invoice may have been paid after its window was closed: settle it first, so
    // the new QR asks only for what is really still due -- never a second charge for the same amount.
    await this.refreshPending(actor, invoiceId);
    const invoice = await this.uow.read((r) => r.sales.getInvoice(invoiceId));
    if (!invoice) throw notFound("Invoice");
    if (invoice.status === "VOID")
      throw conflict("A void invoice cannot take payments.");
    if (invoice.status === "PAID" || invoice.balanceMinor <= 0)
      throw conflict("This invoice is already paid in full.");
    const charge = await gateway.create({
      actorId: actor.id,
      amountMinor: invoice.balanceMinor,
      reference: `Invoice ${invoice.number}`,
      externalId: invoice.id,
    });
    const now = nowIso();
    const row: PayRequest = {
      id: newId(),
      invoiceId,
      requestId: charge.requestId,
      amountMinor: invoice.balanceMinor,
      status: "PENDING",
      receiptNumber: "",
      paymentId: null,
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
    };
    await this.uow.write(async (r) => {
      await r.sales.insertPayRequest(row);
      await r.audit.record(actor, {
        action: "payment.pay_request",
        entityType: "invoice",
        entityId: invoiceId,
        summary: `IntraForge Pay QR shown for ${invoice.number}`,
        metadata: {
          amountMinor: row.amountMinor,
          payRequestId: charge.requestId,
        },
      });
    });
    return { ...view(row, charge), qrSvg: charge.qrSvg, code: charge.code };
  }

  async check(actor: Actor, invoiceId: string, id: string): Promise<PayView> {
    requirePermission(actor, "payments.record");
    const gateway = this.gateway;
    if (!gateway) throw unavailable();
    const row = await this.uow.read((r) => r.sales.getPayRequest(id));
    if (!row || row.invoiceId !== invoiceId) throw notFound("Payment");
    if (row.status !== "PENDING") return view(row);
    const charge = await gateway.status(row.requestId);
    if (charge.status === "expired" || charge.status === "cancelled") {
      const status = charge.status === "expired" ? "EXPIRED" : "CANCELLED";
      await this.uow.write((r) => r.sales.closePayRequest(id, status));
      return view({ ...row, status }, charge);
    }
    if (charge.status !== "paid") return view(row, charge);
    if (charge.amountMinor !== row.amountMinor)
      throw conflict(
        "IntraForge Pay reports a different amount for this payment. Check the Pay receipt before recording anything.",
      );
    const receipt = charge.receiptNumber ?? "";
    try {
      const { invoice } = await this.uow.write(async (r) => {
        // Another check may have recorded it while Pay was being asked.
        const current = await r.sales.getPayRequest(id);
        if (current?.status !== "PENDING") throw new AlreadySettled();
        const result = await applyPayment(
          r,
          actor,
          invoiceId,
          {
            amountMinor: row.amountMinor,
            method: "OTHER",
            reference: `IntraForge Pay ${receipt}`.trim(),
            paidAt: nowIso().slice(0, 10),
            notes:
              "Paid with IF Credits through IntraForge Pay (simulated value, no cash value).",
          },
          {
            summary: `IntraForge Pay payment ${receipt} recorded on the invoice`,
            metadata: { payRequestId: row.requestId, payReceipt: receipt },
          },
        );
        if (!(await r.sales.settlePayRequest(id, result.payment.id, receipt)))
          throw new AlreadySettled();
        return result;
      });
      return {
        ...view({ ...row, status: "PAID", receiptNumber: receipt }, charge),
        invoice,
      };
    } catch (e) {
      const now = await this.uow.read((r) => r.sales.getPayRequest(id));
      // Recorded by a concurrent check (it committed first): that is success.
      if (e instanceof AlreadySettled || now?.status === "PAID")
        return view(now ?? row);
      if (
        e instanceof AppError &&
        (e.status === 409 || e.code === "VALIDATION")
      )
        throw conflict(
          `The customer paid with IntraForge Pay (receipt ${receipt}), but the invoice can no longer take it: ${e.message} Record it by hand after checking the invoice.`,
        );
      throw e;
    }
  }

  async list(actor: Actor, invoiceId: string) {
    requirePermission(actor, "invoices.read");
    // Opening the invoice brings open QRs up to date (paid / expired) for staff who may record payments,
    // so a QR whose window was closed does not stay "pending" until someone checks it by hand.
    if (this.gateway && can(actor, "payments.record"))
      await this.refreshPending(actor, invoiceId);
    return this.uow.read((r) => r.sales.payRequestsForInvoice(invoiceId));
  }

  /** Asks Pay about every open QR of the invoice; one that cannot be checked right now stays open. */
  private async refreshPending(actor: Actor, invoiceId: string) {
    const open = (
      await this.uow.read((r) => r.sales.payRequestsForInvoice(invoiceId))
    ).filter((row) => row.status === "PENDING");
    for (const row of open) {
      try {
        await this.check(actor, invoiceId, row.id);
      } catch {
        // Pay unreachable or the invoice changed: left open, shown as it is; never blocks the screen
      }
    }
  }
}

class AlreadySettled extends Error {}

function view(row: PayRequest, charge?: PayCharge): PayView {
  return {
    id: row.id,
    status: row.status,
    amountMinor: row.amountMinor,
    receiptNumber: row.receiptNumber,
    expiresAt: charge?.expiresAt,
    shopName: charge?.shopName,
    notice: charge?.notice,
  };
}

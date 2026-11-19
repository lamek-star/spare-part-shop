"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Money, useToast } from "./kit";
import { post } from "./api";
import { useT } from "./i18n";

interface PayView {
  id: string;
  status: "PENDING" | "PAID" | "EXPIRED" | "CANCELLED";
  amountMinor: number;
  receiptNumber: string;
  expiresAt?: string;
  shopName?: string | null;
  notice?: string;
  qrSvg?: string;
}

const EVERY_MS = 2000;

/**
 * "Take payment with IntraForge Pay": shows the Pay QR for the invoice
 * balance and asks this server every two seconds whether the customer has
 * paid it. The server asks IntraForge Pay itself and records the payment;
 * this screen only displays what the server says.
 */
export function PayWithPay({
  invoiceId,
  currency,
  onPaid,
  onClose,
}: {
  invoiceId: string;
  currency: string;
  onPaid: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [pay, setPay] = useState<PayView | null>(null);
  const [qr, setQr] = useState<string | undefined>();
  const [error, setError] = useState("");
  const tr = useT();
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const start = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const shown = await post<PayView>(`/invoices/${invoiceId}/pay`);
      if (!alive.current) return;
      setPay(shown);
      setQr(shown.qrSvg);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    if (!pay || pay.status !== "PENDING") return;
    const t = setTimeout(async () => {
      try {
        const now = await post<PayView>(
          `/invoices/${invoiceId}/pay/${pay.id}/check`,
        );
        if (!alive.current) return;
        setPay({ ...pay, ...now });
        if (now.status === "PAID") {
          toast(tr("pay.paidToast", { receipt: now.receiptNumber ?? "" }));
          onPaid();
        }
      } catch (e) {
        if (alive.current) setError((e as Error).message);
      }
    }, EVERY_MS);
    return () => clearTimeout(t);
  }, [pay, invoiceId, onPaid, toast, tr]);

  return (
    <Modal title={tr("pay.title")} onClose={onClose}>
      <div style={{ textAlign: "center" }}>
        <p className="muted" role="note">
          <strong>{tr("pay.simulated")}</strong> {tr("pay.simulatedHelp")}
        </p>
        {pay && (
          <p style={{ fontSize: 22, fontWeight: 700, margin: "8px 0" }}>
            <Money minor={pay.amountMinor} currency={currency} />
          </p>
        )}
        {pay?.status === "PENDING" && qr && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: QR from Pay */}
            <img
              src={qr}
              alt={tr("pay.qrAlt")}
              width={240}
              height={240}
              style={{ imageRendering: "pixelated" }}
            />
            <p>{tr("pay.scan")}</p>
            {pay.expiresAt && (
              <p className="muted">
                {tr("pay.expiresAt", {
                  time: new Date(pay.expiresAt).toLocaleTimeString(),
                })}
              </p>
            )}
          </>
        )}
        {pay?.status === "PAID" && (
          <p role="status">
            <strong>{tr("pay.paid")}</strong>{" "}
            {tr("pay.paidHelp", { receipt: pay.receiptNumber ?? "" })}
          </p>
        )}
        {(pay?.status === "EXPIRED" || pay?.status === "CANCELLED") && (
          <p role="status">
            {pay.status === "EXPIRED" ? tr("pay.expired") : tr("pay.cancelled")}
          </p>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="form-actions">
        {(pay?.status === "EXPIRED" ||
          pay?.status === "CANCELLED" ||
          (!pay && error)) && (
          <button className="primary" disabled={busy} onClick={start}>
            {tr("pay.newCode")}
          </button>
        )}
        <button onClick={onClose}>
          {pay?.status === "PAID" ? tr("common.done") : tr("common.close")}
        </button>
      </div>
    </Modal>
  );
}

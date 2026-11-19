"use client";
import { useT } from "../ui/i18n";
export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const t = useT();
  return (
    <main className="boot">
      <h1>{t("errors.unableToDisplayThisWorkspace")}</h1>
      <p>{t("errors.anUnexpectedErrorInterruptedThe")}</p>
      <button className="primary" onClick={reset}>
        {t("errors.tryAgain")}
      </button>
    </main>
  );
}

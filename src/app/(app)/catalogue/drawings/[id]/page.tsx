"use client";
import Link from "next/link";
import { use } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { DrawingViewer, type DrawingDetail } from "../../../../../ui/catalogue";
import { ErrorBanner, Loading, PageHead, useApi } from "../../../../../ui/kit";
import { useT } from "../../../../../ui/i18n";

function Inner({ id }: { id: string }) {
  const t = useT();
  const part = useSearchParams().get("part") ?? "";
  const d = useApi<DrawingDetail>(`/catalogue/drawings/${id}`);
  if (d.loading && !d.data) return <Loading />;
  if (!d.data)
    return <ErrorBanner message={d.error || t("cat.drawingNotFound")} />;
  return (
    <>
      <PageHead
        title={`Drawing ${d.data.code}`}
        subtitle={d.data.title}
        back={
          part
            ? {
                href: `/catalogue/parts/${part}`,
                label: t("prod.referencePart"),
              }
            : { href: "/catalogue", label: t("nav.catalogue") }
        }
        actions={
          <Link className="button" href="/catalogue">
            {t("cat.searchCatalogue")}
          </Link>
        }
      />
      <DrawingViewer drawing={d.data} highlightPartId={part} />
    </>
  );
}
export default function DrawingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <Suspense fallback={<Loading />}>
      <Inner id={id} />
    </Suspense>
  );
}

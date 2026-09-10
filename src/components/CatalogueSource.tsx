import { Part } from "../domain/models";
export default function CatalogueSource({ part }: { part: Part }) {
  const source = part.catalogueSource;
  if (!source) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Supplier catalogue data</h3>
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="text-link"
        >
          View Nengun source
        </a>
      </div>
      <div className="detail-grid">
        <dl>
          {[
            ["Diagram code", source.diagramCode],
            [
              "Supplier price (JPY)",
              source.priceJpy === null
                ? "Not quoted"
                : `${source.priceJpy.toLocaleString()} JPY`,
            ],
            ["Supplier status", source.availability],
            ["Quantity required", source.quantityRequired ?? "Not supplied"],
            ["Captured", source.observedAt],
          ].map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <div>
          <h3>Applicability as published</h3>
          <p>{source.applicability || "Not supplied for this reference."}</p>
          <h3>Specification</h3>
          <p>{source.specification || "Not supplied"}</p>
          <a
            className="text-link"
            href={source.diagramUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open full headlamp parts table
          </a>
        </div>
      </div>
      <p className="notice">
        Supplier-listed data, not independently manufacturer-verified. The
        shared illustration identifies the assembly; it is not a photo of each
        item. JPY quotes are dated source information, excluding any unstated
        charges. Set your AED business prices before ordering or selling.
      </p>
    </section>
  );
}

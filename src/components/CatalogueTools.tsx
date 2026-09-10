"use client";
import { useState, useRef } from "react";
import { Part } from "../domain/models";
import { Services } from "../services/contracts";
import { uid } from "../adapters/demo";
import { Field } from "./ui";
export function SupersessionForm({
  part,
  services,
  done,
}: {
  part: Part;
  services: Services;
  done: () => void;
}) {
  const [error, setError] = useState("");
  const numbers = services
    .snapshot()
    .numbers.filter((n) => n.partId === part.id);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        try {
          await services.catalogue.supersede(
            String(f.get("old")),
            String(f.get("next")),
          );
          done();
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <p className="notice">
        Link a previous number to its replacement. Circular chains are rejected.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {["old", "next"].map((key) => (
        <Field
          key={key}
          label={key === "old" ? "Previous number" : "Replacement number"}
        >
          <select name={key}>
            {numbers.map((n) => (
              <option value={n.id} key={n.id}>
                {n.display} · {n.type}
              </option>
            ))}
          </select>
        </Field>
      ))}
      <button className="primary">Save supersession</button>
    </form>
  );
}
export function CompatibilityForm({
  part,
  services,
  done,
}: {
  part?: Part;
  services: Services;
  done: () => void;
}) {
  const [error, setError] = useState("");
  const [newVehicle, setNewVehicle] = useState(false);
  const s = services.snapshot();
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const v = (k: string) => String(f.get(k) ?? "");
        try {
          if (newVehicle) {
            await services.compatibility.saveVehicle({
              id: uid(),
              make: v("make"),
              model: v("model"),
              variant: v("variant"),
              from: Number(v("from")),
              to: Number(v("to")),
              engine: v("engine"),
              engineCode: v("engineCode"),
              transmission: v("transmission"),
            });
            setNewVehicle(false);
          } else {
            await services.compatibility.link({
              id: uid(),
              partId: part?.id ?? v("partId"),
              vehicleId: v("vehicleId"),
              notes: v("notes"),
              source: "Manual Entry · Unverified demo",
            });
            done();
          }
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {newVehicle ? (
        <div className="form-grid">
          {[
            "make",
            "model",
            "variant",
            "from",
            "to",
            "engine",
            "engineCode",
            "transmission",
          ].map((k) => (
            <Field key={k} label={k}>
              <input
                name={k}
                required={["make", "model", "from", "to"].includes(k)}
                type={["from", "to"].includes(k) ? "number" : "text"}
                defaultValue={k === "from" ? 2015 : k === "to" ? 2026 : ""}
              />
            </Field>
          ))}
        </div>
      ) : (
        <>
          {!part && (
            <Field label="Part">
              <select name="partId">
                {s.parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} · {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Vehicle">
            <select name="vehicleId">
              {s.vehicles.map((v) => (
                <option value={v.id} key={v.id}>
                  {v.make} {v.model} · {v.variant} · {v.from}–{v.to}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <textarea
              name="notes"
              defaultValue="Unverified fitment. Confirm against authoritative catalogue."
            />
          </Field>
        </>
      )}
      <div className="actions">
        <button className="primary">
          {newVehicle ? "Save vehicle" : "Link compatibility"}
        </button>
        <button type="button" onClick={() => setNewVehicle(!newVehicle)}>
          {newVehicle ? "Choose existing vehicle" : "Create vehicle"}
        </button>
      </div>
    </form>
  );
}
export function Gallery({
  part,
  services,
  onEdit,
}: {
  part: Part;
  services: Services;
  onEdit?: () => void;
}) {
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const replaceIndex = useRef<number | null>(null);
  const current = Math.min(selected, Math.max(0, part.images.length - 1));
  const save = async (images: string[]) => {
    setBusy(true);
    try {
      const latest = services.snapshot().parts.find((p) => p.id === part.id);
      if (!latest) throw new Error("Part no longer exists.");
      await services.catalogue.save({ ...latest, images });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const choose = (replace: boolean) => {
    replaceIndex.current = replace ? current : null;
    fileInput.current?.click();
  };
  return (
    <section
      className="diagram-editor"
      aria-label="Item images and assembly diagram"
    >
      <div className="panel-head">
        <div>
          <h3>Item images & assembly diagram</h3>
          <small>
            {part.catalogueSource
              ? "Shared assembly illustration; match the callout to the reference below."
              : "Add product photos or an assembly drawing."}
          </small>
        </div>
        <div className="actions">
          {onEdit && <button onClick={onEdit}>Edit item information</button>}
          <button
            className="primary"
            disabled={busy}
            onClick={() => choose(false)}
          >
            Add image
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <input
        ref={fileInput}
        type="file"
        hidden
        aria-label="Upload item image"
        accept="image/png,image/jpeg,image/webp"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (
            file.size > 1_000_000 ||
            !["image/png", "image/jpeg", "image/webp"].includes(file.type)
          ) {
            setError("Choose a PNG, JPEG or WebP image smaller than 1 MB.");
            return;
          }
          const index = replaceIndex.current;
          const reader = new FileReader();
          reader.onload = async () => {
            const latest = services
              .snapshot()
              .parts.find((p) => p.id === part.id)!;
            const images = [...latest.images];
            if (index === null) {
              images.push(String(reader.result));
              setSelected(images.length - 1);
            } else images[index] = String(reader.result);
            await save(images);
            setZoom(1);
          };
          reader.onerror = () => setError("Image could not be read.");
          reader.readAsDataURL(file);
        }}
      />
      <div className="diagram-toolbar">
        <span>
          {part.catalogueSource
            ? "Callout " + part.catalogueSource.diagramCode
            : part.sku}
        </span>
        <div className="actions">
          <button
            aria-label="Zoom out"
            disabled={zoom <= 1}
            onClick={() => setZoom(Math.max(1, zoom - 0.5))}
          >
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            aria-label="Zoom in"
            disabled={zoom >= 3}
            onClick={() => setZoom(Math.min(3, zoom + 0.5))}
          >
            +
          </button>
          <button onClick={() => setZoom(1)}>Fit image</button>
        </div>
      </div>
      <div className="diagram-canvas">
        {part.images[current] ? (
          <img
            src={part.images[current]}
            alt={part.name + " assembly or item image"}
            style={{ width: zoom * 100 + "%", maxWidth: "none" }}
          />
        ) : (
          <p className="empty">No image attached. Add an image to this item.</p>
        )}
      </div>
      <div className="diagram-caption">
        <strong>{part.name}</strong>
        <span>{part.catalogueSource?.applicability || part.sku}</span>
      </div>
      <div className="image-thumbnails">
        {part.images.map((url, i) => (
          <button
            key={i}
            aria-label={"View image " + (i + 1)}
            aria-pressed={current === i}
            onClick={() => {
              setSelected(i);
              setZoom(1);
            }}
          >
            <img src={url} alt="" />
            <small>{i === 0 ? "Primary" : "Image " + (i + 1)}</small>
          </button>
        ))}
      </div>
      {part.images.length > 0 && (
        <div className="actions">
          <button disabled={busy} onClick={() => choose(true)}>
            Replace selected image
          </button>
          <button
            disabled={busy || current === 0}
            onClick={async () => {
              await save([
                part.images[current],
                ...part.images.filter((_, i) => i !== current),
              ]);
              setSelected(0);
            }}
          >
            Make primary
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              await save(part.images.filter((_, i) => i !== current));
              setSelected(0);
            }}
          >
            Remove selected image
          </button>
        </div>
      )}
      <p className="muted image-help">
        Your edits are saved to this item in the local workspace. The original
        supplier source record is retained.
      </p>
    </section>
  );
}

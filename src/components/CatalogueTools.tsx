"use client";
import { useState } from "react";
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
}: {
  part: Part;
  services: Services;
}) {
  const [error, setError] = useState("");
  return (
    <>
      <p className="muted">
        The first image is used as the primary thumbnail. Image URLs are
        supplied by the data adapter.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <label className="button">
        Add image
        <input
          className="file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (
              file.size > 1_000_000 ||
              !["image/png", "image/jpeg", "image/webp"].includes(file.type)
            ) {
              setError("Choose a PNG, JPEG or WebP image smaller than 1 MB.");
              return;
            }
            const reader = new FileReader();
            reader.onload = async () => {
              try {
                await services.catalogue.save({
                  ...part,
                  images: [...part.images, String(reader.result)],
                });
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            };
            reader.onerror = () => setError("Image could not be read.");
            reader.readAsDataURL(file);
            e.target.value = "";
          }}
        />
      </label>
      <div className="gallery">
        {part.images.map((url, i) => (
          <figure key={`${i}-${url.slice(0, 30)}`}>
            <img
              src={url}
              alt={`${part.name} ${i === 0 ? "primary image" : `image ${i + 1}`}`}
            />
            <figcaption>
              {i === 0 ? (
                "Primary image"
              ) : (
                <button
                  onClick={async () => {
                    try {
                      await services.catalogue.save({
                        ...part,
                        images: [url, ...part.images.filter((_, j) => j !== i)],
                      });
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Make primary
                </button>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
    </>
  );
}

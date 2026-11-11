import { AppError, notFound, validation } from "../kernel/errors";
import { permissionsOf, requirePermission } from "../domain/permissions";
import { toCsv } from "../catalogue/csv";
import { edition } from "../edition";
import { code128Svg } from "../labels/code128";
import { qrSvg } from "../labels/qr";
import { PackageError, ZipSource } from "../catalogue/packageSource";
import type {
  ColumnMapping,
  CatalogueSearchQuery,
  RowStatus,
  StatusClass,
} from "../catalogue/model";
import type { Actor, Role } from "../domain/types";
import { loadSampleData } from "../dev/sampleData";
import { Router, type Ctx, type Query } from "./core";

/**
 * Every endpoint of the standalone API, in one place. Reading this file
 * answers "what can a client do and which permission does it need".
 */
export const UPLOAD_LIMIT = 64 * 1024 * 1024;
export const PACKAGE_LIMIT = 1024 * 1024 * 1024;
const IMAGE_LIMIT = 8 * 1024 * 1024;
const CSV_LIMIT = 32 * 1024 * 1024;

const paged = (q: Query) => ({
  page: q.int("page"),
  pageSize: q.int("pageSize"),
  q: q.str("q"),
});
const nul = (v: unknown) => (typeof v === "string" ? v : undefined);

async function uploadedFile(
  ctx: Ctx,
  field = "file",
): Promise<{ form: FormData; name: string; bytes: Uint8Array }> {
  const form = await ctx.form();
  const f = form.get(field);
  if (!f || typeof f === "string") throw validation("Choose a file to upload.");
  return {
    form,
    name: (f as File).name || "upload",
    bytes: new Uint8Array(await (f as File).arrayBuffer()),
  };
}
const flag = (form: FormData, name: string) =>
  /^(1|true|on|yes)$/i.test(String(form.get(name) ?? ""));
const formText = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};
function packageSource(bytes: Uint8Array) {
  try {
    return new ZipSource(bytes);
  } catch (e) {
    if (e instanceof PackageError) throw validation(e.message);
    throw e;
  }
}

export const sampleDataEnabled = () =>
  process.env.SPAREPARTS_ENABLE_SAMPLE_DATA === "1" &&
  process.env.NODE_ENV !== "production";

const running = new Map<string, Promise<unknown>>();

export function buildRouter(): Router {
  const r = new Router();

  // ------------------------------------------------------------ auth
  r.get("/health", { public: true, noBoot: true }, () => ({
    data: { status: "ok" },
  }));
  r.get("/auth/status", { public: true }, async (c) => {
    const configured = await c.app.identity.hasAnyUser();
    const self = (
      c.container as { self?: { app?: { id: string; display_name: string } } }
    ).self;
    return {
      data: {
        needsSetup: !configured,
        edition: edition(),
        shopName: configured
          ? (await c.container.repos.config.get()).shopName
          : "",
        // On IntraForge there is no sign-in page here: people sign in to
        // IntraForge and press Open, which lands them back signed in.
        ...(self?.app
          ? {
              platform: {
                openUrl: `/service-apps/${encodeURIComponent(self.app.id)}/open`,
              },
            }
          : {}),
      },
    };
  });
  r.post("/auth/setup", { public: true }, async (c) => {
    const b = await c.json();
    if (await c.app.identity.hasAnyUser())
      throw new AppError("FORBIDDEN", "Setup has already been completed.", 403);
    const user = await c.app.identity.createUser(null, {
      email: String(b.email ?? ""),
      displayName: String(b.displayName ?? ""),
      role: "OWNER",
      password: String(b.password ?? ""),
    });
    if (typeof b.shopName === "string" && b.shopName.trim())
      await c.app.settings.update(user, { shopName: b.shopName.trim() });
    const { token, session } = await c.app.identity.signIn({
      email: String(b.email),
      password: String(b.password),
      ip: c.ip,
      userAgent: c.req.headers.get("user-agent"),
    });
    c.setSession(token);
    return { status: 201, data: sessionView(session) };
  });
  r.post("/auth/login", { public: true }, async (c) => {
    const b = await c.json();
    const { token, session } = await c.app.identity.signIn({
      email: String(b.email ?? ""),
      password: String(b.password ?? ""),
      ip: c.ip,
      userAgent: c.req.headers.get("user-agent"),
    });
    c.setSession(token);
    return { data: sessionView(session) };
  });
  r.post("/auth/logout", { allowMustChange: true }, async (c) => {
    if (c.sessionToken) await c.app.identity.signOut(c.sessionToken);
    c.setSession(null);
    return { status: 204 };
  });
  r.get("/auth/me", { allowMustChange: true }, async (c) => ({
    data: {
      ...sessionView(c.session!),
      edition: edition(),
      shopName: (await c.container.repos.config.get()).shopName,
      features: { sampleData: sampleDataEnabled() },
    },
  }));
  r.post("/auth/password", { allowMustChange: true }, async (c) => {
    const b = await c.json();
    await c.app.identity.changePassword(
      c.actor.id,
      String(b.currentPassword ?? ""),
      String(b.newPassword ?? ""),
    );
    c.setSession(null);
    return { data: { changed: true, signInAgain: true } };
  });

  // Development only: refuses (404) unless explicitly enabled, and never in production.
  r.post("/dev/sample-data", { permission: "settings.manage" }, async (c) => {
    if (!sampleDataEnabled()) throw notFound("Endpoint");
    return { status: 201, data: await loadSampleData(c.app, c.actor) };
  });

  // ------------------------------------------------------------ users / settings / audit
  r.get("/users", { permission: "users.manage" }, async (c) => ({
    data: await c.app.users.list(c.actor),
  }));
  r.post("/users", { permission: "users.manage" }, async (c) => {
    const b = await c.json();
    return {
      status: 201,
      data: await c.app.users.create(c.actor, {
        email: String(b.email ?? ""),
        displayName: String(b.displayName ?? ""),
        role: b.role as Role,
        password: String(b.password ?? ""),
        mustChangePassword: b.mustChangePassword === false ? false : true,
      }),
    };
  });
  r.patch("/users/:id", { permission: "users.manage" }, async (c) => {
    const b = await c.json();
    return {
      data: await c.app.users.update(c.actor, c.params.id, {
        displayName: nul(b.displayName),
        role: b.role as Role | undefined,
        status: b.status as "ACTIVE" | "DISABLED" | undefined,
        password: nul(b.password),
      }),
    };
  });
  r.get("/settings", { permission: "settings.read" }, async (c) => ({
    data: await c.app.settings.get(c.actor),
  }));
  r.put("/settings", { permission: "settings.manage" }, async (c) => ({
    data: await c.app.settings.update(c.actor, (await c.json()) as never),
  }));
  r.get("/audit", { permission: "audit.read" }, async (c) => ({
    data: await c.app.audit.query(c.actor, {
      entityType: c.query.str("entityType"),
      entityId: c.query.str("entityId"),
      actorId: c.query.str("actorId"),
      limit: c.query.int("limit"),
      before: c.query.str("before"),
    }),
  }));

  // ------------------------------------------------------------ reference catalogue
  r.get("/catalogue/search", { permission: "catalogue.read" }, async (c) => {
    const q = c.query;
    const query: CatalogueSearchQuery = {
      q: q.str("q"),
      page: q.int("page"),
      pageSize: q.int("pageSize"),
      manufacturer: q.str("manufacturer"),
      model: q.str("model"),
      chassis: q.str("chassis"),
      engine: q.str("engine"),
      year: q.int("year"),
      market: q.str("market"),
      section: q.str("section"),
      status: q.str("status") as StatusClass | undefined,
      hasDrawing: q.bool("hasDrawing"),
    };
    return { data: await c.app.catalogue.search(c.actor, query) };
  });
  r.get("/catalogue/browse", { permission: "catalogue.read" }, async (c) => ({
    data: await c.app.catalogue.browse(c.actor, {
      manufacturer: c.query.str("manufacturer"),
      model: c.query.str("model"),
      chassis: c.query.str("chassis"),
    }),
  }));
  r.get("/catalogue/stats", { permission: "catalogue.read" }, async (c) => ({
    data: await c.app.catalogue.stats(c.actor),
  }));
  r.post("/catalogue/parts", { permission: "catalogue.import" }, async (c) => ({
    status: 201,
    data: await c.app.catalogueImport.addManual(c.actor, await c.json()),
  }));
  r.get(
    "/catalogue/parts/by-oem/:oem",
    { permission: "catalogue.read" },
    async (c) => {
      const p = await c.app.catalogue.partByOem(c.actor, c.params.oem);
      if (!p) throw notFound("Reference part");
      return { data: p };
    },
  );
  r.get(
    "/catalogue/parts/:id",
    { permission: "catalogue.read" },
    async (c) => ({ data: await c.app.catalogue.part(c.actor, c.params.id) }),
  );
  r.put(
    "/catalogue/parts/:id/verification",
    { permission: "catalogue.admin" },
    async (c) => {
      await c.app.catalogue.setVerification(
        c.actor,
        c.params.id,
        (await c.json()).status,
      );
      return { data: { ok: true } };
    },
  );
  r.post(
    "/catalogue/parts/:id/import-to-products",
    { permission: "products.write" },
    async (c) => ({
      status: 201,
      data: await c.app.products.importFromReference(
        c.actor,
        c.params.id,
        await c.json(),
      ),
    }),
  );
  r.get(
    "/catalogue/drawings/:id",
    { permission: "catalogue.read" },
    async (c) => ({
      data: await c.app.catalogue.drawing(c.actor, c.params.id),
    }),
  );
  r.get("/catalogue/assets", { permission: "catalogue.admin" }, async (c) => ({
    data: await c.app.catalogue.assets(
      c.actor,
      c.query.int("page") ?? 1,
      c.query.int("pageSize") ?? 50,
    ),
  }));
  r.get(
    "/catalogue/assets/:id",
    { permission: "catalogue.read" },
    async (c) => {
      const a = await c.app.catalogue.assetBytes(c.actor, c.params.id);
      if (!a) throw notFound("Image");
      return { binary: { bytes: a.bytes, mime: a.mime, inline: true } };
    },
  );
  r.put(
    "/catalogue/assets/:id/rights",
    { permission: "catalogue.admin" },
    async (c) => {
      const b = await c.json();
      await c.app.catalogue.setImageRights(
        c.actor,
        c.params.id,
        b.rights,
        b.evidence,
      );
      return { data: { ok: true } };
    },
  );
  r.get("/catalogue/sources", { permission: "catalogue.read" }, async (c) => ({
    data: await c.app.catalogue.sources(c.actor),
  }));
  r.put("/catalogue/sources", { permission: "catalogue.admin" }, async (c) => ({
    data: await c.app.catalogue.saveSource(c.actor, await c.json()),
  }));

  // ------------------------------------------------------------ catalogue import
  r.post(
    "/catalogue/import/detect",
    { permission: "catalogue.import", maxBytes: CSV_LIMIT },
    async (c) => {
      const f = await uploadedFile(c);
      return { data: await c.app.catalogueImport.detect(c.actor, f.bytes) };
    },
  );
  r.post(
    "/catalogue/import/jobs",
    { permission: "catalogue.import", maxBytes: CSV_LIMIT },
    async (c) => {
      const f = await uploadedFile(c);
      let mapping: unknown;
      try {
        mapping = JSON.parse(formText(f.form, "mapping") ?? "null");
      } catch {
        throw validation("The column mapping is not valid JSON.");
      }
      const job = await c.app.catalogueImport.stageCsv(c.actor, {
        content: f.bytes,
        fileName: f.name,
        mapping: mapping as ColumnMapping,
        attested: flag(f.form, "attested"),
        defaultManufacturer: formText(f.form, "defaultManufacturer"),
        defaultSource: formText(f.form, "defaultSource"),
        defaultMarket: formText(f.form, "defaultMarket"),
      });
      return { status: 201, data: job };
    },
  );
  r.get(
    "/catalogue/import/jobs",
    { permission: "catalogue.import" },
    async (c) => ({
      data: await c.app.catalogueImport.listJobs(
        c.actor,
        c.query.int("limit") ?? 50,
      ),
    }),
  );
  r.get(
    "/catalogue/import/jobs/:id",
    { permission: "catalogue.import" },
    async (c) => ({
      data: await c.app.catalogueImport.getJob(c.actor, c.params.id),
    }),
  );
  r.get(
    "/catalogue/import/jobs/:id/rows",
    { permission: "catalogue.import" },
    async (c) => ({
      data: await c.app.catalogueImport.rows(c.actor, c.params.id, {
        status: c.query.str("status") as RowStatus | undefined,
        page: c.query.int("page"),
        pageSize: c.query.int("pageSize"),
      }),
    }),
  );
  r.patch(
    "/catalogue/import/jobs/:id/rows/:rowId",
    { permission: "catalogue.import" },
    async (c) => {
      await c.app.catalogueImport.excludeRow(
        c.actor,
        c.params.id,
        c.params.rowId,
        (await c.json()).excluded !== false,
      );
      return { data: await c.app.catalogueImport.getJob(c.actor, c.params.id) };
    },
  );
  r.post(
    "/catalogue/import/jobs/:id/cancel",
    { permission: "catalogue.import" },
    async (c) => ({
      data: await c.app.catalogueImport.cancel(c.actor, c.params.id),
    }),
  );
  r.post(
    "/catalogue/import/jobs/:id/commit",
    { permission: "catalogue.import" },
    async (c) => {
      const id = c.params.id;
      requirePermission(c.actor, "catalogue.import");
      let p = running.get(id);
      if (!p) {
        p = c.app.catalogueImport
          .commit(c.actor, id)
          .finally(() => running.delete(id));
        running.set(id, p);
      }
      // Small imports finish within the request; big ones continue in the
      // background and the client polls the job (resumable if the app restarts).
      const outcome = await Promise.race([
        p.then(() => "done" as const),
        new Promise<"pending">((res) => setTimeout(() => res("pending"), 2500)),
      ]);
      if (outcome === "pending") p.catch(() => undefined);
      const job = await c.app.catalogueImport.getJob(c.actor, id);
      return { status: outcome === "done" ? 200 : 202, data: job };
    },
  );
  r.post(
    "/catalogue/import/package/preview",
    { permission: "catalogue.import", maxBytes: PACKAGE_LIMIT },
    async (c) => {
      const f = await uploadedFile(c);
      return {
        data: await c.app.cataloguePackage.preview(
          c.actor,
          packageSource(f.bytes),
        ),
      };
    },
  );
  r.post(
    "/catalogue/import/package",
    { permission: "catalogue.import", maxBytes: PACKAGE_LIMIT },
    async (c) => {
      const f = await uploadedFile(c);
      const job = await c.app.cataloguePackage.importPackage(
        c.actor,
        packageSource(f.bytes),
        {
          imagesLicenseConfirmed: flag(f.form, "imagesLicenseConfirmed"),
          label: formText(f.form, "label") ?? f.name,
        },
      );
      return { status: job.status === "FAILED" ? 422 : 201, data: job };
    },
  );

  // ------------------------------------------------------------ products
  r.get("/products", { permission: "products.read" }, async (c) => {
    const q = c.query;
    return {
      data: await c.app.products.list(c.actor, {
        ...paged(q),
        status: q.str("status") as "ACTIVE" | "INACTIVE" | undefined,
        category: q.str("category"),
        brand: q.str("brand"),
        lowStockOnly: q.bool("lowStockOnly"),
      }),
    };
  });
  r.get("/products/categories", { permission: "products.read" }, async (c) => ({
    data: await c.app.products.categories(c.actor),
  }));
  r.get("/products/lookup", { permission: "products.read" }, async (c) => {
    const found = await c.app.products.lookup(
      c.actor,
      c.query.str("code") ?? "",
    );
    if (!found) throw notFound("Product for that code");
    return { data: found };
  });
  r.post(
    "/products/cleanup-files",
    { permission: "products.write" },
    async (c) => ({
      data: { removed: await c.app.products.cleanupOrphanFiles(c.actor) },
    }),
  );
  r.post("/products", { permission: "products.write" }, async (c) => ({
    status: 201,
    data: await c.app.products.create(c.actor, await c.json()),
  }));
  r.get("/products/:id", { permission: "products.read" }, async (c) => ({
    data: await c.app.products.detail(c.actor, c.params.id),
  }));
  r.patch("/products/:id", { permission: "products.write" }, async (c) => ({
    data: await c.app.products.update(c.actor, c.params.id, await c.json()),
  }));
  r.get(
    "/products/:id/label.svg",
    { permission: "products.read" },
    async (c) => {
      const kind = c.query.str("type") ?? "code128";
      if (kind !== "code128" && kind !== "qr")
        throw validation("type must be code128 or qr.");
      const { product } = await c.app.products.detail(c.actor, c.params.id);
      let svg: string;
      try {
        svg =
          kind === "qr"
            ? qrSvg(product.sku, { caption: product.sku })
            : code128Svg(product.sku);
      } catch (e) {
        throw validation(
          e instanceof Error
            ? e.message
            : "This SKU cannot be turned into a label.",
        );
      }
      return {
        binary: {
          bytes: new TextEncoder().encode(svg),
          mime: "image/svg+xml",
          inline: true,
        },
      };
    },
  );
  r.post(
    "/products/:id/reference-links",
    { permission: "products.write" },
    async (c) => ({
      status: 201,
      data: await c.app.products.linkReference(
        c.actor,
        c.params.id,
        String((await c.json()).referencePartId ?? ""),
      ),
    }),
  );
  r.delete(
    "/products/:id/reference-links/:linkId",
    { permission: "products.write" },
    async (c) => {
      await c.app.products.unlinkReference(
        c.actor,
        c.params.id,
        c.params.linkId,
      );
      return { status: 204 };
    },
  );
  r.post(
    "/products/:id/numbers",
    { permission: "products.write" },
    async (c) => ({
      status: 201,
      data: await c.app.products.addNumber(
        c.actor,
        c.params.id,
        await c.json(),
      ),
    }),
  );
  r.delete(
    "/products/:id/numbers/:numberId",
    { permission: "products.write" },
    async (c) => {
      await c.app.products.removeNumber(
        c.actor,
        c.params.id,
        c.params.numberId,
      );
      return { status: 204 };
    },
  );
  r.put(
    "/products/:id/suppliers",
    { permission: "products.write" },
    async (c) => ({
      data: await c.app.products.setSupplier(
        c.actor,
        c.params.id,
        await c.json(),
      ),
    }),
  );
  r.delete(
    "/products/:id/suppliers/:linkId",
    { permission: "products.write" },
    async (c) => {
      await c.app.products.removeSupplier(
        c.actor,
        c.params.id,
        c.params.linkId,
      );
      return { status: 204 };
    },
  );
  r.post(
    "/products/:id/images",
    { permission: "products.write", maxBytes: IMAGE_LIMIT + 512 * 1024 },
    async (c) => {
      const f = await uploadedFile(c);
      return {
        status: 201,
        data: await c.app.products.addImage(c.actor, c.params.id, {
          bytes: f.bytes,
          fileName: f.name,
          caption: formText(f.form, "caption"),
          primary: flag(f.form, "primary"),
        }),
      };
    },
  );
  r.put(
    "/products/:id/images/order",
    { permission: "products.write" },
    async (c) => {
      const ids = (await c.json()).ids;
      if (!Array.isArray(ids) || ids.some((x) => typeof x !== "string"))
        throw validation("ids must be a list of image ids.");
      return {
        data: await c.app.products.reorderImages(
          c.actor,
          c.params.id,
          ids as string[],
        ),
      };
    },
  );
  r.put(
    "/products/:id/images/:imageId/primary",
    { permission: "products.write" },
    async (c) => ({
      data: await c.app.products.setPrimaryImage(
        c.actor,
        c.params.id,
        c.params.imageId,
      ),
    }),
  );
  r.delete(
    "/products/:id/images/:imageId",
    { permission: "products.write" },
    async (c) => {
      await c.app.products.removeImage(c.actor, c.params.id, c.params.imageId);
      return { status: 204 };
    },
  );
  r.get("/products/:id/sales", { permission: "invoices.read" }, async (c) => ({
    data: await c.app.reports.productSales(c.actor, c.params.id),
  }));
  r.get("/products/:id/stock", { permission: "inventory.read" }, async (c) => ({
    data: await c.app.inventory.stockFor(c.actor, c.params.id),
  }));

  // ------------------------------------------------------------ inventory & warehouses
  r.get("/inventory/balances", { permission: "inventory.read" }, async (c) => ({
    data: await c.app.inventory.balances(c.actor, {
      warehouseId: c.query.str("warehouseId"),
      locationId: c.query.str("locationId"),
    }),
  }));
  r.get("/inventory/stock", { permission: "inventory.read" }, async (c) => ({
    data: await c.app.inventory.stockLevels(c.actor, {
      ...paged(c.query),
      warehouseId: c.query.str("warehouseId"),
    }),
  }));
  r.get(
    "/inventory/movements",
    { permission: "inventory.read" },
    async (c) => ({
      data: await c.app.inventory.movements(c.actor, {
        productId: c.query.str("productId"),
        locationId: c.query.str("locationId"),
        page: c.query.int("page"),
        pageSize: c.query.int("pageSize"),
      }),
    }),
  );
  r.get(
    "/inventory/integrity",
    { permission: "inventory.read" },
    async (c) => ({ data: await c.app.inventory.verifyIntegrity(c.actor) }),
  );
  r.post(
    "/inventory/receive",
    { permission: "inventory.write" },
    async (c) => ({
      status: 201,
      data: await c.app.inventory.receive(c.actor, await c.json()),
    }),
  );
  r.post("/inventory/adjust", { permission: "inventory.write" }, async (c) => ({
    status: 201,
    data: await c.app.inventory.adjust(c.actor, await c.json()),
  }));
  r.post(
    "/inventory/transfer",
    { permission: "inventory.write" },
    async (c) => ({
      status: 201,
      data: await c.app.inventory.transfer(c.actor, await c.json()),
    }),
  );
  // Batches and expiry (batch-tracked products, the pharmacy edition)
  r.get(
    "/products/:id/batches",
    { permission: "inventory.read" },
    async (c) => ({
      data: await c.app.inventory.batches(c.actor, c.params.id),
    }),
  );
  r.get("/inventory/expiring", { permission: "inventory.read" }, async (c) => ({
    data: await c.app.inventory.expiring(c.actor, {
      days: c.query.int("days"),
    }),
  }));
  r.post(
    "/inventory/write-off-expired",
    { permission: "inventory.write" },
    async (c) => ({
      status: 201,
      data: await c.app.inventory.writeOffExpired(c.actor, await c.json()),
    }),
  );
  r.get("/warehouses", { permission: "inventory.read" }, async (c) => ({
    data: await c.app.masterData.listWarehouses(c.actor),
  }));
  r.post("/warehouses", { permission: "warehouses.write" }, async (c) => ({
    status: 201,
    data: await c.app.masterData.createWarehouse(c.actor, await c.json()),
  }));
  r.patch("/warehouses/:id", { permission: "warehouses.write" }, async (c) => ({
    data: await c.app.masterData.updateWarehouse(
      c.actor,
      c.params.id,
      await c.json(),
    ),
  }));
  r.post(
    "/warehouses/:id/locations",
    { permission: "warehouses.write" },
    async (c) => ({
      status: 201,
      data: await c.app.masterData.createLocation(
        c.actor,
        c.params.id,
        await c.json(),
      ),
    }),
  );

  // ------------------------------------------------------------ customers / suppliers / branches
  r.get("/customers", { permission: "customers.read" }, async (c) => ({
    data: await c.app.masterData.listCustomers(c.actor, {
      ...paged(c.query),
      status: c.query.str("status"),
    }),
  }));
  r.post("/customers", { permission: "customers.write" }, async (c) => ({
    status: 201,
    data: await c.app.masterData.createCustomer(c.actor, await c.json()),
  }));
  r.get("/customers/:id", { permission: "customers.read" }, async (c) => ({
    data: await c.app.masterData.getCustomer(c.actor, c.params.id),
  }));
  r.patch("/customers/:id", { permission: "customers.write" }, async (c) => ({
    data: await c.app.masterData.updateCustomer(
      c.actor,
      c.params.id,
      await c.json(),
    ),
  }));
  r.get("/suppliers", { permission: "suppliers.read" }, async (c) => ({
    data: await c.app.masterData.listSuppliers(c.actor, {
      ...paged(c.query),
      status: c.query.str("status"),
    }),
  }));
  r.post("/suppliers", { permission: "suppliers.write" }, async (c) => ({
    status: 201,
    data: await c.app.masterData.createSupplier(c.actor, await c.json()),
  }));
  r.get("/suppliers/:id", { permission: "suppliers.read" }, async (c) => ({
    data: await c.app.masterData.getSupplier(c.actor, c.params.id),
  }));
  r.patch("/suppliers/:id", { permission: "suppliers.write" }, async (c) => ({
    data: await c.app.masterData.updateSupplier(
      c.actor,
      c.params.id,
      await c.json(),
    ),
  }));
  r.get("/branches", { permission: "settings.read" }, async (c) => ({
    data: await c.app.masterData.listBranches(c.actor),
  }));
  r.put("/branches", { permission: "settings.manage" }, async (c) => ({
    data: await c.app.masterData.saveBranch(c.actor, await c.json()),
  }));

  // ------------------------------------------------------------ enquiries
  r.get("/enquiries", { permission: "enquiries.read" }, async (c) => ({
    data: await c.app.sales.listEnquiries(c.actor, {
      ...paged(c.query),
      status: c.query.str("status"),
    }),
  }));
  r.get("/enquiries/current", { permission: "enquiries.read" }, async (c) => ({
    data: await c.app.sales.currentEnquiry(c.actor),
  }));
  r.post("/enquiries/items", { permission: "enquiries.write" }, async (c) => ({
    status: 201,
    data: await c.app.sales.addEnquiryItem(c.actor, await c.json()),
  }));
  r.get("/enquiries/:id", { permission: "enquiries.read" }, async (c) => ({
    data: await c.app.sales.getEnquiry(c.actor, c.params.id),
  }));
  r.delete(
    "/enquiries/:id/items/:itemId",
    { permission: "enquiries.write" },
    async (c) => ({
      data: await c.app.sales.removeEnquiryItem(
        c.actor,
        c.params.id,
        c.params.itemId,
      ),
    }),
  );
  r.post(
    "/enquiries/:id/submit",
    { permission: "enquiries.write" },
    async (c) => ({
      data: await c.app.sales.submitEnquiry(
        c.actor,
        c.params.id,
        await c.json(),
      ),
    }),
  );
  r.post(
    "/enquiries/:id/cancel",
    { permission: "enquiries.write" },
    async (c) => ({
      data: await c.app.sales.cancelEnquiry(c.actor, c.params.id),
    }),
  );
  r.post(
    "/enquiries/:id/quotation",
    { permission: "quotations.write" },
    async (c) => ({
      status: 201,
      data: await c.app.sales.createQuotationFromEnquiry(
        c.actor,
        c.params.id,
        await c.json(),
      ),
    }),
  );

  // ------------------------------------------------------------ quotations
  r.get("/quotations", { permission: "quotations.read" }, async (c) => ({
    data: await c.app.sales.listQuotations(c.actor, {
      ...paged(c.query),
      status: c.query.str("status"),
      customerId: c.query.str("customerId"),
    }),
  }));
  r.post("/quotations", { permission: "quotations.write" }, async (c) => ({
    status: 201,
    data: await c.app.sales.createQuotation(c.actor, await c.json()),
  }));
  r.get("/quotations/:id", { permission: "quotations.read" }, async (c) => ({
    data: await c.app.sales.getQuotation(c.actor, c.params.id),
  }));
  r.patch("/quotations/:id", { permission: "quotations.write" }, async (c) => ({
    data: await c.app.sales.updateQuotation(
      c.actor,
      c.params.id,
      await c.json(),
    ),
  }));
  r.get("/quotations/:id/pdf", { permission: "quotations.read" }, async (c) => {
    const d = await c.app.documents.quotationPdf(c.actor, c.params.id);
    return {
      binary: {
        bytes: d.bytes,
        mime: "application/pdf",
        fileName: d.fileName,
        inline: true,
      },
    };
  });
  r.post(
    "/quotations/:id/issue",
    { permission: "quotations.write" },
    async (c) => ({
      data: await c.app.sales.issueQuotation(c.actor, c.params.id),
    }),
  );
  r.post(
    "/quotations/:id/accept",
    { permission: "quotations.write" },
    async (c) => ({
      data: await c.app.sales.acceptQuotation(c.actor, c.params.id),
    }),
  );
  r.post(
    "/quotations/:id/reject",
    { permission: "quotations.write" },
    async (c) => ({
      data: await c.app.sales.rejectQuotation(c.actor, c.params.id),
    }),
  );
  r.post(
    "/quotations/:id/cancel",
    { permission: "quotations.write" },
    async (c) => ({
      data: await c.app.sales.cancelQuotation(c.actor, c.params.id),
    }),
  );
  r.post(
    "/quotations/:id/order",
    { permission: "orders.write" },
    async (c) => ({
      status: 201,
      data: await c.app.sales.convertToOrder(
        c.actor,
        c.params.id,
        await c.json(),
      ),
    }),
  );

  // ------------------------------------------------------------ orders / invoices / payments
  r.get("/orders", { permission: "orders.read" }, async (c) => ({
    data: await c.app.sales.listOrders(c.actor, {
      ...paged(c.query),
      status: c.query.str("status"),
      customerId: c.query.str("customerId"),
    }),
  }));
  r.post("/orders", { permission: "orders.write" }, async (c) => ({
    status: 201,
    data: await c.app.sales.createOrder(c.actor, await c.json()),
  }));
  r.get("/orders/:id", { permission: "orders.read" }, async (c) => ({
    data: await c.app.sales.getOrder(c.actor, c.params.id),
  }));
  r.post("/orders/:id/reserve", { permission: "orders.write" }, async (c) => ({
    data: await c.app.sales.reserveShortfall(c.actor, c.params.id),
  }));
  r.post("/orders/:id/fulfil", { permission: "orders.write" }, async (c) => ({
    data: await c.app.sales.fulfillOrder(c.actor, c.params.id, await c.json()),
  }));
  r.post("/orders/:id/cancel", { permission: "orders.write" }, async (c) => ({
    data: await c.app.sales.cancelOrder(c.actor, c.params.id, await c.json()),
  }));
  r.post("/orders/:id/return", { permission: "orders.write" }, async (c) => ({
    data: await c.app.sales.returnItems(c.actor, c.params.id, await c.json()),
  }));
  r.post(
    "/orders/:id/invoice",
    { permission: "invoices.write" },
    async (c) => ({
      status: 201,
      data: await c.app.sales.invoiceOrder(
        c.actor,
        c.params.id,
        await c.json(),
      ),
    }),
  );
  // The till: scanned items delivered, invoiced and paid in one step.
  r.post("/counter-sales", { permission: "payments.record" }, async (c) => ({
    status: 201,
    data: await c.app.sales.counterSale(c.actor, await c.json()),
  }));
  r.post(
    "/orders/:id/sell-now",
    { permission: "invoices.write" },
    async (c) => {
      requirePermission(c.actor, "orders.write");
      return {
        status: 201,
        data: await c.app.sales.sellNow(c.actor, c.params.id),
      };
    },
  );
  r.get("/invoices", { permission: "invoices.read" }, async (c) => ({
    data: await c.app.sales.listInvoices(c.actor, {
      ...paged(c.query),
      status: c.query.str("status"),
      customerId: c.query.str("customerId"),
      unpaidOnly: c.query.bool("unpaidOnly"),
    }),
  }));
  r.get("/invoices/:id", { permission: "invoices.read" }, async (c) => ({
    data: await c.app.sales.getInvoice(c.actor, c.params.id),
  }));
  r.get("/invoices/:id/pdf", { permission: "invoices.read" }, async (c) => {
    const d = await c.app.documents.invoicePdf(c.actor, c.params.id);
    return {
      binary: {
        bytes: d.bytes,
        mime: "application/pdf",
        fileName: d.fileName,
        inline: true,
      },
    };
  });
  r.post(
    "/invoices/:id/payments",
    { permission: "payments.record" },
    async (c) => ({
      status: 201,
      data: await c.app.sales.recordPayment(
        c.actor,
        c.params.id,
        await c.json(),
      ),
    }),
  );
  // IntraForge Pay (platform mode): show a Pay QR for the balance, then ask
  // (server-side, through IntraForge) whether the customer has paid it.
  r.get("/invoices/:id/pay", { permission: "invoices.read" }, async (c) => ({
    data: {
      available: c.app.pay.available,
      requests: await c.app.pay.list(c.actor, c.params.id),
    },
  }));
  r.post("/invoices/:id/pay", { permission: "payments.record" }, async (c) => ({
    status: 201,
    data: await c.app.pay.start(c.actor, c.params.id),
  }));
  r.post(
    "/invoices/:id/pay/:payId/check",
    { permission: "payments.record" },
    async (c) => ({
      data: await c.app.pay.check(c.actor, c.params.id, c.params.payId),
    }),
  );
  r.post("/invoices/:id/void", { permission: "invoices.write" }, async (c) => ({
    data: await c.app.sales.voidInvoice(c.actor, c.params.id, await c.json()),
  }));

  // ------------------------------------------------------------ purchasing
  r.get("/purchase-orders", { permission: "purchasing.read" }, async (c) => ({
    data: await c.app.purchasing.list(c.actor, {
      ...paged(c.query),
      status: c.query.str("status"),
      supplierId: c.query.str("supplierId"),
    }),
  }));
  r.post("/purchase-orders", { permission: "purchasing.write" }, async (c) => ({
    status: 201,
    data: await c.app.purchasing.create(c.actor, await c.json()),
  }));
  r.get(
    "/purchase-orders/:id",
    { permission: "purchasing.read" },
    async (c) => ({ data: await c.app.purchasing.get(c.actor, c.params.id) }),
  );
  r.patch(
    "/purchase-orders/:id",
    { permission: "purchasing.write" },
    async (c) => ({
      data: await c.app.purchasing.update(c.actor, c.params.id, await c.json()),
    }),
  );
  r.post(
    "/purchase-orders/:id/confirm",
    { permission: "purchasing.write" },
    async (c) => ({
      data: await c.app.purchasing.confirm(c.actor, c.params.id),
    }),
  );
  r.post(
    "/purchase-orders/:id/cancel",
    { permission: "purchasing.write" },
    async (c) => ({
      data: await c.app.purchasing.cancel(c.actor, c.params.id),
    }),
  );
  r.post(
    "/purchase-orders/:id/close",
    { permission: "purchasing.write" },
    async (c) => ({ data: await c.app.purchasing.close(c.actor, c.params.id) }),
  );
  r.post(
    "/purchase-orders/:id/receive",
    { permission: "purchasing.write" },
    async (c) => ({
      data: await c.app.purchasing.receive(
        c.actor,
        c.params.id,
        await c.json(),
      ),
    }),
  );

  // ------------------------------------------------------------ reports
  r.get("/reports/dashboard", { permission: "settings.read" }, async (c) => ({
    data: await c.app.reports.dashboard(c.actor),
  }));
  r.get("/reports/:name", { permission: "settings.read" }, async (c) => {
    const range = { from: c.query.str("from"), to: c.query.str("to") };
    const a = c.actor;
    const rep = c.app.reports;
    const table: Record<string, () => Promise<unknown>> = {
      "inventory-valuation": () => rep.inventoryValuation(a),
      "stock-on-hand": () => rep.stockOnHand(a),
      "low-stock": () => rep.lowStock(a),
      "sales-by-period": () => rep.salesByPeriod(a, range),
      "sales-by-product": () => rep.salesByProduct(a, range),
      "customer-activity": () => rep.customerActivity(a, range),
      "outstanding-invoices": () => rep.outstandingInvoices(a),
      "quotation-conversion": () => rep.quotationConversion(a, range),
      "supplier-overview": () => rep.supplierOverview(a),
      "daily-sales": () => rep.dailySales(a, range),
      "batch-valuation": () => rep.batchValuation(a),
      "expired-write-offs": () => rep.expiredWriteOffs(a, range),
      "prescription-register": () => rep.prescriptionRegister(a, range),
    };
    const run = table[c.params.name];
    if (!run) throw notFound("Report");
    const data = await run();
    if (c.query.str("format") === "csv") {
      if (!Array.isArray(data))
        throw validation("This report cannot be exported as CSV.");
      const headers = data.length ? Object.keys(data[0] as object) : [];
      return {
        text: {
          mime: "text/csv",
          fileName: `${c.params.name}.csv`,
          body:
            "﻿" +
            toCsv(
              headers,
              data.map((row) =>
                headers.map((h) => (row as Record<string, unknown>)[h]),
              ),
            ),
        },
      };
    }
    return { data };
  });

  // ------------------------------------------------------------ stored files
  r.get("/files/:id", { permission: "documents.read" }, async (c) => {
    const meta = await c.container.repos.files.meta(c.params.id);
    if (!meta) throw notFound("File");
    // Catalogue drawings are only served through /catalogue/assets/:id, which
    // enforces their image rights; everything else here is keyed by its kind.
    if (meta.kind === "PRODUCT_IMAGE")
      requirePermission(c.actor, "products.read");
    else if (meta.kind === "QUOTATION_PDF")
      requirePermission(c.actor, "quotations.read");
    else if (meta.kind === "INVOICE_PDF")
      requirePermission(c.actor, "invoices.read");
    else throw notFound("File");
    const f = await c.container.repos.files.get(meta.id);
    if (!f) throw notFound("File");
    return {
      binary: {
        bytes: f.bytes,
        mime: f.file.mime,
        fileName: f.file.originalName,
        inline:
          f.file.mime.startsWith("image/") || f.file.mime === "application/pdf",
      },
    };
  });

  return r;
}

function sessionView(s: {
  actor: Actor;
  csrfToken: string;
  mustChangePassword: boolean;
}) {
  const { permissions: _explicit, ...user } = s.actor;
  void _explicit;
  return {
    user,
    csrfToken: s.csrfToken,
    mustChangePassword: s.mustChangePassword,
    permissions: permissionsOf(s.actor),
  };
}

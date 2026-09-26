process.on("uncaughtException", (e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
import { statSync, readFileSync } from "node:fs";
import { createContainer } from "../src/server/standalone/container";
import { createApp } from "../src/server/domain/app";
import {
  DirectorySource,
  ZipSource,
} from "../src/server/catalogue/packageSource";

// Usage: npm run catalogue:import -- <package folder | .ifcatalog | .zip> [--images-licensed] [--as <admin email>]
const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith("--"));
const licensed = args.includes("--images-licensed");
if (!path) {
  console.error(
    "Usage: npm run catalogue:import -- <package folder | file> [--images-licensed]",
  );
  process.exit(2);
}
const c = await createContainer();
try {
  const app = createApp(c);
  const users = await c.identity.listUsers();
  const owner = users.find((u) => u.role === "OWNER" && u.status === "ACTIVE");
  if (!owner)
    throw new Error(
      "Create the Owner account first (npm run owner:create, or sign in once).",
    );
  const source = statSync(path).isDirectory()
    ? new DirectorySource(path)
    : new ZipSource(new Uint8Array(readFileSync(path)));
  const job = await app.cataloguePackage.importPackage(owner, source, {
    imagesLicenseConfirmed: licensed,
    label: path,
  });
  console.log(`${job.status}: ${job.message}`);
  console.log(
    `new ${job.created}, updated ${job.updated}, unchanged ${job.unchanged}, skipped ${job.skipped}, warnings ${job.warnings}, errors ${job.errors}`,
  );
  process.exitCode = job.status === "FAILED" ? 1 : 0;
} finally {
  await c.close();
}

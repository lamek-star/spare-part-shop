import { mkdirSync, writeFileSync } from "node:fs";
import {
  apiRoutes,
  permissionsMatrix,
  schemaReference,
} from "../src/server/ops/generatedDocs";

mkdirSync("docs/generated", { recursive: true });
writeFileSync("docs/generated/PERMISSIONS_MATRIX.md", permissionsMatrix());
writeFileSync("docs/generated/API_ROUTES.md", apiRoutes());
writeFileSync("docs/generated/SCHEMA.md", await schemaReference());
console.log("Generated docs/generated/*.md");

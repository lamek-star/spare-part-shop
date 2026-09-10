import {
  statSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { ReferenceRepository } from "./repository";
import { ReferenceState } from "./models";
// Development-only single-process store. Replace with a transactional platform adapter.
const globals = globalThis as typeof globalThis & {
  __referenceRepository?: ReferenceRepository;
  __referenceStamp?: number;
};
export function repository() {
  const dir =
    process.env.CATALOGUE_TEST_MODE === "1"
      ? join(process.cwd(), ".catalogue-test-data")
      : join(process.cwd(), ".catalogue-data");
  const file = join(dir, "reference-v1.json");
  const stamp = existsSync(file) ? statSync(file).mtimeMs : 0;
  if (!globals.__referenceRepository || globals.__referenceStamp !== stamp) {
    const initial = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as ReferenceState)
      : undefined;
    globals.__referenceRepository = new ReferenceRepository(initial, (s) => {
      mkdirSync(dir, { recursive: true });
      const temporary = file + ".tmp";
      writeFileSync(temporary, JSON.stringify(s));
      renameSync(temporary, file);
      globals.__referenceStamp = statSync(file).mtimeMs;
    });
    globals.__referenceStamp = stamp;
  }
  return globals.__referenceRepository;
}

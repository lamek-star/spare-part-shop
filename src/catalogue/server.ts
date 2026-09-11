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
import { ReferenceState, referenceSchemaVersion } from "./models";
// Development-only single-process store. Replace with a transactional platform adapter.
const globals = globalThis as typeof globalThis & {
  __referenceRepository?: ReferenceRepository;
  __referenceStamp?: number;
};
/**
 * A persisted snapshot from an older schema is discarded rather than
 * trusted — seed/model shape changes must not silently hide behind a
 * stale single-process dev file with no migration path.
 */
export function usablePersistedState(
  parsed: ReferenceState | undefined,
): ReferenceState | undefined {
  return parsed?.schema === referenceSchemaVersion ? parsed : undefined;
}
export function repository() {
  const dir =
    process.env.CATALOGUE_TEST_MODE === "1"
      ? join(process.cwd(), ".catalogue-test-data")
      : join(process.cwd(), ".catalogue-data");
  const file = join(dir, "reference-v1.json");
  const stamp = existsSync(file) ? statSync(file).mtimeMs : 0;
  if (!globals.__referenceRepository || globals.__referenceStamp !== stamp) {
    const parsed = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as ReferenceState)
      : undefined;
    const initial = usablePersistedState(parsed);
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

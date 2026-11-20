import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  knowsServerMessage,
  translateServerMessage,
} from "../../src/ui/serverMessages";

/**
 * Every message the server can put in an error must have a translation entry
 * (src/ui/messages "srv.*"), or a person using Arabic, Amharic or Tigrinya
 * sees it in English. The server source is scanned for validation(),
 * conflict(), forbidden(), unauthorized(), notFound(), ensure() and
 * new AppError(); a template's ${...} parts stand for run-time values.
 */
const SERVER = join(process.cwd(), "src", "server");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((f) =>
    f.isDirectory()
      ? files(join(dir, f.name))
      : f.name.endsWith(".ts")
        ? [join(dir, f.name)]
        : [],
  );
}

/** A string literal at s[i] ("..", '..' or `..`); ${x} parts become "7". */
function readString(
  s: string,
  i: number,
): { text: string; end: number } | null {
  const q = s[i];
  if (q !== '"' && q !== "'" && q !== "`") return null;
  let out = "";
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === "\\") {
      out += s[j + 1] === "n" ? "\n" : s[j + 1];
      j += 2;
      continue;
    }
    if (c === q) return { text: out, end: j + 1 };
    if (q === "`" && c === "$" && s[j + 1] === "{") {
      j = skipBalanced(s, j + 1);
      out += "7";
      continue;
    }
    out += c;
    j++;
  }
  return null;
}
/** From the bracket at s[i], the index just after its partner (strings respected). */
function skipBalanced(s: string, i: number): number {
  const open = s[i];
  const close = ({ "(": ")", "[": "]", "{": "}" } as Record<string, string>)[
    open
  ];
  let depth = 0;
  let j = i;
  while (j < s.length) {
    const c = s[j];
    if (c === '"' || c === "'" || c === "`") {
      j = readString(s, j)?.end ?? j + 1;
      continue;
    }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return j + 1;
    j++;
  }
  return j;
}
/** Where argument n (from 0) of the call whose "(" is at s[i] starts; -1 if it has fewer. */
function argStart(s: string, i: number, n: number): number {
  let j = i + 1;
  for (let k = 0; j < s.length; k++) {
    while (/\s/.test(s[j])) j++;
    if (k === n) return s[j] === ")" ? -1 : j;
    while (j < s.length && s[j] !== "," && s[j] !== ")") {
      const c = s[j];
      if (c === "(" || c === "[" || c === "{") j = skipBalanced(s, j);
      else if (c === '"' || c === "'" || c === "`")
        j = readString(s, j)?.end ?? j + 1;
      else j++;
    }
    if (s[j] === ")") return -1;
    j++;
  }
  return -1;
}

const MESSAGE_ARG: Record<string, number> = {
  validation: 0,
  conflict: 0,
  forbidden: 0,
  unauthorized: 0,
  notFound: 0,
  ensure: 1,
  "new AppError": 1,
};
interface Found {
  text: string;
  where: string;
  notFound: boolean;
}
function serverMessages(): Found[] {
  const out: Found[] = [];
  for (const file of files(SERVER)) {
    const where = relative(SERVER, file).split(sep).join("/");
    if (where === "kernel/errors.ts") continue; // the helpers themselves
    const s = readFileSync(file, "utf8");
    const re =
      /(?<![\w.])(validation|conflict|forbidden|unauthorized|notFound|ensure|new AppError)\(/g;
    for (let m = re.exec(s); m; m = re.exec(s)) {
      const at = argStart(s, m.index + m[0].length - 1, MESSAGE_ARG[m[1]]);
      if (at < 0) continue; // the helper's default message (listed below)
      const lit = readString(s, at);
      if (!lit) continue; // a message passed through from elsewhere (listed below when fixed)
      out.push({
        text: m[1] === "notFound" ? `${lit.text} not found.` : lit.text,
        where,
        notFound: m[1] === "notFound",
      });
    }
  }
  return out;
}

/** Messages built at run time or as a default, which the scan cannot read as one literal. */
const BUILT_AT_RUN_TIME = [
  "Sign in to continue.",
  "You do not have permission to do that.",
  "Your role (Cashier) may not perform this action.",
  "Only 3 of BRK-001 in unexpired batches here; 2 more are expired and cannot be sold.",
  "Only 3 of BRK-001 in stock here.",
  "You may not take IntraForge Pay payments in this shop.",
  "IntraForge Pay is not installed in this shop.",
  "IntraForge Pay refused this payment.",
  "The request was not accepted.",
  "This SKU cannot be turned into a label.",
  "Something went wrong on the server. Reference: 1a2b3c4d.",
  // The browser's own (src/ui/api.ts)
  "Cannot reach the server. Check that the application is running.",
  "The server answered 502.",
];

test("the scan finds the server's messages (it would pass vacuously if it found none)", () => {
  const found = serverMessages();
  assert.ok(found.length > 150, `only ${found.length} found`);
  assert.ok(found.some((f) => f.text === "Choose two different locations."));
  assert.ok(found.some((f) => f.text === "Quotation not found." && f.notFound));
});

test("every message the server can send has a translation entry", () => {
  const missing = [
    ...serverMessages().filter((f) => !knowsServerMessage(f.text)),
    ...BUILT_AT_RUN_TIME.filter((t) => !knowsServerMessage(t)).map((text) => ({
      text,
      where: "built at run time",
    })),
  ].map((f) => `${f.where}: ${f.text}`);
  assert.deepEqual(missing, []);
});

test("a 'not found' message translates the thing that was not found too", () => {
  for (const f of serverMessages().filter((x) => x.notFound)) {
    const noun = f.text
      .replace(/ not found\.$/, "")
      .replace(/\d+/g, "")
      .trim();
    for (const language of ["ar", "am", "ti"] as const) {
      const shown = translateServerMessage(language, f.text);
      assert.ok(!shown.includes(noun), `${language}: ${f.text} -> ${shown}`);
    }
  }
  assert.equal(
    translateServerMessage("ar", "Quotation not found."),
    "لم يتم العثور على عرض السعر.",
  );
  assert.equal(
    translateServerMessage("am", "Product on line 3 not found."),
    "በመስመር 3 ያለው ምርት አልተገኘም።",
  );
});

test("values keep their place; statuses and nested messages are translated too", () => {
  assert.equal(
    translateServerMessage("ar", "A draft quotation cannot be accepted."),
    "لا يمكن نقل عرض سعر بحالة «مسودة» إلى «مقبول».",
  );
  assert.equal(
    translateServerMessage("ar", "SKU BRK-001 already exists."),
    "رمز الصنف BRK-001 موجود بالفعل.",
  );
  // The more specific template wins: the one that mentions expired batches.
  assert.equal(
    translateServerMessage(
      "ti",
      "Insufficient available stock for BRK-001: 5 requested, 2 available (expired batches are not counted).",
    ),
    "ንBRK-001 እኹል ክዝና የለን፦ ዝተሓተ 5፣ ዘሎ 2 (ግዜኦም ዝሓለፈ ባቻት ኣይቁጸሩን)።",
  );
  assert.equal(
    translateServerMessage("am", "Name must be at most 200 characters."),
    "Name ከ200 ፊደላት መብለጥ የለበትም።",
  );
  // A Pay message carrying another message inside it.
  const late = translateServerMessage(
    "ar",
    "The customer paid with IntraForge Pay (receipt R-9), but the invoice can no longer take it: This invoice is already paid in full. Record it by hand after checking the invoice.",
  );
  assert.ok(
    late.includes("R-9") &&
      late.includes("هذه الفاتورة مدفوعة بالكامل بالفعل."),
    late,
  );
});

test("English, unknown and joined messages", () => {
  assert.equal(
    translateServerMessage("en", "Choose two different locations."),
    "Choose two different locations.",
  );
  assert.equal(
    translateServerMessage("ar", "Something only IntraForge knows."),
    "Something only IntraForge knows.",
  );
  assert.equal(
    translateServerMessage("am", "Name is required. Something else."),
    "Name ያስፈልጋል። Something else.",
  );
});

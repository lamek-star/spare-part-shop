process.on("uncaughtException", (e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
import { createContainer } from "../src/server/standalone/container";

// Usage: npm run owner:create -- <email> "<Display Name>"   (password read from SPAREPARTS_OWNER_PASSWORD)
const [email, displayName] = process.argv.slice(2);
const password = process.env.SPAREPARTS_OWNER_PASSWORD;
if (!email || !displayName || !password) {
  console.error(
    'Usage: SPAREPARTS_OWNER_PASSWORD=... npm run owner:create -- <email> "<Display Name>"',
  );
  process.exit(2);
}
const c = await createContainer();
try {
  if (await c.identity.hasAnyUser())
    throw new Error(
      "An account already exists. Sign in and add users from Administration > Users.",
    );
  await c.identity.createUser(null, {
    email,
    displayName,
    role: "OWNER",
    password,
  });
  console.log(`Owner ${email} created.`);
} finally {
  await c.close();
}

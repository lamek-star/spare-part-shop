import { createApp } from "../domain/app";
import { getContainer } from "../standalone/container";
import { createHttpHandler } from "./core";
import { buildRouter } from "./routes";

export { createHttpHandler, buildRouter };

const globals = globalThis as typeof globalThis & {
  __spHandler?: (req: Request) => Promise<Response>;
};

/** The production request handler (one per server process). */
export function getHttpHandler() {
  globals.__spHandler ??= createHttpHandler(
    buildRouter(),
    async () => {
      const container = await getContainer();
      return { container, app: createApp(container) };
    },
    {
      allowedOrigins: (process.env.SPAREPARTS_ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      secureCookies:
        process.env.SPAREPARTS_SECURE_COOKIES === "1" ? true : undefined,
    },
  );
  return globals.__spHandler;
}

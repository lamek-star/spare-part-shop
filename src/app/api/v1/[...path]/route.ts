import { getHttpHandler } from "../../../../server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = (req: Request) => getHttpHandler()(req);
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;

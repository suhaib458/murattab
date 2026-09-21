import { getVapidPublicKey } from "@/server/push/web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const publicKey = getVapidPublicKey();
  return Response.json(
    { available: Boolean(publicKey), publicKey },
    { headers: { "Cache-Control": "no-store" } }
  );
}


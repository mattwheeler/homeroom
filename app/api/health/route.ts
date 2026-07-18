export async function GET() {
  return Response.json(
    { status: "ok", service: "homeroom", modelTarget: "gpt-5.6-sol" },
    { headers: { "cache-control": "no-store" } }
  );
}

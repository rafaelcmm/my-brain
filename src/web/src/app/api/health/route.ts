/**
 * Health check endpoint for orchestrator container health checks.
 * Returns 200 OK if the webapp is healthy.
 */
export async function GET() {
  return Response.json({ status: "healthy" }, { status: 200 });
}

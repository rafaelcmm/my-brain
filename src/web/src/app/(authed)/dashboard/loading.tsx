/**
 * Dashboard loading fallback while server data resolves.
 */
export default function DashboardLoading() {
  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="h-10 w-56 rounded bg-gray-200 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="h-32 rounded-lg bg-white shadow animate-pulse"
            />
          ))}
        </div>
      </div>
    </main>
  );
}

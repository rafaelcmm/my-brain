/**
 * Read CSRF token emitted by server layout in a meta tag.
 */
export function readCsrfTokenFromMeta(): string {
  if (typeof document === "undefined") {
    return "";
  }

  const value = document
    .querySelector('meta[name="mybrain-csrf-token"]')
    ?.getAttribute("content");
  return value?.trim() || "";
}

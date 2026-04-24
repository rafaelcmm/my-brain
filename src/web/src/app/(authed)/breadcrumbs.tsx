import Link from "next/link";

export interface BreadcrumbItem {
  readonly label: string;
  readonly href?: string;
}

/**
 * Renders consistent breadcrumb navigation across authenticated pages.
 * Contract: the last item is always treated as current page context.
 */
export function Breadcrumbs({
  items,
  className,
}: {
  items: readonly BreadcrumbItem[];
  className?: string;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className={[
        "ds-breadcrumb",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <ol className="ds-breadcrumb-list">
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;

          return (
            <li key={`${item.label}:${item.href ?? "current"}`} className="ds-breadcrumb-item">
              {isCurrent ? (
                <span aria-current="page" className="ds-breadcrumb-current">
                  {item.label}
                </span>
              ) : item.href ? (
                <Link href={item.href} className="ds-breadcrumb-link">
                  {item.label}
                </Link>
              ) : (
                <span className="ds-breadcrumb-muted">{item.label}</span>
              )}
              {!isCurrent ? <span className="ds-breadcrumb-separator">/</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

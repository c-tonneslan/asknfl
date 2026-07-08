"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Ask" },
  { href: "/dashboards", label: "Dashboards" },
  { href: "/fantasy", label: "Fantasy" },
];

export function SiteNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex items-center gap-1 text-sm">
      {LINKS.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={
              active
                ? "rounded-md bg-accent/10 px-3 py-1.5 font-medium text-accent"
                : "rounded-md px-3 py-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
            }
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

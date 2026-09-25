"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useSyncExternalStore } from "react";
import { Menu, Moon, Sun } from "lucide-react";

export function LogoMark({ size = 28 }: { size?: number }) {
  const gid = `kg-${useId().replace(/:/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5a59e6" />
          <stop offset="1" stopColor="#d9468f" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gid})`} />
      <path
        d="M16 6.5c5.6 0 9.5 3.9 9.5 9.2 0 5.6-4.3 9.8-9.9 9.8-5.3 0-9.1-3.7-9.1-8.9C6.5 11 10.6 6.5 16 6.5Z"
        fill="none"
        stroke="white"
        strokeOpacity=".95"
        strokeWidth="2"
      />
      <circle cx="13.2" cy="14.2" r="2.1" fill="white" />
      <circle cx="19" cy="18.6" r="1.4" fill="white" fillOpacity=".85" />
      <circle cx="18.6" cy="12.4" r="0.9" fill="white" fillOpacity=".7" />
      <circle cx="13.6" cy="20" r="0.8" fill="white" fillOpacity=".6" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-tight">Karyon</span>
    </span>
  );
}

function subscribeTheme(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}
const readTheme = () => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => null);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("karyon-theme", next);
    } catch {
      /* storage unavailable: theme still applies for this page view */
    }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex size-9 items-center justify-center rounded-lg text-muted transition hover:bg-sunken hover:text-text"
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
    >
      {theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  );
}

const NAV = [
  { href: "/studio", label: "Studio" },
  { href: "/model", label: "Model card" },
  { href: "/#how", label: "How it works" },
  { href: "/#product", label: "Product" },
];

export function SiteHeader({ compact = false }: { compact?: boolean }) {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-bg/80 backdrop-blur-xl">
      <div className={`mx-auto flex h-14 items-center justify-between gap-4 px-4 sm:px-6 ${compact ? "max-w-none" : "max-w-6xl"}`}>
        <Link href="/" className="rounded-lg" aria-label="Karyon home">
          <Wordmark />
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1">
          {NAV.map((n) => {
            const active = n.href === path;
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`hidden rounded-lg px-3 py-1.5 text-sm transition sm:inline-block ${active ? "bg-sunken font-medium text-text" : "text-muted hover:text-text"}`}
              >
                {n.label}
              </Link>
            );
          })}
          <ThemeToggle />
          <details className="relative sm:hidden">
            <summary className="inline-flex size-9 cursor-pointer list-none items-center justify-center rounded-lg text-muted hover:bg-sunken hover:text-text" aria-label="Menu">
              <Menu className="size-[18px]" />
            </summary>
            <div className="absolute right-0 top-11 z-50 w-48 rounded-xl border border-border bg-elevated p-1.5 shadow-card">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="block rounded-lg px-3 py-2 text-sm hover:bg-sunken">
                  {n.label}
                </Link>
              ))}
            </div>
          </details>
          {path !== "/studio" && (
            <Link
              href="/studio"
              className="ml-1 inline-flex h-9 items-center rounded-lg bg-text px-3.5 text-sm font-medium text-bg transition hover:opacity-90"
            >
              Open Studio
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 text-sm sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-3">
          <Wordmark />
          <p className="max-w-sm text-muted">
            Privacy-first computational pathology. Every pixel is processed on your own device.
          </p>
          <p className="max-w-sm text-xs text-faint">
            Research use only. Karyon is not a medical device and must not be used for diagnosis or treatment decisions.
          </p>
        </div>
        <div className="space-y-2">
          <p className="font-medium">Product</p>
          <ul className="space-y-1.5 text-muted">
            <li><Link className="hover:text-text" href="/studio">Studio</Link></li>
            <li><Link className="hover:text-text" href="/model">Model card</Link></li>
            <li><Link className="hover:text-text" href="/#product">Plans</Link></li>
          </ul>
        </div>
        <div className="space-y-2">
          <p className="font-medium">Engineering</p>
          <ul className="space-y-1.5 text-muted">
            <li><Link className="hover:text-text" href="/model#reproduce">Reproduce training</Link></li>
            <li><Link className="hover:text-text" href="/model#limitations">Limitations</Link></li>
            <li><Link className="hover:text-text" href="/#privacy">Privacy architecture</Link></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}

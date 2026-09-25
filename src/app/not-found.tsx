import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/brand";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex min-h-[60vh] max-w-6xl flex-col items-start justify-center gap-4 px-4 py-24 sm:px-6">
        <p className="font-mono text-sm text-faint">404</p>
        <h1 className="text-3xl font-semibold tracking-tight">This field of view is empty.</h1>
        <p className="max-w-md text-muted">The page you are looking for does not exist or has moved.</p>
        <div className="flex gap-3">
          <Link href="/" className="rounded-xl bg-text px-4 py-2 text-sm font-medium text-bg">Home</Link>
          <Link href="/studio" className="rounded-xl border border-border px-4 py-2 text-sm font-medium">Open Studio</Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

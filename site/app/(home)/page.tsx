import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex flex-col justify-center items-center text-center flex-1 gap-4 px-4">
      <p className="text-sm font-medium text-fd-muted-foreground border border-fd-border rounded-full px-3 py-1">
        Design phase — no code yet. Package: <code>komirka</code>
      </p>
      <h1 className="text-4xl font-bold">Atomic configuration</h1>
      <p className="max-w-xl text-fd-muted-foreground">
        Each config value is an inert, documented, validated descriptor — bound explicitly
        per runtime (Node, Cloudflare Workers, browsers, tests), with secrets fail-closed
        by construction. This site presents the design as documentation.
      </p>
      <div className="flex gap-3 mt-2">
        <Link
          href="/docs"
          className="rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground"
        >
          Read the design
        </Link>
        <Link
          href="/docs/principles"
          className="rounded-lg border border-fd-border px-4 py-2 text-sm font-medium"
        >
          Principles
        </Link>
      </div>
    </div>
  );
}

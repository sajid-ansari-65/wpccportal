import { requirePlatformAdmin } from "@/lib/authz";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requirePlatformAdmin();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-line bg-surface px-4 py-3">
        <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-wp-dark">
          Platform
        </h1>
        <p className="mt-0.5 text-[13px] text-ink-faint">
          Organisations and their owners
        </p>
      </header>

      <div className="flex-1 px-4 py-6">
        <div className="mx-auto w-full max-w-2xl">{children}</div>
      </div>
    </div>
  );
}

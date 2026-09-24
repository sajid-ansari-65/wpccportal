import { createClient } from "@/lib/supabase/server";
import HandleForm from "./HandleForm";

type Result = {
  attendee_name: string;
  event_name: string;
  session_name: string;
  collect_username: boolean;
  already_present: boolean;
};

/**
 * Public self check-in. Anonymous, and the URL is what 187 printed QR codes
 * point at — the path never changes.
 *
 * Attendance is recorded first and the optional question comes second, so
 * closing the page without answering never costs anyone their attendance.
 * Recording during render is safe here precisely because the RPC is
 * idempotent: a second call is a no-op, not a second mark.
 */
export default async function CheckinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("checkin_by_token", { p_token: token });
  const row = (data as Result[] | null)?.[0];

  if (error || !row) {
    const closed = error?.message?.includes("not open");
    return (
      <Shell>
        <h1 className="text-[22px] font-semibold text-ink">
          {closed ? "Check-in isn’t open" : "We don’t recognise that code"}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
          {closed
            ? "This code is valid, but nothing is accepting check-ins right now. Try again when the session starts."
            : "Check you scanned the whole code. If it keeps failing, show this screen to someone on the desk."}
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="text-[13px] text-ink-faint">{row.event_name}</p>
      <h1 className="mt-1 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-wp-dark">
        {row.already_present ? "You’re already checked in" : "You’re checked in"}
      </h1>
      <p className="mt-2 text-[17px] text-ink">{row.attendee_name}</p>

      {row.collect_username ? (
        <HandleForm token={token} />
      ) : (
        <p className="mt-6 text-[15px] text-ink-muted">
          That&rsquo;s everything — you can close this page.
        </p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 px-5 py-12">
      <div className="mx-auto w-full max-w-sm">{children}</div>
    </main>
  );
}

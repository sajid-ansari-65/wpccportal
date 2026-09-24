"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { AttendeeRow } from "@/lib/eventData";
import { yearRank } from "@/lib/attendeeSort";
import { setAttendance } from "./actions";
import ScanPanel from "./ScanPanel";

type Props = {
  orgSlug: string;
  eventSlug: string;
  sessionId: string | null;
  attendees: AttendeeRow[];
  /** False when every attendee shares one institution, so repeating it on
   *  every row would be noise rather than information. */
  showInstitution: boolean;
};

type Pending = { row: AttendeeRow; next: boolean };

export default function AttendanceList({
  orgSlug,
  eventSlug,
  sessionId,
  attendees,
  showInstitution,
}: Props) {
  const [rows, setRows] = useState(attendees);
  const [query, setQuery] = useState("");
  const [year, setYear] = useState<string | null>(null);
  const [college, setCollege] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const [scanning, setScanning] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Adjusted during render rather than in an effect. The server is the source
  // of truth after a revalidation, and syncing in useEffect would paint the
  // stale list first and then immediately repaint — visible as a flicker on
  // the row someone just tapped.
  const [seen, setSeen] = useState(attendees);
  if (attendees !== seen) {
    setSeen(attendees);
    setRows(attendees);
  }

  const years = useMemo(() => {
    const set = new Set(rows.map((r) => r.year).filter(Boolean));
    return [...set].sort((a, b) => yearRank(a) - yearRank(b) || a.localeCompare(b));
  }, [rows]);

  const colleges = useMemo(() => {
    const set = new Set(rows.map((r) => r.institution).filter((v): v is string => !!v));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (year && r.year !== year) return false;
      if (college && r.institution !== college) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q) ||
        (r.institution ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, query, year, college]);

  const presentCount = rows.filter((r) => r.present).length;
  // Once a filter is on, the useful number is about what is on screen. A
  // volunteer working one college's desk does not care about the whole room.
  const visiblePresent = visible.filter((r) => r.present).length;

  function commit(pending: Pending) {
    const { row, next } = pending;
    setConfirming(null);
    setFailure(null);

    // Optimistic: the queue does not wait for a round trip.
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, present: next } : r)));

    startTransition(async () => {
      const result = await setAttendance(orgSlug, eventSlug, row.id, sessionId!, next);
      if (!result.ok) {
        // Put it back exactly as it was and say so, rather than leaving a
        // mark on screen that never reached the database.
        setRows((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, present: !next } : r))
        );
        setFailure(`${row.name} was not saved. ${result.message}`);
      }
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="sticky top-0 z-10 border-b border-line bg-bg/95 px-4 pb-3 pt-3 backdrop-blur">
        <div className="flex gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email or college"
            aria-label="Search attendees"
            autoFocus
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3.5 py-3 text-base text-ink placeholder:text-ink-faint"
          />
          <button
            type="button"
            onClick={() => setScanning((v) => !v)}
            aria-pressed={scanning}
            className={`shrink-0 rounded-lg border px-4 text-[14px] font-medium ${
              scanning ? "border-wp bg-wp text-white" : "border-line bg-surface text-ink-muted"
            }`}
          >
            Scan
          </button>
        </div>

        {/* Colleges first: with more than one in the room it is the coarser
            cut, and the one a volunteer on a particular desk reaches for. */}
        {colleges.length > 1 && (
          <ChipRow label="College">
            <Chip active={college === null} onClick={() => setCollege(null)}>
              All
            </Chip>
            {colleges.map((c) => (
              <Chip key={c} active={college === c} onClick={() => setCollege(c)}>
                {c}
              </Chip>
            ))}
          </ChipRow>
        )}

        {years.length > 1 && (
          <ChipRow label="Year">
            <Chip active={year === null} onClick={() => setYear(null)}>
              All
            </Chip>
            {years.map((y) => (
              <Chip key={y} active={year === y} onClick={() => setYear(y)}>
                {y}
              </Chip>
            ))}
          </ChipRow>
        )}

        <p className="mt-2.5 text-[13px] text-ink-faint tabular">
          {visible.length === rows.length
            ? `${presentCount} of ${rows.length} present`
            : `${visiblePresent} of ${visible.length} present in this filter`}
        </p>
      </div>

      {scanning && (
        <ScanPanel
          attendees={rows}
          onFound={(row) => {
            setScanning(false);
            // Straight into the same confirmation a tap gives. A scan is a
            // faster way to pick someone, not a different way to mark them.
            setConfirming({ row, next: !row.present });
          }}
          onClose={() => setScanning(false)}
        />
      )}

      {failure && (
        <p
          role="alert"
          className="mx-4 mt-3 rounded-lg border border-orange/40 bg-orange/5 px-3.5 py-2.5 text-[14px] text-ink"
        >
          {failure}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="px-4 py-12 text-center text-[15px] text-ink-muted">
          No one matches “{query}”. Check the spelling, or clear the filter.
        </p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {visible.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setConfirming({ row: r, next: !r.present })}
                disabled={!sessionId || isPending}
                aria-pressed={r.present}
                /* w-full AND min-w-0: a flex child defaults to min-width:auto
                   and will push the row wider than the phone screen. */
                className={`flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors disabled:opacity-60 ${
                  showInstitution ? "min-h-[64px]" : "min-h-[56px]"
                } ${
                  r.present ? "bg-wp-pale/50" : "bg-surface"
                }`}
              >
                {showInstitution ? (
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[16px] font-medium text-ink">
                        {r.name}
                      </span>
                      {r.present && <PresentTag />}
                    </span>
                    {r.email && <EmailLine email={r.email} />}
                    <span className="mt-0.5 flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] text-ink-faint">
                        {r.institution ?? "No college recorded"}
                      </span>
                      {r.year && (
                        <span className="shrink-0 text-[13px] text-ink-faint">
                          {r.year}
                        </span>
                      )}
                    </span>
                  </span>
                ) : (
                  /* One institution for everyone, so the second line would hold
                     only the year and a gap. Folded onto one line instead:
                     more names per screen, which is what matters at a gate. */
                  <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                    {/* Wraps rather than truncates. The name is the one thing
                        being matched against a face in the queue; a tidy row is
                        not worth hiding half of it. */}
                    <span className="min-w-0">
                      <span className="block text-[16px] font-medium text-ink">
                        {r.name}
                      </span>
                      {r.email && <EmailLine email={r.email} />}
                    </span>
                    <span className="flex shrink-0 items-baseline gap-3">
                      {r.year && (
                        <span className="text-[13px] text-ink-faint">{r.year}</span>
                      )}
                      {r.present && <PresentTag />}
                    </span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {confirming && (
        <ConfirmDialog
          pending={confirming}
          onCancel={() => setConfirming(null)}
          onConfirm={() => commit(confirming)}
        />
      )}
    </div>
  );
}

/** Never colour alone: a tick, a word, and a row tint, so the state survives
 *  sunlight, a cheap screen and colour blindness. */
function PresentTag() {
  return (
    <span className="shrink-0 text-[13px] font-medium text-wp-dark">
      ✓ Present
    </span>
  );
}

/** Two people can share a name; the email is what tells them apart at the
 *  desk. Truncates rather than wraps — the start of an address is the part
 *  anyone reads out. */
function EmailLine({ email }: { email: string }) {
  return (
    <span className="mt-0.5 block truncate text-[13px] text-ink-muted">{email}</span>
  );
}

/** Two filter rows need labels, or it is guesswork which one is which. */
function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="-mx-4 mt-2.5 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <span className="shrink-0 text-[13px] text-ink-faint">{label}</span>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[14px] transition-colors ${
        active
          ? "border-wp bg-wp text-white"
          : "border-line bg-surface text-ink-muted"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Both directions are confirmed, deliberately. Marking the wrong person present
 * and quietly un-marking someone who is standing in front of you are equally
 * bad, and a volunteer's thumb is not a reliable input device at a busy gate.
 *
 * Orange appears here and nowhere else in the interface, so it always means the
 * same thing: this takes something away.
 */
function ConfirmDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: Pending;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const removing = !pending.next;

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-xl">
        <h2 id="confirm-title" className="text-[18px] font-semibold text-ink">
          {removing ? "Remove attendance?" : "Mark present?"}
        </h2>
        <p className="mt-1.5 text-[15px] leading-relaxed text-ink-muted">
          {removing ? (
            <>
              <span className="font-medium text-ink">{pending.row.name}</span> is
              currently marked present. This removes that.
            </>
          ) : (
            <>
              <span className="font-medium text-ink">{pending.row.name}</span>
              {pending.row.institution ? ` from ${pending.row.institution}` : ""}.
            </>
          )}
        </p>
        {pending.row.email && (
          <p className="mt-1 truncate text-[14px] text-ink-faint">{pending.row.email}</p>
        )}

        <div className="mt-5 flex gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-line bg-surface px-4 py-3 text-base font-medium text-ink-muted"
          >
            Cancel
          </button>
          <button
            ref={ref}
            type="button"
            onClick={onConfirm}
            className={`flex-1 rounded-lg px-4 py-3 text-base font-medium text-white ${
              removing ? "bg-orange" : "bg-wp"
            }`}
          >
            {removing ? "Remove" : "Mark present"}
          </button>
        </div>
      </div>
    </div>
  );
}

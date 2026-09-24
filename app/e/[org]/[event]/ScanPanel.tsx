"use client";

import { useEffect, useRef, useState } from "react";
import type { AttendeeRow } from "@/lib/eventData";

type Props = {
  attendees: AttendeeRow[];
  onFound: (row: AttendeeRow) => void;
  onClose: () => void;
};

/**
 * Scanning resolves the code against THIS event's attendees and then goes
 * through the same marking path as a tap.
 *
 * The legacy scanner posted the scanned token straight at the public check-in
 * endpoint, which looks up a token globally. That was harmless with one tenant
 * and becomes a cross-tenant write the moment there are two — a volunteer at
 * one event could mark someone at another just by scanning their pass. Here an
 * unknown code is simply refused.
 */
export default function ScanPanel({ attendees, onFound, onClose }: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const lastRef = useRef<string>("");

  useEffect(() => {
    let scanner: { stop: () => Promise<void>; clear: () => void } | null = null;
    let cancelled = false;

    // A denied permission prompt, or a device with no camera, can leave the
    // start promise pending rather than rejecting — which parks the volunteer
    // on "Starting the camera…" with nothing to do. Say so after a few
    // seconds and point at the way that always works.
    const stall = setTimeout(() => {
      if (!cancelled) {
        setMessage(
          "The camera hasn’t started. Check the permission prompt, or search by name instead."
        );
      }
    }, 6000);

    const byToken = new Map(attendees.map((a) => [a.qrToken, a]));

    (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled) return;
        const instance = new Html5Qrcode("scan-region");
        scanner = instance;

        await instance.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded: string) => {
            // A camera fires the same code many times a second.
            if (decoded === lastRef.current) return;
            lastRef.current = decoded;

            const token = decoded.includes("/checkin/")
              ? decoded.split("/checkin/")[1].split(/[?#]/)[0]
              : decoded.trim();

            const row = byToken.get(token);
            if (!row) {
              setMessage("That pass isn’t for this event.");
              return;
            }
            setMessage(null);
            onFound(row);
          },
          () => {
            /* per-frame decode misses are normal; not worth surfacing */
          }
        );
        if (!cancelled) {
          clearTimeout(stall);
          setReady(true);
        }
      } catch {
        clearTimeout(stall);
        if (!cancelled) {
          setMessage(
            "The camera didn’t start. Allow camera access, or search by name instead."
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(stall);
      scanner?.stop().then(() => scanner?.clear()).catch(() => {});
    };
  }, [attendees, onFound]);

  return (
    <div className="border-b border-line bg-surface px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-medium text-ink">Scan a pass</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-[13px] text-ink-faint hover:text-ink"
        >
          Done
        </button>
      </div>

      <div
        id="scan-region"
        className="mx-auto mt-3 w-full max-w-[280px] overflow-hidden rounded-xl bg-surface-sunk"
      />

      <p className="mt-3 text-center text-[14px] text-ink-muted" role="status">
        {message ?? (ready ? "Point the camera at the code." : "Starting the camera…")}
      </p>
    </div>
  );
}

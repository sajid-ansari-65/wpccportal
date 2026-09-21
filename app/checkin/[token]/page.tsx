"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { normalizeWpUsername, wpUsernameError } from "@/lib/wpUsername";

type Phase = "loading" | "ready" | "invalid";

export default function CheckinPage() {
  const params = useParams();
  const token = params.token as string;

  const [phase, setPhase] = useState<Phase>("loading");
  const [name, setName] = useState("");
  const [wasAlready, setWasAlready] = useState(false);

  const [handle, setHandle] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Attendance is recorded the moment the page opens. The username is asked
  // for afterwards so that abandoning the form never costs a student their
  // attendance.
  useEffect(() => {
    fetch("/api/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) return setPhase("invalid");
        setName(body.student.name);
        setWasAlready(Boolean(body.alreadyMarked));
        if (body.student.wp_username) {
          setHandle(body.student.wp_username);
          setSaved(body.student.wp_username);
        }
        setPhase("ready");
      })
      .catch(() => setPhase("invalid"));
  }, [token]);

  const save = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const normalized = normalizeWpUsername(handle);
      const problem = wpUsernameError(normalized);
      if (problem) return setError(problem);
      if (!normalized) return setError("Type your username first.");

      setError(null);
      setSaving(true);
      const res = await fetch("/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, wpUsername: normalized }),
      });
      const body = await res.json();
      setSaving(false);
      if (!res.ok) return setError(body.error || "That did not save. Try again.");
      setHandle(normalized);
      setSaved(normalized);
    },
    [handle, token]
  );

  const firstName = name.split(/\s+/)[0] || name;

  return (
    <main className="min-h-screen bg-[#f2f6ff] px-4 py-10 flex justify-center">
      <div className="w-full max-w-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/wcc-logo.png"
          alt="WordPress Campus Connect"
          className="h-9 w-auto mx-auto mb-8"
        />

        {phase === "loading" && (
          <p className="text-center text-[#646970]">Checking you in…</p>
        )}

        {phase === "invalid" && (
          <div className="bg-white border border-[#dee4ff] rounded-2xl p-6 text-center">
            <h1 className="text-lg font-semibold text-[#1a1919] mb-2">
              This QR code is not recognised
            </h1>
            <p className="text-sm text-[#40464d]">
              Head to the help desk and a volunteer will check you in.
            </p>
          </div>
        )}

        {phase === "ready" && (
          <>
            <div className="bg-white border border-[#dee4ff] rounded-2xl p-6 text-center">
              <div
                aria-hidden
                className="w-12 h-12 rounded-full bg-[#3858e9] text-white grid place-items-center mx-auto mb-4 text-2xl leading-none"
              >
                ✓
              </div>
              <h1 className="text-2xl font-bold text-[#1a1919] leading-tight break-words">
                {wasAlready ? `Already in, ${firstName}` : `You're in, ${firstName}`}
              </h1>
              <p className="text-sm text-[#40464d] mt-2">
                {wasAlready
                  ? "Your attendance was recorded earlier."
                  : "Attendance recorded. Enjoy Campus Connect."}
              </p>
            </div>

            <div className="bg-white border border-[#dee4ff] rounded-2xl p-6 mt-4">
              {saved ? (
                <>
                  <p className="text-sm text-[#40464d]">Your WordPress.org username</p>
                  <p className="text-xl font-semibold text-[#1a1919] mt-1 break-all">
                    @{saved}
                  </p>
                  <button
                    type="button"
                    onClick={() => setSaved(null)}
                    className="mt-4 text-sm font-semibold text-[#3858e9] underline underline-offset-4"
                  >
                    Change it
                  </button>
                </>
              ) : (
                <form onSubmit={save} noValidate>
                  <label
                    htmlFor="wp"
                    className="block text-base font-semibold text-[#1a1919]"
                  >
                    What is your WordPress.org username?
                  </label>
                  <p className="text-sm text-[#40464d] mt-1 mb-4">
                    It lets the team credit you and keep you in the loop after today.
                  </p>

                  <div className="flex items-stretch rounded-lg border border-[#c9d4f9] bg-white overflow-hidden focus-within:border-[#3858e9] focus-within:ring-2 focus-within:ring-[#3858e9]/25">
                    <span
                      aria-hidden
                      className="grid place-items-center px-3 text-[#646970] bg-[#f5f7fa] border-r border-[#dee4ff] select-none"
                    >
                      @
                    </span>
                    <input
                      id="wp"
                      autoFocus
                      value={handle}
                      onChange={(e) => {
                        setHandle(e.target.value);
                        setError(null);
                      }}
                      placeholder="yourname"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="done"
                      className="flex-1 min-w-0 px-3 py-3 text-base text-[#1a1919] outline-none"
                    />
                  </div>

                  {error && <p className="text-sm text-[#f15a25] mt-2">{error}</p>}

                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full mt-4 bg-[#3858e9] text-white font-semibold rounded-lg py-3.5 disabled:opacity-60"
                  >
                    {saving ? "Saving…" : "Save username"}
                  </button>
                  <p className="text-xs text-[#646970] mt-3 text-center">
                    No account yet? You are still checked in — close this page.
                  </p>
                </form>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { normalizeWpUsername, wpUsernameError } from "@/lib/wpUsername";
import QRCode from "qrcode";

type Student = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  college: string | null;
  attended: boolean;
  attended_at: string | null;
  qr_token: string;
  attributes: Record<string, string> | null;
  wp_username: string | null;
};

// Import lower-cases every sheet header, so "Year" is stored as "year".
function yearOf(s: Student) {
  return (s.attributes?.year ?? "").trim();
}

// The sheet has "3rd Year", "4th Year", "Final year" and "Other" — sort them
// in that order rather than alphabetically, which would put 4th before Final.
function yearRank(y: string) {
  const t = y.toLowerCase();
  const m = t.match(/(\d)/);
  if (m) return Number(m[1]);
  if (t.includes("final")) return 8;
  if (!t) return 10;
  return 9;
}

type Tab = "attendance" | "import" | "scan" | "qr" | "export";

export default function Dashboard() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("attendance");
  const [students, setStudents] = useState<Student[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const loadStudents = useCallback(async (query = "") => {
    setLoading(true);
    const res = await fetch(`/api/students${query ? `?q=${encodeURIComponent(query)}` : ""}`);
    const body = await res.json();
    setStudents(body.students || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadStudents();
  }, [loadStudents]);

  useEffect(() => {
    const t = setTimeout(() => loadStudents(q), 250);
    return () => clearTimeout(t);
  }, [q, loadStudents]);

  const presentCount = students.filter((s) => s.attended).length;

  // Multiple campuses (SSASIT / VNSGU / TDEC) run on different dates, so the
  // volunteer almost always wants one college at a time.
  const [college, setCollege] = useState<string | null>(null);
  const [year, setYear] = useState<string | null>(null);

  const colleges = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of students) {
      const c = s.college?.trim();
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [students]);

  const years = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of students) {
      const y = yearOf(s);
      if (y) counts.set(y, (counts.get(y) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => yearRank(a[0]) - yearRank(b[0]));
  }, [students]);

  // Both filters apply together.
  const visible = useMemo(
    () =>
      students.filter(
        (s) =>
          (!college || (s.college ?? "").trim() === college) &&
          (!year || yearOf(s) === year)
      ),
    [students, college, year]
  );

  // A tap only *asks*; the write happens after the volunteer confirms.
  const [confirming, setConfirming] = useState<Student | null>(null);

  async function toggleAttendance(s: Student, wpUsername?: string) {
    const next = !s.attended;
    setStudents((prev) =>
      prev.map((x) =>
        x.id === s.id
          ? { ...x, attended: next, wp_username: wpUsername ?? x.wp_username }
          : x
      )
    );
    await fetch("/api/mark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: s.id,
        attended: next,
        ...(wpUsername !== undefined ? { wpUsername } : {}),
      }),
    });
  }

  // Saves the handle without touching attendance.
  async function saveUsername(s: Student, wpUsername: string) {
    setStudents((prev) =>
      prev.map((x) => (x.id === s.id ? { ...x, wp_username: wpUsername || null } : x))
    );
    await fetch("/api/mark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id, attended: s.attended, wpUsername }),
    });
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-[#f2f6ff] text-[#1a1919]">
      <header className="bg-white border-b border-[#dee4ff] px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/wcc-logo.png"
            alt="WordPress Campus Connect"
            className="h-8 sm:h-9 w-auto shrink-0"
          />
          <div className="min-w-0 border-l border-[#dee4ff] pl-3">
            <div className="text-[10px] sm:text-xs tracking-widest uppercase text-[#022f8c] font-bold">
              Surat 2026
            </div>
            <div className="text-xs sm:text-sm text-[#40464d] whitespace-nowrap">
              {students.length} registered · {presentCount} present
            </div>
          </div>
        </div>
        <button
          onClick={logout}
          className="shrink-0 text-sm text-[#40464d] border border-[#c9d4f9] rounded-lg px-3 py-2 hover:border-[#3858e9]"
        >
          Logout
        </button>
      </header>

      <nav className="flex gap-1 px-4 sm:px-6 pt-3 bg-white border-b border-[#dee4ff] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {(
          [
            ["attendance", "Attendance"],
            ["scan", "Scan QR"],
            ["import", "Import XLS"],
            ["qr", "Student QR Codes"],
            ["export", "Export CSV"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 sm:px-4 py-2.5 text-sm rounded-t-lg whitespace-nowrap ${
              tab === key
                ? "bg-[#ffffff] text-[#3858e9] border border-b-0 border-[#dee4ff]"
                : "text-[#646970] hover:text-[#40464d]"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="p-4 sm:p-6">
        {tab === "attendance" && (
          <AttendanceTab
            students={visible}
            q={q}
            setQ={setQ}
            loading={loading}
            onToggle={setConfirming}
            colleges={colleges}
            college={college}
            setCollege={setCollege}
            years={years}
            year={year}
            setYear={setYear}
          />
        )}
        {tab === "scan" && <ScanTab onMarked={() => loadStudents(q)} />}
        {tab === "import" && <ImportTab onImported={() => loadStudents()} />}
        {tab === "qr" && <QrTab students={visible} college={college} year={year} />}
        {tab === "export" && (
          <ExportTab students={visible} college={college} year={year} />
        )}
      </main>

      {confirming && (
        <ConfirmDialog
          student={confirming}
          onCancel={() => setConfirming(null)}
          onConfirm={(wpUsername) => {
            const s = confirming;
            setConfirming(null);
            toggleAttendance(s, wpUsername);
          }}
          onSaveUsername={(wpUsername) => {
            const s = confirming;
            setConfirming(null);
            saveUsername(s, wpUsername);
          }}
        />
      )}
    </div>
  );
}

function ConfirmDialog({
  student,
  onCancel,
  onConfirm,
  onSaveUsername,
}: {
  student: Student;
  onCancel: () => void;
  onConfirm: (wpUsername?: string) => void;
  onSaveUsername: (wpUsername: string) => void;
}) {
  const marking = !student.attended;
  const stored = student.wp_username ?? "";
  const [handle, setHandle] = useState(stored);
  const [error, setError] = useState<string | null>(null);

  const normalized = normalizeWpUsername(handle);
  const changed = normalized !== stored;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    // Stop the list scrolling behind the sheet on mobile.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onCancel]);

  const detail = [student.email, student.college].filter(Boolean).join(" · ");

  function check() {
    const problem = wpUsernameError(normalized);
    if (problem) {
      setError(problem);
      return false;
    }
    return true;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-white border border-[#dee4ff] rounded-2xl p-5"
      >
        <p className="text-xs uppercase tracking-widest text-[#646970] font-semibold mb-2">
          {marking ? "Mark present?" : "Remove attendance?"}
        </p>
        <p className="text-lg font-semibold text-[#1a1919] break-words leading-snug">
          {student.name}
        </p>
        {detail && <p className="text-xs text-[#646970] break-words mt-1">{detail}</p>}

        <div className="mt-5">
          <label
            htmlFor="dlg-wp"
            className="block text-sm font-medium text-[#1a1919] mb-1.5"
          >
            WordPress.org username
          </label>
          <div className="flex items-stretch rounded-lg border border-[#c9d4f9] overflow-hidden focus-within:border-[#3858e9] focus-within:ring-2 focus-within:ring-[#3858e9]/25">
            <span
              aria-hidden
              className="grid place-items-center px-3 text-[#646970] bg-[#f5f7fa] border-r border-[#dee4ff] select-none"
            >
              @
            </span>
            <input
              id="dlg-wp"
              value={handle}
              onChange={(e) => {
                setHandle(e.target.value);
                setError(null);
              }}
              placeholder="ask the student"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              className="flex-1 min-w-0 px-3 py-3 text-base text-[#1a1919] outline-none"
            />
          </div>
          {error ? (
            <p className="text-xs text-[#f15a25] mt-1.5">{error}</p>
          ) : (
            <p className="text-xs text-[#646970] mt-1.5">
              Optional — they can add it themselves by scanning their QR.
            </p>
          )}

          {/* Only for someone already present: saving the handle is a separate
              action from removing their attendance, so neither is ambiguous. */}
          {!marking && changed && (
            <button
              type="button"
              onClick={() => check() && onSaveUsername(normalized)}
              className="w-full mt-3 rounded-lg py-3 font-semibold bg-[#3858e9] text-white"
            >
              Save username
            </button>
          )}
        </div>

        <div className="flex gap-3 mt-5">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3.5 rounded-lg border border-[#c9d4f9] text-[#40464d] font-medium"
          >
            No
          </button>
          <button
            type="button"
            onClick={() => check() && onConfirm(marking ? normalized : undefined)}
            className={`flex-1 py-3.5 rounded-lg font-semibold text-white ${
              marking ? "bg-[#3858e9]" : "bg-[#f15a25]"
            }`}
          >
            Yes
          </button>
        </div>
      </div>
    </div>
  );
}

// "J.P. Dawer Institute of Information Science and Technology (VNSGU)" -> "VNSGU".
// Full names are far too long for a filter chip on a phone.
function shortCollege(name: string) {
  const paren = name.match(/\(([^)]+)\)/);
  if (paren) return paren[1].trim();
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length <= 2) return name;
  const skip = new Set(["of", "and", "the", "for", "in", "&", "-"]);
  const acronym = words
    .filter((w) => !skip.has(w.toLowerCase()))
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return acronym.length >= 2 ? acronym : words.slice(0, 2).join(" ");
}

function ChipRow({
  label,
  options,
  active,
  onPick,
  format,
}: {
  label: string;
  options: [string, number][];
  active: string | null;
  onPick: (v: string | null) => void;
  format?: (v: string) => string;
}) {
  const chip = (on: boolean) =>
    `shrink-0 text-xs font-semibold rounded-full px-3 py-2 border ${
      on ? "bg-[#3858e9] text-white border-[#3858e9]" : "border-[#c9d4f9] text-[#40464d] bg-white"
    }`;
  return (
    <div className="flex items-center gap-2 mt-3">
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-[#646970] w-12">
        {label}
      </span>
      <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button type="button" onClick={() => onPick(null)} className={chip(active === null)}>
          All
        </button>
        {options.map(([value, n]) => (
          <button
            key={value}
            type="button"
            title={value}
            onClick={() => onPick(active === value ? null : value)}
            className={chip(active === value)}
          >
            {format ? format(value) : value} <span className="opacity-60">{n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AttendanceTab({
  students,
  q,
  setQ,
  loading,
  onToggle,
  colleges,
  college,
  setCollege,
  years,
  year,
  setYear,
}: {
  students: Student[];
  q: string;
  setQ: (v: string) => void;
  loading: boolean;
  onToggle: (s: Student) => void;
  colleges: [string, number][];
  college: string | null;
  setCollege: (v: string | null) => void;
  years: [string, number][];
  year: string | null;
  setYear: (v: string | null) => void;
}) {
  const count = students.length;
  const presentHere = students.filter((s) => s.attended).length;
  const missingHandle = students.filter((s) => s.attended && !s.wp_username).length;
  return (
    <div>
      {/* Sticky: a volunteer scrolling a long list can re-search without
          scrolling back to the top. text-base keeps iOS from zooming on focus. */}
      <div className="sticky top-0 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-1 pb-3 bg-[#f2f6ff]">
        <div className="relative w-full max-w-md">
          <input
            autoFocus
            type="search"
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="Search name, email, or college..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full bg-[#ffffff] border border-[#c9d4f9] rounded-lg pl-4 pr-11 py-3 text-base outline-none focus:border-[#3858e9] [&::-webkit-search-cancel-button]:hidden"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-10 w-10 grid place-items-center text-[#646970] hover:text-[#1a1919]"
            >
              &#10005;
            </button>
          )}
        </div>
        {colleges.length > 1 && (
          <ChipRow
            label="College"
            options={colleges}
            active={college}
            onPick={setCollege}
            format={shortCollege}
          />
        )}
        {years.length > 1 && (
          <ChipRow label="Year" options={years} active={year} onPick={setYear} />
        )}

        {!loading && (
          <p className="text-xs text-[#646970] mt-2">
            {q ? `${count} match${count === 1 ? "" : "es"}` : `${count} student${count === 1 ? "" : "s"}`}
            {" · "}
            <span className="text-[#3858e9]">{presentHere} present</span>
            {missingHandle > 0 && (
              <>
                {" · "}
                <span className="text-[#f15a25]">{missingHandle} need a username</span>
              </>
            )}
          </p>
        )}
      </div>

      {loading ? (
        <p className="text-[#646970]">Loading...</p>
      ) : (
        <div className="grid gap-2">
          {students.map((s) => (
            <button
              key={s.id}
              onClick={() => onToggle(s)}
              className={`text-left w-full min-w-0 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 min-h-[56px] transition ${
                s.attended
                  ? "border-[#3858e9] bg-[#3858e9]/10"
                  : "border-[#dee4ff] bg-[#ffffff] hover:border-[#c9d4f9]"
              }`}
            >
              {/* min-w-0 + truncate: without these a long email pushes the
                  status pill off the edge on a narrow phone screen. */}
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{s.name}</div>
                <div className="text-xs truncate">
                  {/* A handle is the useful fact once someone is present; until
                      then the email is. Missing handles stay quiet here — the
                      running total above is what flags them. */}
                  {/* Once someone is present their handle is the useful fact,
                      so it replaces the email rather than crowding it into a
                      line that truncates mid-word. */}
                  {s.attended ? (
                    s.wp_username ? (
                      <span className="text-[#3858e9] font-medium">@{s.wp_username}</span>
                    ) : (
                      <span className="text-[#646970]">No username yet</span>
                    )
                  ) : (
                    <span className="text-[#646970]">
                      {[s.email, college ? null : s.college && shortCollege(s.college)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </div>
              </div>
              <div
                className={`shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded-full ${
                  s.attended ? "bg-[#3858e9] text-white" : "bg-[#dee4ff] text-[#646970]"
                }`}
              >
                <span className="sm:hidden">{s.attended ? "Present" : "Mark"}</span>
                <span className="hidden sm:inline">{s.attended ? "Present" : "Tap to mark"}</span>
              </div>
            </button>
          ))}
          {count === 0 && (
            <p className="text-[#646970] text-sm">
              {q ? "Koi match nahi mila." : "No students found. Import the sheet first."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

type ImportReport = {
  totalRows: number;
  inserted: number;
  skippedDuplicate: number;
  skippedInvalid: number;
  details: { row: number; name: string; email: string | null; reason: string }[];
};

function ImportTab({ onImported }: { onImported: () => void }) {
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRows, setShowRows] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setReport(null);
    setError(null);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    // Send every column untouched — the server maps the known ones and keeps
    // the rest in `attributes`. __row is the sheet row number for the report.
    const payload = rows.map((r, i) => ({ ...r, __row: i + 2 }));

    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ students: payload }),
    });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(body.error || "Import failed");
      return;
    }
    setReport(body);
    onImported();
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="max-w-xl">
      <p className="text-sm text-[#40464d] mb-4">
        Upload the registration sheet (.xlsx or .csv). Only{" "}
        <span className="text-[#3858e9] font-semibold">Name</span> is required. Email, Phone and
        College are auto-detected; every other column is stored with the student.
      </p>
      <div
        onClick={() => fileRef.current?.click()}
        className="cursor-pointer border-2 border-dashed border-[#c9d4f9] rounded-xl p-8 sm:p-10 text-center hover:border-[#3858e9] bg-white"
      >
        <div className="text-3xl mb-2">📄</div>
        <div className="text-sm text-[#40464d]">
          {busy ? "Importing..." : "Click to choose file"}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </div>

      {error && (
        <p className="mt-4 text-sm text-[#f15a25] bg-white border border-[#f15a25]/40 rounded-lg p-3">
          {error}
        </p>
      )}

      {report && (
        <div className="mt-4 bg-white border border-[#dee4ff] rounded-xl p-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-2xl font-bold text-[#3858e9]">{report.inserted}</div>
              <div className="text-[11px] uppercase tracking-wide text-[#646970]">Imported</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-[#f15a25]">{report.skippedDuplicate}</div>
              <div className="text-[11px] uppercase tracking-wide text-[#646970]">Duplicate</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-[#646970]">{report.skippedInvalid}</div>
              <div className="text-[11px] uppercase tracking-wide text-[#646970]">No name</div>
            </div>
          </div>

          {report.details.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowRows((v) => !v)}
                className="mt-4 text-sm text-[#3858e9] font-semibold"
              >
                {showRows ? "Hide" : "Show"} {report.details.length} skipped row
                {report.details.length === 1 ? "" : "s"}
              </button>
              {showRows && (
                <div className="mt-3 max-h-72 overflow-y-auto border-t border-[#dee4ff] pt-3 grid gap-2">
                  {report.details.map((d, i) => (
                    <div key={i} className="text-xs min-w-0">
                      <div className="font-medium text-[#1a1919] truncate">
                        {d.row ? `Row ${d.row}: ` : ""}
                        {d.name || "(no name)"}
                      </div>
                      <div className="text-[#646970] truncate">
                        {d.email ? `${d.email} — ` : ""}
                        {d.reason}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ScanTab({ onMarked }: { onMarked: () => void }) {
  const scannerRef = useRef<HTMLDivElement>(null);
  const [msg, setMsg] = useState<string>("Point the camera at a student's QR code");
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let html5QrCode: import("html5-qrcode").Html5Qrcode | null = null;
    let cancelled = false;

    async function start() {
      const { Html5Qrcode } = await import("html5-qrcode");
      if (cancelled || !scannerRef.current) return;
      html5QrCode = new Html5Qrcode(scannerRef.current.id);
      try {
        await html5QrCode.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 250 },
          async (decodedText) => {
            // decodedText is the full checkin URL; extract the token
            const token = decodedText.split("/checkin/")[1] || decodedText;
            setMsg("Checking in...");
            const res = await fetch("/api/checkin", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token }),
            });
            const body = await res.json();
            if (!res.ok) {
              setMsg(`❌ ${body.error || "Invalid code"}`);
            } else {
              setMsg(
                body.alreadyMarked
                  ? `👋 ${body.student.name} already checked in`
                  : `✅ ${body.student.name} marked present`
              );
              onMarked();
            }
          },
          undefined
        );
        setScanning(true);
      } catch {
        setMsg("Camera access denied or unavailable. Use search-tap instead.");
      }
    }
    start();

    return () => {
      cancelled = true;
      if (html5QrCode) {
        html5QrCode.stop().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-md">
      <div
        id="qr-scanner-region"
        ref={scannerRef}
        className="w-full rounded-xl overflow-hidden mb-4 bg-[#ffffff]"
      />
      <p className="text-sm text-[#3858e9]">{msg}</p>
      {!scanning && (
        <p className="text-xs text-[#646970] mt-2">
          Requires camera permission — works best on a phone/tablet browser over HTTPS.
        </p>
      )}
    </div>
  );
}

function QrTab({
  students,
  college,
  year,
}: {
  students: Student[];
  college: string | null;
  year: string | null;
}) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  async function downloadAllPng() {
    // Generates one PNG per student with name + QR, zipped is overkill here —
    // simplest reliable path is a printable HTML page.
    window.print();
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <p className="text-sm text-[#40464d]">
          {(college || year) && (
            <span className="block text-[#3858e9] font-semibold mb-1">
              {[college && shortCollege(college), year].filter(Boolean).join(" · ")} —{" "}
              {students.length} students
            </span>
          )}
          Each student&apos;s personal QR — send it to them beforehand, or print this page as their
          entry pass. Scanning it opens their self check-in link.
        </p>
        <button
          onClick={downloadAllPng}
          className="text-sm bg-[#3858e9] text-white font-semibold rounded-lg px-4 py-2.5 whitespace-nowrap self-start sm:self-auto sm:ml-4 print:hidden"
        >
          Print all
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
        {students.map((s) => (
          <QrCard key={s.id} student={s} origin={origin} />
        ))}
      </div>
    </div>
  );
}

function QrCard({ student, origin }: { student: Student; origin: string }) {
  const [dataUrl, setDataUrl] = useState("");
  useEffect(() => {
    if (!origin) return;
    QRCode.toDataURL(`${origin}/checkin/${student.qr_token}`, { margin: 1, width: 240 }).then(
      setDataUrl
    );
  }, [origin, student.qr_token]);

  return (
    <div className="min-w-0 border border-[#dee4ff] rounded-lg p-3 text-center bg-[#ffffff]">
      {dataUrl && <img src={dataUrl} alt="" className="w-full rounded" />}
      <div className="text-xs mt-2 truncate">{student.name}</div>
    </div>
  );
}

function ExportTab({
  students,
  college,
  year,
}: {
  students: Student[];
  college: string | null;
  year: string | null;
}) {
  const presentCount = students.filter((s) => s.attended).length;
  const params = new URLSearchParams();
  if (college) params.set("college", college);
  if (year) params.set("year", year);
  const qs = (scope: "present" | "all") => {
    const p = new URLSearchParams(params);
    p.set("scope", scope);
    return `/api/export?${p.toString()}`;
  };

  const filterLabel = [college && shortCollege(college), year].filter(Boolean).join(" · ");

  const btn =
    "block text-center rounded-lg px-5 py-3.5 font-semibold border transition";

  return (
    <div className="max-w-md">
      <p className="text-sm text-[#40464d] mb-1">
        Rows come out sorted by <span className="text-[#3858e9]">year</span>, then name A–Z within
        each year.
      </p>
      <p className="text-sm text-[#40464d] mb-4">
        First column is <span className="text-[#3858e9]">Name</span>, ready for Canva&apos;s Bulk
        Create.
      </p>

      {filterLabel ? (
        <p className="text-xs bg-white border border-[#dee4ff] rounded-lg px-3 py-2 mb-4">
          Filter active: <span className="text-[#3858e9] font-semibold">{filterLabel}</span> — the
          download only includes these students.
        </p>
      ) : (
        <p className="text-xs text-[#646970] mb-4">
          No filter — every college and year is included. Use the Attendance tab to narrow it.
        </p>
      )}

      <div className="grid gap-3">
        <a href={qs("present")} className={`${btn} bg-[#3858e9] text-white border-[#3858e9]`}>
          Present only ({presentCount})
        </a>
        <a
          href={qs("all")}
          className={`${btn} bg-white text-[#3858e9] border-[#c9d4f9]`}
        >
          Full registered list ({students.length})
        </a>
      </div>
    </div>
  );
}

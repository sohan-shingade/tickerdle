import { useEffect, useMemo, useRef, useState } from "react";
import type { Settings, Stats, Sector } from "../types";
import { COMPANIES, BY_NAME } from "../data/companies";
import { PUZZLES, OPENING_WEEK } from "../data/puzzles";
import { dayNumber } from "../lib/daily";
import { canonical, sameCompany, capBand } from "../lib/grading";
import {
  loadSettings, saveSettings, loadStats, saveStats, loadDaily, saveDaily,
  loadSeenIntro, saveSeenIntro,
} from "../lib/storage";

// Guesses scale with word length: short words get the classic 6, longer ones
// get one extra try per slot beyond 6 (7-slot → 8, 8-slot → 9). The per-slot
// search space is large, so longer answers earn more attempts.
const triesFor = (n: number) => (n >= 7 ? n + 1 : 6);
const MAX_TRIES = 9; // ceiling across all puzzles — used to size the stats histogram
const PRINTABLE = /^[a-z0-9 .&]$/i;

// Which puzzle is the daily for a given day number. The first week is a curated
// run of crowd-pleasers (OPENING_WEEK); after that it falls back to a rotation.
function dailyIdxForDay(day: number): number {
  if (day >= 1 && day <= OPENING_WEEK.length) {
    const i = PUZZLES.findIndex((p) => p.name === OPENING_WEEK[day - 1]);
    if (i >= 0) return i;
  }
  return ((day % PUZZLES.length) + PUZZLES.length) % PUZZLES.length;
}

export function useGame() {
  const [DAY, setDAY] = useState(() => dayNumber());
  const DAILY_IDX = useMemo(() => dailyIdxForDay(DAY), [DAY]);

  const [mode, setMode] = useState<"daily" | "forever">("daily");
  const [pIdx, setPIdx] = useState(DAILY_IDX);
  const puzzle = PUZZLES[pIdx];
  const ANSWER = puzzle.members;
  const N = ANSWER.length;
  const MAX = triesFor(N);
  const isDaily = mode === "daily";

  // restore today's daily board on first load
  const saved = useMemo(() => loadDaily(DAY), [DAY]);
  const [rows, setRows] = useState<string[][]>(isDaily && saved ? saved.rows : []);
  const [picks, setPicks] = useState<(string | null)[]>(Array(N).fill(null));
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [sectorFilter, setSectorFilter] = useState<Sector | "all">("all");
  const [capFilter, setCapFilter] = useState<string>("all");

  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [stats, setStats] = useState<Stats>(loadStats);
  const [toast, setToast] = useState("");
  const [shake, setShake] = useState(false);
  const [confetti, setConfetti] = useState(false);
  const [shareText, setShareText] = useState("");
  const [modal, setModal] = useState<"intro" | "help" | "stats" | "settings" | null>(
    loadSeenIntro() ? null : "intro",
  );
  function dismissIntro() { saveSeenIntro(); setModal(null); }

  const inputRef = useRef<HTMLInputElement | null>(null);
  const countedKey = useRef<string | null>(null); // guards double stat counting

  const ANSWER_SET = useMemo(() => new Set(ANSWER.map(canonical)), [pIdx]);
  const inAnswer = (p: string) => ANSWER_SET.has(canonical(p));
  const won = rows.some((r) => r.every((p, i) => sameCompany(p, ANSWER[i])));
  const lost = !won && rows.length >= MAX;
  const done = won || lost;
  const filled = picks.every(Boolean);

  const list = useMemo(() => {
    // Sector + market-cap filters narrow the universe before text ranking.
    const base = COMPANIES.filter(
      (c) =>
        (sectorFilter === "all" || c.sector === sectorFilter) &&
        (capFilter === "all" || capBand(c.cap) === capFilter),
    );
    const s = q.trim().toLowerCase();
    if (!s) return base;
    // Rank: exact > prefix > word-boundary > substring; ties keep original order.
    const rank = (name: string) => {
      const n = name.toLowerCase();
      if (n === s) return 0;
      if (n.startsWith(s)) return 1;
      if (n.split(/[^a-z0-9]+/).some((w) => w.startsWith(s))) return 2;
      return 3;
    };
    return base
      .map((c, i) => ({ c, i, r: rank(c.name) }))
      .filter((x) => x.c.name.toLowerCase().includes(s))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.c);
  }, [q, sectorFilter, capFilter]);

  const known = useMemo(() => {
    const m: Record<string, "in" | "out"> = {};
    rows.forEach((r) => r.forEach((p) => { const k = canonical(p); if (p && !m[k]) m[k] = inAnswer(p) ? "in" : "out"; }));
    return m;
  }, [rows, pIdx]);

  const fixedSlots = useMemo(() => {
    const f: Record<number, string> = {};
    rows.forEach((r) => r.forEach((p, i) => { if (sameCompany(p, ANSWER[i])) f[i] = ANSWER[i]; }));
    return f;
  }, [rows, pIdx]);

  const requiredCos = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.forEach((p) => { if (p && inAnswer(p)) s.add(canonical(p)); }));
    return [...s];
  }, [rows, pIdx]);

  const learned = useMemo(() => {
    const out: string[] = [];
    rows.forEach((r) => r.forEach((p, i) => { if (sameCompany(p, ANSWER[i]) && !out.includes(ANSWER[i])) out.push(ANSWER[i]); }));
    return out;
  }, [rows, pIdx]);

  // ── persistence ──────────────────────────────────────────────
  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { saveStats(stats); }, [stats]);
  useEffect(() => { if (isDaily) saveDaily(DAY, { rows, done, won }); }, [rows, isDaily, DAY, done, won]);

  // ── ephemeral effects ────────────────────────────────────────
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 1800); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { if (openSlot !== null) setTimeout(() => inputRef.current?.focus(), 0); }, [openSlot]);

  // On first load, open the first empty slot so it's obvious how to start.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current) return;
    autoOpened.current = true;
    if (!done && picks.every((p) => !p)) setOpenSlot(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── midnight rollover ────────────────────────────────────────
  // Poll dayNumber() every minute so an open tab picks up the new daily without
  // a manual refresh. setDAY with an unchanged value is a no-op rerender, so
  // this is cheap and self-heals after sleep/wake or a foreground tab crossing
  // midnight (cases a one-shot setTimeout + visibilitychange would miss).
  useEffect(() => {
    const tick = () => setDAY(dayNumber());
    const id = setInterval(tick, 60_000);
    const onVis = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  // When the day actually changes, load the new daily board (only if the player
  // is on the daily — don't yank someone out of a Forever round).
  const prevDay = useRef(DAY);
  useEffect(() => {
    if (prevDay.current === DAY) return;
    prevDay.current = DAY;
    if (mode !== "daily") return;
    countedKey.current = null;
    setPIdx(DAILY_IDX);
    setRows(loadDaily(DAY)?.rows ?? []);
    setPicks(Array(PUZZLES[DAILY_IDX].members.length).fill(null));
    setOpenSlot(null); setQ(""); setShareText(""); setToast("New puzzle — good luck!");
  }, [DAY, DAILY_IDX, mode]);

  // ── actions ──────────────────────────────────────────────────
  function flash(msg: string) { setToast(msg); setShake(true); setTimeout(() => setShake(false), 500); }

  function choose(name: string) {
    if (openSlot === null) return;
    const np = picks.map((x, i) => (i === openSlot ? name : x));
    let next: number | null = null;
    for (let k = 1; k <= N; k++) { const idx = (openSlot + k) % N; if (!np[idx]) { next = idx; break; } }
    setPicks(np); setOpenSlot(next); setQ("");
  }

  function countResult(isWin: boolean, used: number) {
    const key = `${pIdx}:${rows.length}`; // one count per finished game
    if (countedKey.current === key) return;
    countedKey.current = key;
    setStats((s) => {
      const dist = { ...s.dist };
      if (isWin) dist[used] = (dist[used] || 0) + 1;
      let { cur, max, lastDay } = s;
      if (isDaily) {
        cur = isWin ? (lastDay === DAY - 1 ? cur + 1 : 1) : 0;
        max = Math.max(max, cur);
        lastDay = DAY;
      }
      return { played: s.played + 1, wins: s.wins + (isWin ? 1 : 0), cur, max, lastDay, dist };
    });
  }

  function submit() {
    if (done) return;
    if (!filled) { flash("Fill every slot"); return; }
    if (settings.hard) {
      for (const i of Object.keys(fixedSlots)) {
        const idx = Number(i);
        if (!sameCompany(picks[idx] ?? "", fixedSlots[idx])) { flash(`Slot ${idx + 1} must stay ${fixedSlots[idx]}`); return; }
      }
      for (const c of requiredCos) if (!picks.some((p) => p != null && sameCompany(p, c))) { flash(`Hard mode: reuse ${c}`); return; }
    }
    const guess = picks as string[];
    const next = [...rows, guess];
    const isWin = guess.every((p, i) => p === ANSWER[i]);
    setRows(next); setPicks(Array(N).fill(null)); setOpenSlot(null);
    if (isDaily && (isWin || next.length >= MAX)) countResult(isWin, next.length);
    if (isWin) {
      setToast(["", "Genius", "Magnificent", "Impressive", "Splendid", "Great", "Phew"][next.length] || "Solved!");
      setConfetti(true); setTimeout(() => setConfetti(false), 1900);
    } else if (next.length >= MAX) setToast("Out of tries");
  }

  function removeLast() {
    let last = -1;
    for (let i = N - 1; i >= 0; i--) if (picks[i]) { last = i; break; }
    if (last >= 0) { setPicks(picks.map((x, i) => (i === last ? null : x))); setOpenSlot(last); setQ(""); }
  }

  function openSlotAt(i: number) { setOpenSlot(openSlot === i ? null : i); setQ(""); }

  function resetBoardTo(ni: number) {
    countedKey.current = null;
    setPIdx(ni); setRows([]); setPicks(Array(PUZZLES[ni].members.length).fill(null));
    setOpenSlot(null); setQ(""); setToast(""); setShareText("");
  }

  // A random puzzle different from the current one (forever mode is endless and
  // order-independent, so a shuffle beats a fixed cycle for replay variety).
  function randomIdx(not: number) {
    if (PUZZLES.length < 2) return 0;
    let ni = not;
    while (ni === not) ni = Math.floor(Math.random() * PUZZLES.length);
    return ni;
  }

  // Daily is locked to one play; forever mode is the separate free-play space.
  function startForever() { setMode("forever"); resetBoardTo(randomIdx(pIdx)); }
  function nextForever() { resetBoardTo(randomIdx(pIdx)); }
  function backToDaily() {
    setMode("daily");
    countedKey.current = null;
    setPIdx(DAILY_IDX);
    setRows(saved ? saved.rows : []);
    setPicks(Array(PUZZLES[DAILY_IDX].members.length).fill(null));
    setOpenSlot(null); setQ(""); setToast(""); setShareText("");
  }

  function buildShare() {
    const tag = isDaily ? `#${DAY}` : `∞ ${puzzle.name}`;
    const head = `ACRODLE ${tag}  ${won ? rows.length : "X"}/${MAX}${settings.hard ? "*" : ""}`;
    const grid = rows
      .map((r) => r.map((p, i) => (sameCompany(p, ANSWER[i]) ? "🟩" : inAnswer(p) ? "🟨" : "⬛")).join(""))
      .join("\n");
    return `${head}\n${grid}`;
  }
  async function share() {
    const text = buildShare();
    try { await navigator.clipboard.writeText(text); setToast("Results copied"); }
    catch { setShareText(text); }
  }
  // Native OS share sheet (mobile) — routes to X app, Messages, etc.; falls
  // back to clipboard, then to the on-screen textarea.
  async function nativeShare() {
    const text = buildShare();
    const url = typeof location !== "undefined" ? location.href : "";
    if (typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share({ title: "ACRODLE", text, url }); return; }
      catch { /* user dismissed the sheet — fall through to copy */ }
    }
    try { await navigator.clipboard.writeText(url ? `${text}\n${url}` : text); setToast("Results copied"); }
    catch { setShareText(text); }
  }

  // ── physical keyboard ────────────────────────────────────────
  function handleKey(e: KeyboardEvent) {
    if (modal || done || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Enter") {
      if (openSlot !== null) { if (list.length) choose(list[0].name); }
      else if (filled) submit();
      return;
    }
    if (e.key === "Backspace") {
      if (openSlot !== null && q.length > 0) return; // editing the query
      e.preventDefault(); removeLast(); return;
    }
    if (e.key.length === 1 && PRINTABLE.test(e.key)) {
      // If the search box already has focus, let it insert the character
      // natively — handling it here too would type the letter twice.
      if (document.activeElement === inputRef.current) return;
      // Don't hijack keystrokes meant for the filter dropdowns.
      if (document.activeElement instanceof HTMLSelectElement) return;
      e.preventDefault();
      if (openSlot === null) {
        const idx = picks.findIndex((p) => !p);
        if (idx < 0) return;
        setOpenSlot(idx); setQ(e.key);
      } else {
        setQ((s) => s + e.key);
      }
      // Focus on the NEXT frame, not synchronously: focusing the input during
      // this same keydown can let the browser also deliver this keystroke to it,
      // producing a duplicated first letter. Deferring avoids that race.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }
  useEffect(() => {
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  // Keep the search box focused whenever a slot is open, so every keystroke
  // flows through the input's own handler (one source of truth, no doubling).
  useEffect(() => { if (openSlot !== null) inputRef.current?.focus(); }, [openSlot]);

  return {
    MAX, MAX_TRIES, DAY, puzzle, N, isDaily, mode,
    rows, picks, openSlot, q, filled, won, lost, done,
    list, known, learned, BY_NAME,
    sectorFilter, capFilter, setSectorFilter, setCapFilter,
    settings, stats, toast, shake, confetti, shareText, modal, inputRef,
    setQ, choose, submit, removeLast, openSlotAt, startForever, nextForever, backToDaily, share, nativeShare, buildShare, setModal, dismissIntro,
    toggleDark: () => setSettings((s) => ({ ...s, dark: !s.dark })),
    toggleCb: () => setSettings((s) => ({ ...s, colorblind: !s.colorblind })),
    toggleHard: () => {
      if (rows.length && !settings.hard) { flash("Hard mode locks once you've guessed"); return; }
      setSettings((s) => ({ ...s, hard: !s.hard }));
    },
    resetStatsGuard: () => { countedKey.current = null; },
  };
}

export type Game = ReturnType<typeof useGame>;

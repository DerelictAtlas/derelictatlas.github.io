// SITE integration: end-reward placeholder (user 2026-11-03: "a new gray question mark end reward that is vague but
// similar in look of them to sit where they are supposed to be shown, it will always be there instead of the appearing
// and disappearing, then it can be clicked with a question on top of it that says "Reveal end reward?"").
// Classic script, loaded before the app module. modern.js (integrate.py REWARD_EDITS) asks window.dvRewardSlot() for the
// reward cell of a list card and of the viewer summary: the real reward when "Show End Reward" is on or this system was
// revealed, otherwise a gray "?" badge with the same shape and size (reward-icons/hidden.svg). Revealed systems are kept
// per address in localStorage dv.revealed.v1; "Hide End Reward" clears them (dvRewardHideAll).
(function () {
  "use strict";
  const KEY = "dv.revealed.v1";
  let revealed = new Set();
  try { const a = JSON.parse(localStorage.getItem(KEY) || "[]"); if (Array.isArray(a)) revealed = new Set(a.filter((x) => /^[0-9A-F]{16}$/.test(x))); } catch (_) { /* private mode */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...revealed].slice(-5000))); } catch (_) {} };
  const QUESTION = "Reveal end reward?";

  window.dvRewardRevealed = (address) => revealed.has(String(address || "").toUpperCase());
  window.dvRewardHideAll = () => { if (revealed.size) { revealed.clear(); save(); } syncCurrent(); };
  // the open system (viewer): its "End reward value" extras card follows the same reveal (body.dv-cur-revealed)
  const currentAddress = () => { try { return String(window.dvShareCurrent?.()?.row?.address || "").toUpperCase(); } catch (_) { return ""; } };
  function syncCurrent(address) {
    if (!document.body) return;
    address = address || currentAddress();
    document.body.classList.toggle("dv-cur-revealed", !!address && revealed.has(address));
  }
  function reveal(address) {
    address = String(address || "").toUpperCase();
    if (!/^[0-9A-F]{16}$/.test(address)) return;
    revealed.add(address); save();
    hideBubble(); syncCurrent();
    window.dvRewardRefresh?.();
  }
  window.dvRewardReveal = reveal;

  // the placeholder mirrors rewards.js rewardMarkup(): same classes and children, so the card and summary layouts are
  // identical hidden or shown (only the picture and the words differ)
  // A re-render while the question is open (the phone summary re-renders right after a tap) keeps the "?" lit and moves
  // the bubble onto the new badge.
  const asking = (address) => askFor === address && Date.now() - askAt < 15000;
  let reattach = 0;
  function reattachSoon() {
    if (reattach) return;
    reattach = requestAnimationFrame(() => {
      reattach = 0;
      if (!askFor || (bubbleFor && bubbleFor.isConnected)) return;
      const n = [...document.querySelectorAll(".reward-reveal.ask")].find((x) => x.dataset.reveal === askFor && x.getClientRects().length);
      if (n) showBubble(n);
    });
  }
  function placeholder(address, compact) {
    const ask = asking(address);
    if (ask) reattachSoon();
    return `<div class="${compact ? "" : "summary-metric "}end-reward reward reward-hidden" data-reward-type="hidden">` +
      `<button type="button" class="reward-art reward-reveal${ask ? " ask" : ""}" data-reveal="${address}" aria-pressed="${ask}" aria-label="${QUESTION}" data-ask="${QUESTION}">` +
      `<img src="reward-icons/hidden.svg" alt=""></button>` +
      `<span class="reward-copy"><span class="reward-label">End reward</span><span class="sr-only">Hidden. </span>` +
      // user 2026-11-04: the open system says just "Click to reveal" (no "Hidden (?)" / "Click the ? to reveal")
      (compact ? `<small class="reward-name">Hidden <span class="reward-class-inline">(?)</span></small>` : `<small class="reward-name reward-click">Click to reveal</small>`) + `</span></div>`;
  }
  window.dvRewardSlot = (r, compact, showAll, real) => {
    const address = String((r && r.address) || "").toUpperCase();
    if (!compact) syncCurrent(address);
    if (showAll || !address || revealed.has(address)) return real();
    return placeholder(address, compact);
  };

  // Clicks: capture phase, so the list card (role=button) under the badge does not open as well. Touch: the first tap
  // shows the question, the second reveals; mouse/keyboard: one click reveals (the question shows on hover/focus).
  let lastPointer = "mouse", askFor = "", askAt = 0;
  document.addEventListener("pointerdown", (e) => { lastPointer = e.pointerType || "mouse"; }, true);
  // targets: the "?" badge, or the hidden "End reward value" card of the open system
  const HIDDEN_EXTRA = 'body:not(.show-reward):not(.dv-cur-revealed) :is(.atlas-extras, #details-body) [data-extra-label^="End reward"]';
  const target = (e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return null;
    const b = t.closest(".reward-reveal[data-reveal]");
    if (b) return b;
    // user 2026-11-04: the whole hidden End reward block of the open system (icon or text) hovers / clicks like the "?"
    const blk = t.closest(".summary-metric.end-reward.reward-hidden");
    if (blk) { const bb = blk.querySelector(".reward-reveal[data-reveal]"); if (bb) return bb; }
    const x = t.closest('[data-extra-label^="End reward"]');
    if (x && x.matches(HIDDEN_EXTRA)) { x.dataset.reveal = currentAddress(); x.classList.add("reward-reveal"); return x.dataset.reveal ? x : null; }
    return null;
  };
  const clearAsk = () => { document.querySelectorAll(".reward-reveal.ask").forEach((x) => { x.classList.remove("ask"); if (x.matches("button")) x.setAttribute("aria-pressed", "false"); }); };
  document.addEventListener("click", (e) => {
    // user 2026-11-03 (phone): "Pressing in reveal end reward after pressing icon just closes the popup" -> the question
    // bubble itself is a button that reveals the system it asks about (it used to let taps fall through and close)
    const q = e.target && e.target.closest ? e.target.closest(".reward-ask-bubble") : null;
    if (q) { e.preventDefault(); e.stopPropagation(); const a = (bubbleFor && bubbleFor.dataset.reveal) || askFor; clearAsk(); askFor = ""; if (a) reveal(a); else hideBubble(); return; }
    const b = target(e);
    if (!b) { clearAsk(); askFor = ""; hideBubble(); return; }
    e.preventDefault(); e.stopPropagation();
    if (lastPointer === "touch" && !(askFor === b.dataset.reveal && Date.now() - askAt < 15000)) {
      clearAsk();
      b.classList.add("ask"); if (b.matches("button")) b.setAttribute("aria-pressed", "true"); askFor = b.dataset.reveal; askAt = Date.now();
      showBubble(b);
      return;
    }
    askFor = "";
    reveal(b.dataset.reveal);
  }, true);
  document.addEventListener("keydown", (e) => {
    const b = target(e);
    if (!b || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault(); e.stopPropagation();
    reveal(b.dataset.reveal);
  }, true);
  document.addEventListener("pointerup", (e) => { lastPointer = e.pointerType || lastPointer; }, true);
  document.addEventListener("touchstart", () => { lastPointer = "touch"; }, { capture: true, passive: true });

  // The question bubble floats above the badge (position: fixed on <body>), so the summary slot and the windowed list,
  // which clip their content, never cut it off.
  // It is a button: tapping or clicking the question reveals (the "?" itself still works too).
  let bubble = null, bubbleFor = null, hideTimer = 0;
  function showBubble(b) {
    clearTimeout(hideTimer);
    if (!bubble) { bubble = document.createElement("button"); bubble.type = "button"; bubble.className = "reward-ask-bubble"; bubble.tabIndex = -1; bubble.textContent = QUESTION; document.body.append(bubble);
      // pressing it must not take the focus from the "?" (focusout would hide it before the click lands)
      bubble.addEventListener("mousedown", (e) => e.preventDefault()); }
    bubbleFor = b;
    const r = b.getBoundingClientRect();
    bubble.hidden = false;
    const w = bubble.offsetWidth, h = bubble.offsetHeight;
    let x = r.left + r.width / 2 - w / 2, y = r.top - h - 6;
    x = Math.max(6, Math.min(x, innerWidth - w - 6));
    if (y < 6) y = r.bottom + 6;
    bubble.style.left = Math.round(x) + "px"; bubble.style.top = Math.round(y) + "px";
  }
  function hideBubble(b) { clearTimeout(hideTimer); if (bubble && (!b || b === bubbleFor)) { bubble.hidden = true; bubbleFor = null; } }
  window.dvRewardBubbleText = () => (bubble && !bubble.hidden ? bubble.textContent : "");
  // mouse: leaving the "?" waits a moment, so the pointer can move onto the question and click it
  const hideSoon = (b) => { clearTimeout(hideTimer); hideTimer = setTimeout(() => { if (!(b && b.classList.contains("ask"))) hideBubble(b); }, 350); };
  const inBubble = (n) => !!(bubble && n && bubble.contains(n));
  document.addEventListener("pointerover", (e) => { if (inBubble(e.target)) { clearTimeout(hideTimer); return; } const b = target(e); if (b && e.pointerType !== "touch") showBubble(b); }, true);
  document.addEventListener("pointerout", (e) => {
    if (inBubble(e.target)) { if (!(bubbleFor && bubbleFor.contains(e.relatedTarget))) hideSoon(bubbleFor); return; }
    const b = target(e); if (b && !b.classList.contains("ask") && !inBubble(e.relatedTarget)) hideSoon(b);
  }, true);
  document.addEventListener("focusin", (e) => { const b = target(e); if (b) showBubble(b); });
  document.addEventListener("focusout", (e) => { const b = target(e); if (b && !b.classList.contains("ask") && !inBubble(e.relatedTarget)) hideBubble(b); });
  // scrolling (also the scroll a keyboard focus makes) moves the bubble with its badge
  let raf = 0;
  addEventListener("scroll", () => {
    if (!bubbleFor || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; if (!bubbleFor) return; if (bubbleFor.isConnected) showBubble(bubbleFor); else hideBubble(); });
  }, true);
})();

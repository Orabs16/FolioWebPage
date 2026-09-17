/*
 * "My config" — the machine behind the numbers.
 *
 * Every performance claim on this site is a single-machine measurement, and a
 * number without a machine attached to it is decoration. Rather than repeat the
 * spec sheet next to each one (and let the copies drift apart), any page can
 * drop a small trigger next to a figure:
 *
 *     measured on <button type="button" class="spec-link" data-spec>my config</button>
 *
 * and this file turns it into a link that opens one shared panel. The spec
 * lives in SPEC below - edit it in one place, every page follows.
 *
 * The trigger is a real <button>, so with JS off it simply does nothing rather
 * than promising a panel that never arrives. Nothing around it depends on the
 * panel existing.
 */
(function () {
  "use strict";

  var triggers = document.querySelectorAll("[data-spec]");
  if (!triggers.length) return;

  var SPEC = [
    ["CPU", "Intel Core i7-12700H", "6P + 8E cores · 20 threads · AVX2"],
    ["GPU", "NVIDIA RTX 3060 Laptop", "6 GB GDDR6"],
    ["RAM", "64 GB DDR4-3200", "2 × 32 GB"],
    ["OS", "Windows 11", "MSVC · Unreal Engine 5"]
  ];

  var NOTE = "A laptop, not a workstation — which is the point. " +
    "Every timing on this site was measured here, so the ratios are honest " +
    "even where the absolute numbers would be higher on a desktop.";

  var overlay = null;   // built on first open, reused afterwards
  var lastFocus = null;

  function build() {
    overlay = document.createElement("div");
    overlay.className = "spec-overlay";
    overlay.hidden = true;

    var panel = document.createElement("div");
    panel.className = "spec-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Development machine specification");

    var html = '<p class="spec-eyebrow">// the machine</p>' +
      '<h2 class="spec-title">My config</h2><dl class="spec-list">';

    for (var i = 0; i < SPEC.length; i++) {
      html += "<div><dt>" + SPEC[i][0] + "</dt><dd><strong>" + SPEC[i][1] +
        "</strong><span>" + SPEC[i][2] + "</span></dd></div>";
    }

    html += "</dl><p class=\"spec-note\">" + NOTE + "</p>" +
      '<button type="button" class="spec-close" aria-label="Close">×</button>';

    panel.innerHTML = html;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // the backdrop closes, the panel itself doesn't - a click that starts on a
    // word and drifts a pixel shouldn't dismiss what you were reading
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });

    panel.querySelector(".spec-close").addEventListener("click", close);
  }

  function onKey(event) {
    if (event.key === "Escape" || event.keyCode === 27) close();
  }

  function open() {
    if (!overlay) build();

    lastFocus = document.activeElement;
    overlay.hidden = false;

    // the class lands a frame later so the transition has a state to run from
    requestAnimationFrame(function () { overlay.classList.add("is-open"); });

    document.addEventListener("keydown", onKey);
    overlay.querySelector(".spec-close").focus();
  }

  function close() {
    if (!overlay || overlay.hidden) return;

    overlay.classList.remove("is-open");
    overlay.hidden = true;

    document.removeEventListener("keydown", onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  for (var t = 0; t < triggers.length; t++) {
    triggers[t].addEventListener("click", open);
  }
})();

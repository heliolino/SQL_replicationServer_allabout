/* ============================================================
   SVG data-flow animation engine
   ------------------------------------------------------------
   Mark an inline SVG with data-animate (optional data-cycle="N"
   seconds per loop, default 10). Inside it, mark any <path> with:
     data-flow               make dots travel along this path
     data-start="2"          seconds into the cycle the first dot departs (default 0)
     data-travel="2.5"       seconds a dot takes to traverse the path (default 2.5)
     data-dots="3"           how many dots per cycle (default 3)
     data-gap="0.4"          seconds between dot departures (default 0.4)
     data-color="#2563eb"    dot color (default accent)
     data-size="4.5"         dot radius (default 4.5)
     data-shape="dot|cmd"    cmd = small rounded rect ("command"), default dot
   A play/pause button is injected into the diagram's .diagram-bar.
   ============================================================ */
(function () {
  "use strict";

  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var SVG_NS = "http://www.w3.org/2000/svg";

  function setupSvg(svg) {
    var cycle = parseFloat(svg.getAttribute("data-cycle")) || 10;
    var paths = svg.querySelectorAll("[data-flow]");
    if (!paths.length) return null;

    var overlay = document.createElementNS(SVG_NS, "g");
    overlay.setAttribute("class", "flow-overlay");
    svg.appendChild(overlay);

    var flows = [];
    Array.prototype.forEach.call(paths, function (p) {
      var len;
      try { len = p.getTotalLength(); } catch (e) { return; }
      var flow = {
        path: p,
        len: len,
        start: parseFloat(p.getAttribute("data-start")) || 0,
        travel: parseFloat(p.getAttribute("data-travel")) || 2.5,
        gap: parseFloat(p.getAttribute("data-gap")) || 0.4,
        color: p.getAttribute("data-color") || "var(--accent)",
        size: parseFloat(p.getAttribute("data-size")) || 4.5,
        shape: p.getAttribute("data-shape") || "dot",
        dots: []
      };
      var nDots = parseInt(p.getAttribute("data-dots"), 10) || 3;
      for (var i = 0; i < nDots; i++) {
        var el;
        if (flow.shape === "cmd") {
          el = document.createElementNS(SVG_NS, "rect");
          el.setAttribute("width", flow.size * 2.4);
          el.setAttribute("height", flow.size * 1.5);
          el.setAttribute("rx", 2);
        } else {
          el = document.createElementNS(SVG_NS, "circle");
          el.setAttribute("r", flow.size);
        }
        el.setAttribute("class", "flow-dot");
        el.style.fill = flow.color;
        el.style.opacity = "0";
        overlay.appendChild(el);
        flow.dots.push(el);
      }
      flows.push(flow);
    });

    return { svg: svg, cycle: cycle, flows: flows, running: false, t0: 0, elapsed: 0, raf: 0 };
  }

  function renderFrame(anim, tSec) {
    var t = tSec % anim.cycle;
    anim.flows.forEach(function (flow) {
      flow.dots.forEach(function (dot, i) {
        var dep = flow.start + i * flow.gap;
        var prog = (t - dep) / flow.travel;
        if (prog >= 0 && prog <= 1) {
          var pt;
          try { pt = flow.path.getPointAtLength(prog * flow.len); } catch (e) { return; }
          if (dot.tagName === "rect") {
            dot.setAttribute("x", pt.x - flow.size * 1.2);
            dot.setAttribute("y", pt.y - flow.size * 0.75);
          } else {
            dot.setAttribute("cx", pt.x);
            dot.setAttribute("cy", pt.y);
          }
          // fade in/out at path ends
          var fade = Math.min(1, prog / 0.08, (1 - prog) / 0.08);
          dot.style.opacity = String(Math.max(0, fade));
        } else {
          dot.style.opacity = "0";
        }
      });
    });
  }

  function startAnim(anim) {
    if (anim.running) return;
    anim.running = true;
    anim.t0 = performance.now() - anim.elapsed * 1000;
    function tick(now) {
      if (!anim.running) return;
      anim.elapsed = (now - anim.t0) / 1000;
      renderFrame(anim, anim.elapsed);
      anim.raf = requestAnimationFrame(tick);
    }
    anim.raf = requestAnimationFrame(tick);
  }
  function stopAnim(anim) {
    anim.running = false;
    if (anim.raf) cancelAnimationFrame(anim.raf);
  }

  function injectControls(anim) {
    var diagram = anim.svg.closest(".diagram");
    if (!diagram) return;
    var bar = diagram.querySelector(".diagram-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "diagram-bar";
      diagram.appendChild(bar);
    }
    var btn = document.createElement("button");
    btn.className = "play-btn";
    function label() { btn.textContent = anim.running ? "⏸ Pause flow" : "▶ Play flow"; }
    btn.addEventListener("click", function () {
      if (anim.running) stopAnim(anim); else startAnim(anim);
      label();
    });
    bar.insertBefore(btn, bar.firstChild);
    anim._label = label;
    label();
  }

  document.addEventListener("DOMContentLoaded", function () {
    var svgs = document.querySelectorAll("svg[data-animate]");
    var anims = [];
    Array.prototype.forEach.call(svgs, function (svg) {
      var anim = setupSvg(svg);
      if (!anim) return;
      anims.push(anim);
      injectControls(anim);
      if (!reduced) { startAnim(anim); if (anim._label) anim._label(); }
      else { renderFrame(anim, anim.cycle * 0.35); } /* static mid-flow frame */
    });

    /* pause offscreen animations to save CPU */
    if ("IntersectionObserver" in window && !reduced) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          anims.forEach(function (anim) {
            if (anim.svg === en.target) {
              if (en.isIntersecting && anim._wasRunning !== false) { startAnim(anim); }
              else if (!en.isIntersecting) { anim._wasRunning = anim.running; stopAnim(anim); }
              if (anim._label) anim._label();
            }
          });
        });
      }, { threshold: 0.05 });
      anims.forEach(function (a) { io.observe(a.svg); });
    }
  });
})();

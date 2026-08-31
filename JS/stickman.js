/*
 * Stickman rig — small 2-bone IK figures that grip, brace or sit on the edge
 * of a .video-frame and react to pointer/touch input by flinching away from
 * wherever they were actually touched.
 *
 * Every pose shares the exact same body graph: head, shoulder, hip, handL,
 * handR, footL, footR, with elbows/knees always solved by IK between them.
 * A pose is defined purely as DATA — how each named point behaves — not as
 * separate drawing code:
 *
 *   fixed:  a constant point that never moves (a hand gripping an edge).
 *   rigid:  parent point + a constant offset (shoulder always rides the hip).
 *   spring: has its own physics. Either anchored to a constant rest position,
 *           or to another point ("follow") so it trails that point's motion
 *           (used for hang's feet, which lag behind the hip on a delay).
 *           A spring point can also be `reactive`, meaning it's one of the
 *           points that flinches away from a touch, and can be locked to a
 *           single `axis` ("x" or "y") so it only ever slides along that
 *           axis instead of moving freely (sit's hands, gliding sideways
 *           along the video's top edge rather than lifting off it).
 *   pivot:  rotates around another point at a constant radius instead of
 *           moving freely — so a rigid segment (a spine) can react to a
 *           touch by changing angle without ever stretching. restAngle is
 *           in degrees, 90 = straight up from the point it pivots around.
 *
 * Points can be declared in any order — resolvePose() below resolves them
 * recursively, so a pose's data can be freely rearranged without touching
 * any code. All of this lives here; CSS only positions the whole rig
 * relative to its video (.video-frame .pose-* in style.css).
 *
 * Markup contract: <svg class="stickman pose-hang|pose-push|pose-sit"></svg>
 * as a direct child of a position:relative .video-frame.
 */
(function () {
  "use strict";

  var ACCENT = "#55d6ff";
  var BOX = 200;
  var DEFAULT_HEAD_OFFSET = { x: 0, y: -16 };
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Same breakpoint style.css switches layout at. A pose can define a
  // "<name>Mobile" entry in POSES (e.g. pushMobile) and Stickman will use it
  // automatically instead of the base pose whenever this matches — for a
  // pose whose desktop geometry needs room the mobile column doesn't have.
  var MOBILE_QUERY = window.matchMedia("(max-width: 800px)");

  // ---- 2-bone IK -----------------------------------------------------

  // Given a fixed root p1 and a target p2, find the elbow/knee position so
  // that |p1-mid| = l1 and |mid-p2| = l2. bend flips which side it bows to.
  function solveIK(p1, p2, l1, l2, bend) {
    var dx = p2.x - p1.x;
    var dy = p2.y - p1.y;
    var dist = Math.hypot(dx, dy) || 0.001;
    dist = Math.min(dist, l1 + l2 - 0.01);
    dist = Math.max(dist, Math.abs(l1 - l2) + 0.01);

    var base = Math.atan2(dy, dx);
    var cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
    var a = Math.acos(Math.min(1, Math.max(-1, cosA)));
    var angle = base + (bend ? -a : a);

    return { x: p1.x + Math.cos(angle) * l1, y: p1.y + Math.sin(angle) * l1 };
  }

  function add(p, q) { return { x: p.x + q.x, y: p.y + q.y }; }

  // ---- a small critically-damped-ish spring, for a lively bounce -----

  function Spring(x, y, stiffness, damping) {
    this.x = x; this.y = y;
    this.tx = x; this.ty = y;
    this.vx = 0; this.vy = 0;
    this.stiffness = stiffness;
    this.damping = damping;
  }
  Spring.prototype.setTarget = function (x, y) { this.tx = x; this.ty = y; };
  Spring.prototype.step = function () {
    this.vx = (this.vx + (this.tx - this.x) * this.stiffness) * this.damping;
    this.vy = (this.vy + (this.ty - this.y) * this.stiffness) * this.damping;
    this.x += this.vx;
    this.y += this.vy;
  };

  // Same idea as Spring, but for a single scalar (an angle in degrees) —
  // used by "pivot" points, which rotate around another point rather than
  // moving freely in x/y.
  function ScalarSpring(v, stiffness, damping) {
    this.v = v; this.tv = v; this.vel = 0;
    this.stiffness = stiffness; this.damping = damping;
  }
  ScalarSpring.prototype.setTarget = function (v) { this.tv = v; };
  ScalarSpring.prototype.step = function () {
    this.vel = (this.vel + (this.tv - this.v) * this.stiffness) * this.damping;
    this.v += this.vel;
  };

  // ---- pose data -------------------------------------------------------
  // All points live in the same 200x200 local space every pose is drawn in.

  var POSES = {
    // dead-hang from a bottom edge: hands fixed on the grip line, hip is the
    // reactive point, feet trail the hip on a delay for a whip-like follow.
    hang: {
      size: 78,
      armLens: [46, 50],
      legLens: [50, 54],
      bends: { armL: true, armR: false, legL: false, legR: true },
      pressStrength: 24,
      idle: { amp: 3, freq: 0.55 },
      points: {
        handL: { fixed: { x: 60, y: 4 } },
        handR: { fixed: { x: 140, y: 4 } },
        hip: { spring: { rest: { x: 100, y: 134 }, stiffness: 0.24, damping: 0.7 }, reactive: true },
        shoulder: { rigid: { of: "hip", offset: { x: 0, y: -50 } } },
        footL: { spring: { follow: "hip", offset: { x: -24, y: 100 }, stiffness: 0.2, damping: 0.9 } },
        footR: { spring: { follow: "hip", offset: { x: 24, y: 100 }, stiffness: 0.2, damping: 0.9 } },
      },
    },
    // leaning into a right-hand edge: hands and feet both fixed (braced),
    // hip is the only reactive point — it presses harder wherever it's poked.
    push: {
      size: 54,
      armLens: [44, 48],
      legLens: [56, 60],
      bends: { armL: true, armR: true, legL: false, legR: false },
      pressStrength: 26,
      idle: { amp: 2, freq: 0.7 },
      headOffset: { x: -25, y: -8 },
      points: {
        handL: { fixed: { x: 4, y: 50 } },
        handR: { fixed: { x: 4, y: 80 } },
        footL: { fixed: { x: 150, y: 200 } },
        footR: { fixed: { x: 210, y: 200 } },
        hip: { spring: { rest: { x: 130, y: 120 }, stiffness: 0.28, damping: 0.66 }, reactive: true },
        shoulder: { rigid: { of: "hip", offset: { x: -48, y: -40 } } },
      },
    },
    // push's mobile stand-in: same right-edge lean as "push", just built
    // narrow — the desktop version's stance is wide enough that it overflows
    // the ~24px gutter a full-width mobile video leaves past its edge.
    // Critically, this also uses its own narrow viewW/viewH + matching
    // width/height instead of a plain square box: giving push's existing
    // square viewBox a narrow CSS width wouldn't actually make the rendered
    // figure narrower (see the note on applyPoseVariant) - the SVG element
    // would still claim a full square footprint in the page's layout
    // regardless of how "thin" the content inside it looks, which is what
    // was overflowing in the first place. Picked up automatically by
    // Stickman instead of "push" whenever the layout is mobile-width; see
    // MOBILE_QUERY.
    pushMobile: {
      viewW: 100,
      viewH: 200,
      width: 22,
      height: 44,
      // this pose's scale factor (width/viewW = 22/100 = .22) is much
      // smaller than hang's or push's (.39 / .27, both square boxes), so it
      // needs a noticeably larger raw jointRadius/boneWidth just to read as
      // the same line weight on screen - see applyStrokeWeight.
      jointRadius: 7,
      boneWidth: 5,
      armLens: [50, 50],
      legLensL: [56, 60],
      legLensR: [56, 60],
      bends: { armL: false, armR: false, legL: true, legR: true },
      pressStrength: 25,
      idle: { amp: 2, freq: 0.6 },
      headOffset: { x: 25, y: -5 },
      points: {
        handL: { spring: { rest: { x: 100, y: 50 }, stiffness: 0.7, damping: 0.1 , axis: "y"}, reactive: true },
        handR: { spring: { rest: { x: 100, y: 25 }, stiffness: 0.7, damping: 0.3 , axis: "y"}, reactive: true },
        footL: { fixed: { x: 100, y: 200 } },
        footR: { fixed: { x: 100, y: 165 } },
        hip: { spring: { rest: { x: 4, y: 140 }, stiffness: 0.28, damping: 0.66 , axis: "y"}, reactive: true },
        shoulder: { rigid: { of: "hip", offset: { x: 10, y: -110 } } },
      },
    },
    // perched on a top edge: hip glued to the seat, arms rest rigidly on the
    // lap, and the two feet are the reactive points — they kick away from a touch.
    sit: {
      size: 66,
      // handL sits much further from the shoulder than handR across the
      // whole rotation range, so each arm gets its own reach instead of
      // sharing one and looking either taut or floppy.
      armLensL: [30, 28],
      armLensR: [35, 34],
      legLens: [54, 58],
      bends: { armL: true, armR: true, legL: false, legR: false },
      pressStrength: 30,
      idle: { amp: 3, freq: 0.5 },
      headOffset: { x: -6, y: -20 },
      points: {
        hip: { fixed: { x: 100, y: 8 } },
        // The torso pivots around the hip instead of springing in x/y, so
        // the spine (hip-to-shoulder) never stretches mid-reaction — it can
        // only ever swing. 90 = sitting bolt upright; 70 is a relaxed lean.
        // pressStrength is in degrees: a touch landing squarely "above" him
        // (maximum tangential push) swings him a full 30° toward lying down.
        shoulder: { pivot: { of: "hip", radius: 52, restAngle: 58, stiffness: 0.3, damping: 0.6, pressStrength: 30 }, reactive: true },
        // Hands rest near the video's top edge and only ever slide sideways
        // along it (axis: "x") — like they're planted flat and gliding on
        // the surface, rather than lifting as the torso rocks back.
        handL: { spring: { rest: { x: 120, y: 0 }, stiffness: 0.25, damping: 0.7, axis: "x" }, reactive: true },
        handR: { spring: { rest: { x: 135, y: 0 }, stiffness: 0.4, damping: 0.4, axis: "x" }, reactive: true },
        footL: { spring: { rest: { x: 40, y: 4 }, stiffness: 0.3, damping: 0.6 , axis: "x"}, reactive: true },
        footR: { spring: { rest: { x: 80, y: 100 }, stiffness: 0.3, damping: 0.2 }, reactive: true },
      },
    },
  };

  // ---- resolving a pose's point graph into live coordinates -----------

  // Walks pose.points, resolving each named point to {x,y}. Declaration
  // order doesn't matter — a "rigid", "follow", or "pivot" point pulls in
  // whatever it depends on recursively, memoized so nothing is resolved
  // twice. `springs` holds x/y Spring state, `pivotSprings` holds the
  // angle-only ScalarSpring state for "pivot" points — separate maps
  // because the two point kinds carry different physics state.
  function resolvePose(pose, springs, pivotSprings, opts) {
    var resolved = {};

    function resolve(name) {
      if (resolved[name]) return resolved[name];
      var def = pose.points[name];
      var val;

      if (def.fixed) {
        val = def.fixed;

      } else if (def.rigid) {
        val = add(resolve(def.rigid.of), def.rigid.offset);

      } else if (def.pivot) {
        // Stays exactly `radius` from `of` at all times — rotating around
        // it instead of moving freely — so e.g. a spine never stretches
        // mid-animation the way an x/y spring on the shoulder would.
        // restAngle is in degrees, measured so 90 = straight up from `of`.
        var pv = def.pivot;
        var origin = resolve(pv.of);
        var restRad = pv.restAngle * Math.PI / 180;
        var restPos = {
          x: origin.x + pv.radius * Math.cos(restRad),
          y: origin.y - pv.radius * Math.sin(restRad),
        };

        var angleTarget = pv.restAngle;
        if (def.reactive) {
          // idle wobble, reusing the same sway signal as x/y points but
          // converted from "pixels of sway" to "degrees of sway"
          angleTarget += (opts.sway.x / pv.radius) * (180 / Math.PI);

          if (opts.pressed && opts.pressPoint) {
            var pdx = restPos.x - opts.pressPoint.x;
            var pdy = restPos.y - opts.pressPoint.y;
            var plen = Math.hypot(pdx, pdy) || 1;
            // tangent direction of the circle at restRad — how "away from
            // the click" translates into "which way does the angle turn"
            var tanx = -Math.sin(restRad), tany = -Math.cos(restRad);
            var proj = (pdx / plen) * tanx + (pdy / plen) * tany;
            angleTarget += proj * pv.pressStrength;
          }
        }

        var ps = pivotSprings[name];
        if (!ps) ps = pivotSprings[name] = new ScalarSpring(pv.restAngle, pv.stiffness, pv.damping);
        ps.setTarget(angleTarget);
        ps.step();

        var rad = ps.v * Math.PI / 180;
        val = { x: origin.x + pv.radius * Math.cos(rad), y: origin.y - pv.radius * Math.sin(rad) };

      } else {
        var restTarget = def.spring.rest || add(resolve(def.spring.follow), def.spring.offset);
        var tx = restTarget.x, ty = restTarget.y;
        var axis = def.spring.axis; // undefined (both axes), "x", or "y"
        var canX = axis !== "y", canY = axis !== "x";

        if (def.reactive) {
          if (canX) tx += opts.sway.x;
          if (canY) ty += opts.sway.y;
          if (opts.pressed && opts.pressPoint) {
            var dx = restTarget.x - opts.pressPoint.x;
            var dy = restTarget.y - opts.pressPoint.y;
            var len = Math.hypot(dx, dy) || 1;
            if (canX) tx += (dx / len) * pose.pressStrength;
            if (canY) ty += (dy / len) * pose.pressStrength;
          }
        }

        var s = springs[name];
        if (!s) s = springs[name] = new Spring(tx, ty, def.spring.stiffness, def.spring.damping);
        s.setTarget(tx, ty);
        s.step();
        val = { x: s.x, y: s.y };
      }

      resolved[name] = val;
      return val;
    }

    Object.keys(pose.points).forEach(resolve);
    return resolved;
  }

  // ---- SVG helpers -------------------------------------------------------

  var SVG_NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    for (var key in attrs) node.setAttribute(key, attrs[key]);
    return node;
  }

  function buildRig(svg) {
    // viewBox/width/height are pose-dependent (see applyPoseVariant) and get
    // set there instead, since they need updating again on every pose swap;
    // this only builds the DOM structure, which is identical for every pose.
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    // Owns 100% of hit-testing for the figure. Kept static (never moved,
    // never hidden) and given an explicit "all" so it isn't at the mercy of
    // whether a transparent fill counts as "painted" in a given engine.
    // The bones/joints below are pointer-events:none — if they owned hit
    // testing instead, a limb sliding out from under a stationary cursor
    // mid-animation fires pointerleave and cancels the very press that
    // moved it.
    // Sized to 0,0,BOX,BOX here as a placeholder — a figure like sit's has
    // real content (head, arms) above y=0, outside the nominal viewBox, so
    // Stickman sizes this properly to the pose's actual bounds once its
    // rest points are known (see sizeHitArea).
    var hit = el("rect", { x: 0, y: 0, width: BOX, height: BOX, fill: "transparent", "pointer-events": "all" });
    svg.appendChild(hit);

    var bones = {};
    var joints = {};
    var boneNames = ["armL_upper", "armL_lower", "armR_upper", "armR_lower",
      "legL_upper", "legL_lower", "legR_upper", "legR_lower", "spine"];
    var jointNames = ["hip", "shoulder", "head", "elbowL", "elbowR",
      "kneeL", "kneeR", "handL", "handR", "footL", "footR"];

    // r / stroke-width aren't set here — they're pose data (jointRadius,
    // boneWidth), applied by applyStrokeWeight whenever a pose is set or
    // swapped, since a pose's own scale factor (its CSS size ÷ its viewBox
    // size) isn't necessarily the same as any other pose's. A joint drawn
    // at, say, r=5 viewBox-units renders at very different actual pixel
    // sizes depending on that ratio - pushMobile's narrow box has a much
    // smaller one than hang's or push's square boxes, so the same raw
    // radius would look distinctly smaller there unless corrected for.
    boneNames.forEach(function (name) {
      bones[name] = el("line", {
        stroke: ACCENT, "stroke-linecap": "round", opacity: 0.85,
        "pointer-events": "none",
      });
      svg.appendChild(bones[name]);
    });

    jointNames.forEach(function (name) {
      joints[name] = el("circle", {
        fill: "none", stroke: ACCENT,
        filter: "url(#stickman-glow)", "pointer-events": "none",
      });
      svg.appendChild(joints[name]);
    });

    return { bones: bones, joints: joints, hit: hit };
  }

  function ensureGlowFilter() {
    if (document.getElementById("stickman-glow-defs")) return;
    var svg = el("svg", { id: "stickman-glow-defs", width: 0, height: 0, style: "position:absolute" });
    var filter = el("filter", { id: "stickman-glow", x: "-100%", y: "-100%", width: "300%", height: "300%" });
    var blur = el("feGaussianBlur", { stdDeviation: 1.6, result: "blur" });
    var merge = el("feMerge");
    merge.appendChild(el("feMergeNode", { in: "blur" }));
    merge.appendChild(el("feMergeNode", { in: "SourceGraphic" }));
    filter.appendChild(blur);
    filter.appendChild(merge);
    svg.appendChild(filter);
    document.body.appendChild(svg);
  }

  function setLine(line, a, b) {
    line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
    line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
  }
  function setDot(circle, p) {
    circle.setAttribute("cx", p.x); circle.setAttribute("cy", p.y);
  }

  // Converts a pointer event's screen position into this SVG's own 0..200
  // local coordinate space, so "away from the click" means the same thing
  // regardless of how big the figure is rendered on screen.
  function localPointFromEvent(svg, e) {
    var ctm = svg.getScreenCTM();
    if (!ctm) return null;
    var pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    var local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }

  // ---- Stickman instance ---------------------------------------------

  // Resolves which POSES entry a base name (from the "pose-X" class) should
  // currently use — the base pose, or its "<X>Mobile" variant if one exists
  // and the layout is currently mobile-width.
  function pickPoseVariant(baseName) {
    var mobileKey = baseName + "Mobile";
    if (MOBILE_QUERY.matches && POSES[mobileKey]) {
      return { key: mobileKey, pose: POSES[mobileKey], mobile: true };
    }
    return { key: baseName, pose: POSES[baseName], mobile: false };
  }

  function Stickman(svg) {
    this.svg = svg;
    this.baseName = svg.classList.contains("pose-push") ? "push"
      : svg.classList.contains("pose-sit") ? "sit" : "hang";
    this.rig = buildRig(svg);
    this.pressed = false;
    this.pressPoint = null;
    this.t = Math.random() * 10; // desync idle sway between instances

    this.applyPoseVariant(pickPoseVariant(this.baseName));

    this.bindInput();
    this.tick(0);
    this.sizeHitArea();
    this.render(); // paint the rest pose immediately, before any RAF ticks
  }

  // Switches this figure to a resolved {key, pose, mobile} variant: swaps
  // which pose data drives it, the CSS class its .video-frame anchor rule
  // targets (.pose-X vs .pose-X-mobile), and its viewBox/rendered size.
  // Resets physics state, since a different variant is an entirely
  // different point graph — carrying old spring positions over would
  // snap-teleport on swap.
  //
  // viewBox defaults to a square BOX x BOX (what hang/push/sit use) but a
  // pose can set its own viewW/viewH — needed for a pose like pushMobile,
  // whose figure is much narrower than it is tall: giving it a plain square
  // viewBox stretched into a narrow CSS box wouldn't make the *rendered*
  // figure narrower, it would just leave transparent margin down both
  // sides while the SVG element itself still claimed the full square
  // footprint in the page's layout — which is exactly what was overflowing
  // the mobile gutter. width/height (CSS pixels) default to size x size
  // for the same reason; pushMobile sets them explicitly, narrow.
  Stickman.prototype.applyPoseVariant = function (variant) {
    this.poseKey = variant.key;
    this.pose = variant.pose;
    this.springs = {};
    this.pivotSprings = {};

    this.svg.classList.remove("pose-" + this.baseName, "pose-" + this.baseName + "-mobile");
    this.svg.classList.add(variant.mobile ? ("pose-" + this.baseName + "-mobile") : ("pose-" + this.baseName));

    var p = this.pose;
    this.svg.setAttribute("viewBox", "0 0 " + (p.viewW || BOX) + " " + (p.viewH || BOX));
    this.svg.style.width = (p.width || p.size) + "px";
    this.svg.style.height = (p.height || p.size) + "px";

    this.applyStrokeWeight();
  };

  // Sets joint radius and bone/joint-outline thickness from this pose's own
  // jointRadius/boneWidth (defaulting to the figure's original 5 / 3, with
  // the head joint staying 1.8x a regular one, same ratio as before this
  // was configurable). Independent of viewW/viewH/width/height on purpose —
  // those control the figure's overall footprint, this only controls how
  // heavy its linework reads, since the two don't scale together: a pose
  // with a small scale factor (its CSS size divided by its viewBox size,
  // e.g. pushMobile's narrow box) needs a *larger* raw jointRadius/boneWidth
  // than a pose with a bigger one just to end up looking the same weight on
  // screen, not a smaller one.
  Stickman.prototype.applyStrokeWeight = function () {
    var p = this.pose;
    var boneWidth = p.boneWidth || 3;
    var jointRadius = p.jointRadius || 5;
    var rig = this.rig;

    Object.keys(rig.bones).forEach(function (name) {
      rig.bones[name].setAttribute("stroke-width", boneWidth);
    });

    Object.keys(rig.joints).forEach(function (name) {
      var joint = rig.joints[name];
      joint.setAttribute("r", name === "head" ? jointRadius * 1.8 : jointRadius);
      joint.setAttribute("stroke-width", boneWidth);
    });
  };

  // Called whenever MOBILE_QUERY's match state flips, so a figure whose
  // pose has a mobile variant swaps to (or back from) it live — e.g. on
  // rotation or a resized window — without needing a page reload.
  Stickman.prototype.refreshPoseForViewport = function () {
    var variant = pickPoseVariant(this.baseName);
    if (variant.key === this.poseKey) return;
    this.applyPoseVariant(variant);
    this.tick(0);
    this.sizeHitArea();
    this.render();
  };

  // The hit-rect must cover wherever the figure's points can actually be —
  // which, for a pose like sit, includes real content above y=0 (head,
  // shoulder, arms) that sits outside the nominal 0,0,BOX,BOX viewBox and
  // would otherwise go untouchable. Computed once from this pose's resolved
  // rest points rather than hand-tuned per pose, so it stays correct if the
  // points in POSES get rearranged later. Padded for: how far a reactive
  // point can travel toward a click (pressStrength), how far an elbow/knee
  // can bow off the straight line between its anchors, and joint radius.
  Stickman.prototype.sizeHitArea = function () {
    var pts = this.points;
    var names = Object.keys(pts);
    var pad = this.pose.pressStrength + (this.pose.jointRadius || 5) + 19;

    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    names.forEach(function (name) {
      var p = pts[name];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });

    this.rig.hit.setAttribute("x", minX - pad);
    this.rig.hit.setAttribute("y", minY - pad);
    this.rig.hit.setAttribute("width", (maxX - minX) + pad * 2);
    this.rig.hit.setAttribute("height", (maxY - minY) + pad * 2);
  };

  Stickman.prototype.bindInput = function () {
    var self = this;
    var press = function (e) {
      self.pressed = true;
      self.pressPoint = localPointFromEvent(self.svg, e) || { x: BOX / 2, y: BOX / 2 };
      if (reduceMotion) { self.tick(0); self.render(); }
      e.preventDefault();
    };
    var release = function () {
      self.pressed = false;
    };
    this.svg.style.cursor = "pointer";
    this.svg.style.pointerEvents = "auto";
    this.svg.addEventListener("pointerdown", press);
    this.svg.addEventListener("pointerup", release);
    this.svg.addEventListener("pointercancel", release);
    this.svg.addEventListener("pointerleave", release);
  };

  Stickman.prototype.tick = function (dt) {
    this.t += dt;
    var p = this.pose;
    var idleAmp = reduceMotion ? 0 : p.idle.amp;
    var sway = {
      x: Math.sin(this.t * p.idle.freq) * idleAmp,
      y: Math.cos(this.t * p.idle.freq * 1.3) * idleAmp * 0.4,
    };

    this.points = resolvePose(p, this.springs, this.pivotSprings, {
      pressed: this.pressed,
      pressPoint: this.pressPoint,
      sway: sway,
    });
  };

  Stickman.prototype.render = function () {
    var p = this.pose, rig = this.rig, b = rig.bones, j = rig.joints, pts = this.points;

    var armLensL = p.armLensL || p.armLens, armLensR = p.armLensR || p.armLens;
    var legLensL = p.legLensL || p.legLens, legLensR = p.legLensR || p.legLens;
    var elbowL = solveIK(pts.shoulder, pts.handL, armLensL[0], armLensL[1], p.bends.armL);
    var elbowR = solveIK(pts.shoulder, pts.handR, armLensR[0], armLensR[1], p.bends.armR);
    var kneeL = solveIK(pts.hip, pts.footL, legLensL[0], legLensL[1], p.bends.legL);
    var kneeR = solveIK(pts.hip, pts.footR, legLensR[0], legLensR[1], p.bends.legR);
    var head = add(pts.shoulder, p.headOffset || DEFAULT_HEAD_OFFSET);

    setLine(b.spine, pts.shoulder, pts.hip);
    setLine(b.armL_upper, pts.shoulder, elbowL); setLine(b.armL_lower, elbowL, pts.handL);
    setLine(b.armR_upper, pts.shoulder, elbowR); setLine(b.armR_lower, elbowR, pts.handR);
    setLine(b.legL_upper, pts.hip, kneeL); setLine(b.legL_lower, kneeL, pts.footL);
    setLine(b.legR_upper, pts.hip, kneeR); setLine(b.legR_lower, kneeR, pts.footR);

    setDot(j.hip, pts.hip); setDot(j.shoulder, pts.shoulder); setDot(j.head, head);
    setDot(j.elbowL, elbowL); setDot(j.elbowR, elbowR);
    setDot(j.kneeL, kneeL); setDot(j.kneeR, kneeR);
    setDot(j.handL, pts.handL); setDot(j.handR, pts.handR);
    setDot(j.footL, pts.footL); setDot(j.footR, pts.footR);
  };

  // ---- boot --------------------------------------------------------------

  function init() {
    ensureGlowFilter();
    var nodes = document.querySelectorAll(".stickman");
    if (!nodes.length) return;

    var instances = [];
    nodes.forEach(function (svg) { instances.push(new Stickman(svg)); });

    // Swap any figure with a mobile variant the moment the layout crosses
    // the breakpoint — a resize or a phone rotation, not just page load.
    MOBILE_QUERY.addEventListener("change", function () {
      instances.forEach(function (s) { s.refreshPoseForViewport(); });
    });

    if (reduceMotion) return; // rest pose is already painted; no continuous loop

    var last = performance.now();
    function loop(now) {
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      instances.forEach(function (s) { s.tick(dt); s.render(); });
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

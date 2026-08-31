/*
 * One project video plays at a time.
 *
 * Three looping clips running at once is genuinely hard to read - the eye gets
 * dragged between three unrelated subjects and none of them land. The layout
 * already gives each project a row of its own, but how much of the page fits
 * on screen depends on viewport height, zoom and browser chrome, so spacing
 * alone can't promise anything. This does: whichever video is showing the most
 * of itself plays, every other one pauses and rewinds to its first frame.
 *
 * Videos keep their autoplay attribute so the page still behaves with JS off -
 * in that case you get the old all-at-once behaviour rather than a wall of
 * frozen first frames, which is the better of the two failure modes.
 */
(function () {
  "use strict";

  var scopes = document.querySelectorAll("[data-solo-video]");
  if (!scopes.length || !("IntersectionObserver" in window)) return;

  var videos = [];
  for (var s = 0; s < scopes.length; s++) {
    var found = scopes[s].querySelectorAll("video");
    for (var v = 0; v < found.length; v++) videos.push(found[v]);
  }
  if (videos.length < 2) return;

  // how much of each video is on screen right now, same index as `videos`
  var visibility = videos.map(function () { return 0; });
  var playing = null;

  function update() {
    var best = 0;
    var winner = null;

    for (var i = 0; i < videos.length; i++) {
      if (visibility[i] > best) {
        best = visibility[i];
        winner = videos[i];
      }
    }

    // nothing on screen -> winner stays null and everything below pauses
    if (winner === playing) return;
    playing = winner;

    for (var j = 0; j < videos.length; j++) {
      var video = videos[j];

      if (video === winner) {
        // play() rejects if the browser declines (low power mode, a tab that
        // was never interacted with). Nothing to do about it, so don't let it
        // surface as an unhandled rejection.
        var started = video.play();
        if (started && started.catch) started.catch(function () {});
      } else if (!video.paused) {
        video.pause();
        video.currentTime = 0;
      }
    }
  }

  var observer = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      var index = videos.indexOf(entries[i].target);
      if (index > -1) visibility[index] = entries[i].intersectionRatio;
    }
    update();
  }, {
    // a plain 0/1 threshold would only fire at the edges; the steps in between
    // are what let "most visible" actually mean something mid-scroll
    threshold: [0, 0.15, 0.35, 0.55, 0.75, 0.95]
  });

  for (var k = 0; k < videos.length; k++) {
    videos[k].pause(); // undo the autoplay attribute - the observer decides now
    observer.observe(videos[k]);
  }
})();

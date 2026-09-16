/*
 * Sound toggle for the hero showreel.
 *
 * Autoplay only survives if the video starts muted, so it does - but a reel
 * with a track on it deserves a way to hear the track. The button is the only
 * thing that unmutes; nothing on this page ever makes noise on its own.
 *
 * video-focus.js pauses whichever videos aren't on screen, so unmuting can't
 * leave audio playing from a video you've scrolled past.
 */
(function () {
  "use strict";

  var buttons = document.querySelectorAll("[data-reel-sound]");

  for (var i = 0; i < buttons.length; i++) {
    (function (button) {
      var frame = button.closest(".reel-media") || button.parentNode;
      var video = frame.querySelector("video");
      if (!video) {
        button.hidden = true;
        return;
      }

      button.addEventListener("click", function () {
        video.muted = !video.muted;
        button.setAttribute("aria-pressed", video.muted ? "false" : "true");
        button.lastChild.textContent = video.muted ? " sound off" : " sound on";

        // unmuting a video the browser autoplayed can require an explicit
        // play() on some engines - it's a user gesture here, so it's allowed
        if (!video.muted && video.paused) {
          var attempt = video.play();
          if (attempt && attempt.catch) attempt.catch(function () {});
        }
      });
    })(buttons[i]);
  }
})();

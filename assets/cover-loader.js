// Hoopty cover art loader (replacement for the old 5-part loader).
//
// OLD PROBLEM: the hero JPEG was split into 5 base64 chunks inside SVG files
// under cover-parts/, and the old loader fetched all 5, joined them, then
// polled every 300ms for up to 12 seconds hoping the React <img> existed.
// If ANY one of the 5 fetches failed, the image never appeared at all — no
// retry, no fallback, no error shown. That is why the hero sometimes failed
// on first load.
//
// NEW: the same JPEG (1400x1400, decoded from those 5 parts, byte-identical
// image) now lives as ONE file: ./assets/hoopty-cover.jpg. This loader
// preloads that one file, swaps it in when it is ready, retries twice on
// failure, and if it still fails leaves a styled HOOPTY banner in place
// instead of a broken image.
//
// INSTALL: replace assets/cover-loader.js with this file, add
// assets/hoopty-cover.jpg, and DELETE cover-parts/ (part-0..4.svg).
// index.html needs no change — it already loads ./assets/cover-loader.js.
(function () {
  var SRC = './assets/hoopty-cover.jpg';
  var MAX_RETRIES = 2;

  function findImg() {
    return document.querySelector('img[src*="hoopty-cover-art"]');
  }

  function showFallback(img) {
    // Keep the layout intact: dark banner with the wordmark, no broken icon.
    if (!img) return;
    img.style.display = 'none';
    if (img.parentElement && !img.parentElement.querySelector('.hoopty-cover-fallback')) {
      var banner = document.createElement('div');
      banner.className = 'hoopty-cover-fallback';
      banner.textContent = 'HOOPTY';
      banner.setAttribute(
        'style',
        'display:flex;align-items:center;justify-content:center;min-height:220px;' +
          'background:#111;color:#fff;font-weight:900;font-size:42px;letter-spacing:.12em;'
      );
      img.parentElement.appendChild(banner);
    }
  }

  function tryLoad(img, attempt) {
    var pre = new Image();
    pre.onload = function () {
      img.src = SRC;
      img.removeAttribute('srcset');
    };
    pre.onerror = function () {
      if (attempt < MAX_RETRIES) {
        setTimeout(function () {
          tryLoad(img, attempt + 1);
        }, 800);
      } else {
        showFallback(img);
      }
    };
    pre.src = SRC;
  }

  function attach() {
    var img = findImg();
    if (!img) return false;
    if (img.dataset.hooptyCoverFixed) return true;
    img.dataset.hooptyCoverFixed = '1';
    // Preload early so the swap happens before first paint when possible.
    var link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = SRC;
    document.head.appendChild(link);
    tryLoad(img, 0);
    return true;
  }

  if (!attach()) {
    // The React app renders the <img> after this script runs; watch for it
    // briefly, then stop watching (no endless polling like the old loader).
    var observer = new MutationObserver(function () {
      if (attach()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () {
      observer.disconnect();
    }, 15000);
  }
})();

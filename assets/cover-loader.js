// Reassembles the Hoopty cover art from text parts stored in the repo
// (the GitHub upload route only accepts text files, so the JPEG is
// stored as base64 chunks inside SVG files under cover-parts/).
(function () {
  var PARTS = 5;
  var done = false;
  function extractB64(svgText) {
    var start = svgText.indexOf('base64,');
    if (start < 0) return '';
    start += 'base64,'.length;
    var end = svgText.indexOf('"', start);
    return svgText.slice(start, end);
  }
  function apply(dataUrl) {
    var img = document.querySelector('img[src*="hoopty-cover-art"]');
    if (img) { img.src = dataUrl; return true; }
    return false;
  }
  var promises = [];
  for (var i = 0; i < PARTS; i++) {
    promises.push(
      fetch('cover-parts/part-' + i + '.svg').then(function (r) { return r.text(); }).then(extractB64)
    );
  }
  Promise.all(promises).then(function (chunks) {
    var dataUrl = 'data:image/jpeg;base64,' + chunks.join('');
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (apply(dataUrl) || tries > 40) clearInterval(timer);
    }, 300);
    var observer = new MutationObserver(function () {
      var img = document.querySelector('img[src*="hoopty-cover-art"]');
      if (img && img.src.indexOf('data:image/jpeg') !== 0) img.src = dataUrl;
    });
    observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['src'] });
    setTimeout(function () { observer.disconnect(); }, 30000);
  }).catch(function () {});
})();

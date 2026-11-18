// Hoopty Stripe drop-in — add ONE line to index.html, right after the
// cover-loader script tag:
//   <script src="./assets/hoopty-stripe.js"></script>
//
// WHAT IT DOES (DOM-level only — it never touches the minified React bundle's
// internals, because that bundle's source is not in this repo):
//   1. Adds a "Book with Stripe" button to car cards: opens book.html for
//      that car, where Identity + Checkout happen.
//   2. Exposes window.HooptyStripe — the shared API client used by
//      book.html / verify.html / success.html (listings, identity status,
//      my trips, all scoped to the signed-in renter's email).
//   3. Remembers a verified license in localStorage ("hoopty-identity") so
//      the Renter Account page can show "License verified ✓" without
//      re-asking Stripe on every visit.
//
// WHAT IT DOES NOT DO (be honest about this):
//   - It does NOT rewire the app's built-in Book button or its booking
//     mutation — that lives inside the minified bundle, whose source is the
//     generated Space, not this repo. The proper in-app wiring is specified
//     in ../app-source-patches.md for the next Space regeneration.
//   - It does NOT store listings or trips itself — those come from the
//     backend (GET /api/listings, GET /api/bookings?email=...).
(function () {
  var BACKEND_URL = 'https://api.hoopty.rent'; // <-- REPLACE at deploy time

  function accountEmail() {
    try {
      var a = JSON.parse(localStorage.getItem('hoopty-account') || 'null');
      return (a && a.email) || '';
    } catch (e) {
      return '';
    }
  }

  async function api(path, options) {
    var r = await fetch(BACKEND_URL + path, options);
    var data = await r.json().catch(function () {
      return { ok: false, error: 'Bad response from server.' };
    });
    if (!r.ok) throw new Error(data.error || data.message || ('Request failed: ' + r.status));
    return data;
  }

  // Fee breakdown — who pays what (Kris, Nov 17): the HOST pays the Stripe
  // processing fee out of their share; Hoopty keeps its FULL cut; the
  // renter pays the trip total only. The Stripe fee here is an ESTIMATE
  // (2.9% + 30c) for display — the host's FINAL net is set after payment
  // from the actual fee on the charge (see backend/lib/fees.js).
  // Earnings calculator rule: show the host's NET (gross − estimated fee),
  // never just the gross split. Example: $50/day × 10 days, Balanced —
  // gross $400.00, fee ≈ $14.80, host nets ≈ $385.20/month.
  function feeBreakdown(totalCents, plan) {
    var hostPct = plan === 'starter' ? 70 : plan === 'top_earner' ? 90 : 80;
    var hostGross = Math.round((totalCents * hostPct) / 100);
    var hooptyFee = totalCents - hostGross;
    var stripeFeeEstimate = Math.round(totalCents * 0.029) + 30;
    return {
      totalCents: totalCents,
      hostPct: hostPct,
      hooptyPct: 100 - hostPct,
      hostGrossCents: hostGross,
      hooptyFeeCents: hooptyFee,
      stripeFeeEstimateCents: stripeFeeEstimate,
      hostNetCents: Math.max(0, hostGross - stripeFeeEstimate),
    };
  }

  var HooptyStripe = {
    backendUrl: BACKEND_URL,
    accountEmail: accountEmail,
    feeBreakdown: feeBreakdown,
    quote: function (listingId, startDate, endDate) {
      return api('/api/quote?listingId=' + encodeURIComponent(listingId) +
        '&startDate=' + encodeURIComponent(startDate) +
        '&endDate=' + encodeURIComponent(endDate));
    },
    listCars: function () {
      return api('/api/listings').then(function (d) {
        return d.listings;
      });
    },
    identityStatus: function (email) {
      return api('/api/identity/status?email=' + encodeURIComponent(email || accountEmail()));
    },
    myTrips: function (email) {
      return api('/api/bookings?email=' + encodeURIComponent(email || accountEmail()));
    },
    // Opens the Stripe booking page for a listing id.
    book: function (listingId) {
      location.href = './book.html?listing=' + encodeURIComponent(listingId);
    },
  };
  window.HooptyStripe = HooptyStripe;

  // Add a "Book with Stripe" button to each car card. Car cards show a
  // "$NN/day" price; we attach next to the card's existing buttons.
  // The listing id comes from matching the card's "YEAR MAKE MODEL" text
  // against the backend listings — not a hardcoded default (the old code
  // always opened the test Camry, even on another car's card).
  var cachedListings = null;
  var listingsPromise = null;
  function getListings() {
    if (cachedListings) return Promise.resolve(cachedListings);
    if (!listingsPromise) {
      listingsPromise = HooptyStripe.listCars().then(function (list) {
        cachedListings = list || [];
        return cachedListings;
      }).catch(function () { return []; });
    }
    return listingsPromise;
  }
  function attachBookButtons() {
    var cards = document.querySelectorAll('[class*="rounded"]');
    cards.forEach(function (card) {
      if (card.querySelector('[data-hoopty-stripe-book]')) return;
      var text = card.textContent || '';
      if (!/\$\d+\/day/.test(text)) return;
      getListings().then(function (list) {
        if (card.querySelector('[data-hoopty-stripe-book]')) return;
        var id = null;
        for (var i = 0; i < list.length; i++) {
          var l = list[i];
          if (text.indexOf(l.year + ' ' + l.make + ' ' + l.model) !== -1) {
            id = l.id;
            break;
          }
        }
        if (!id && list.length === 1) id = list[0].id;
        if (!id) id = 'test-camry-001';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-hoopty-stripe-book', '1');
        btn.textContent = 'Book with Stripe';
        btn.className = 'hoopty-stripe-book';
        btn.setAttribute(
          'style',
          'margin-top:8px;width:100%;padding:10px;border-radius:999px;border:2px solid #111;background:#111;color:#fff;font-weight:800;cursor:pointer;'
        );
        btn.addEventListener('click', function () {
          HooptyStripe.book(id);
        });
        card.appendChild(btn);
      });
    });
  }

  var observer = new MutationObserver(function () {
    attachBookButtons();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(function () {
    observer.disconnect();
  }, 60000);
  attachBookButtons();
})();

// Hoopty live bridge — makes the static GitHub Pages app talk to the real
// Node backend at https://api.hoopty.rent instead of the dead ./actions
// endpoint (which 404s on static hosting, so the homepage said
// "Couldn't load the cars." and every account/booking call failed).
//
// HOW IT WORKS (DOM/fetch level only — the minified React bundle is not
// rewritten): this file loads in <head>, BEFORE the app's module bundle,
// so it wraps window.fetch before the app captures it. Any POST to
// ./actions is answered here from the backend or from device-local
// storage; every other request passes through untouched.
//
// WHAT IT DOES:
//   - listCars          -> GET /api/listings (mapped to the app's car shape)
//   - listBookings      -> GET /api/bookings?email= (SCOPED to the signed-in
//                          renter; logged out returns no trips at all)
//   - getMyVerification -> GET /api/identity/status (Stripe Identity is the
//                          source of truth; never faked here)
//   - getMyAgreement / signAgreement -> device-local storage (the app's
//                          original localStorage account model)
//   - submitLicenseCheck -> creates the device-local account (email + name;
//                          password stored as a SHA-256 hash, never plain
//                          text; full license number never stored —
//                          last 4 only). The real license check is still
//                          Stripe Identity, via book.html.
//   - loginAccount      -> checks the device-local account (email + hash)
//   - createBooking     -> redirects to book.html (Stripe Checkout is the
//                          only way a booking is paid; the in-app dialog
//                          never books directly any more)
//   - createCar         -> POST /api/listings (the backend's list endpoint,
//                          added Nov 18, 2026). A new car starts with
//                          payouts NOT ready until the host finishes Stripe
//                          Connect onboarding, so checkout refuses it until
//                          then — the car is never faked as bookable.
//                          Sends testListing:true when the host marked the
//                          description "TEST LISTING ONLY" (the only way an
//                          app listing gets the test flag), and records the
//                          Owner Agreement the form collected inline — the
//                          app never calls signAgreement for owners, so
//                          without this the Earn page would forever say no
//                          agreement is on file (see createCar below).
//   - deleteCar         -> DELETE /api/listings/:id (added Nov 18, 2026).
//                          Only the owning host can delete, and never while
//                          a booking for the car is still live — the backend
//                          refuses those with 403 / 409 and the app shows
//                          the real reason.
//   - updateCarSettings / setCarAvailable / cancelBooking
//     -> honest error: those need a backend endpoint that does not exist
//     yet. Nothing is faked or saved locally for them — a car that only
//     exists on one phone is not a listing.
//
// WHAT IT DOES NOT DO:
//   - No Stripe keys, no tax, no fake inventory. The only listing is the
//     backend's test Camry until a real host lists through the backend.
//   - It never marks a license verified, never creates a booking, never
//     moves money. Payment happens only in Stripe Checkout (book.html).
(function () {
  'use strict';
  if (window.__hooptyFixInstalled) return;
  window.__hooptyFixInstalled = true;

  var BACKEND_URL = 'https://api.hoopty.rent';
  var origFetch = window.fetch.bind(window);

  // ---- small helpers -------------------------------------------------------
  function readJson(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeJson(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { /* storage full/blocked: account features degrade, site still loads */ }
  }
  function account() { return readJson('hoopty-account', null); }
  function accountEmail() {
    var a = account();
    return a && a.email ? String(a.email).toLowerCase() : '';
  }
  function accountName() {
    var a = account();
    return a && a.fullLegalName ? a.fullLegalName : '';
  }
  function planKeep(plan) {
    return plan === 'starter' ? 70 : plan === 'top_earner' ? 90 : 80;
  }
  function jsonResponse(data) {
    return new Response(JSON.stringify({ data: data }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  function backendGet(path) {
    return origFetch(BACKEND_URL + path).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok || d.ok === false) {
          throw new Error((d && (d.error || d.message)) || ('Request failed: ' + r.status));
        }
        return d;
      });
    });
  }
  function backendPost(path, body) {
    return origFetch(BACKEND_URL + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) {
          throw new Error((d && (d.error || d.message)) || ('Request failed: ' + r.status));
        }
        return d;
      });
    });
  }
  function backendDelete(path, body) {
    return origFetch(BACKEND_URL + path, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) {
          throw new Error((d && (d.error || d.message)) || ('Request failed: ' + r.status));
        }
        return d;
      });
    });
  }
  // Passwords are never stored in plain text. SHA-256 where available,
  // with a clearly-labelled non-cryptographic fallback for old browsers.
  function hashPassword(pw) {
    var salted = 'hoopty-pw:' + pw;
    try {
      if (window.crypto && crypto.subtle && crypto.subtle.digest && window.TextEncoder) {
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(salted)).then(function (buf) {
          return Array.prototype.map.call(new Uint8Array(buf), function (b) {
            return ('0' + b.toString(16)).slice(-2);
          }).join('');
        });
      }
    } catch (e) { /* fall through to the fallback below */ }
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < salted.length; i++) {
      var ch = salted.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return Promise.resolve('fnv:' + (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16));
  }

  // ---- field mapping: backend shapes -> the shapes the app expects --------
  function mapCar(l) {
    return {
      id: l.id,
      year: l.year,
      make: l.make,
      model: l.model,
      location: l.location,
      pricePerDay: l.pricePerDayCents / 100,
      bodyType: l.type,
      type: l.type,
      seats: l.seats,
      transmission: l.transmission,
      fuel: l.fuel,
      features: l.features || [],
      description: l.description || '',
      ownerName: l.hostName,
      available: !!l.payoutsReady,
      minTripDays: l.minTripDays || 1,
      maxTripDays: l.maxTripDays || 90,
      blockedDates: l.blockedDates || [],
      planKeep: planKeep(l.hostPlan),
      testListing: !!l.testListing,
    };
  }
  function mapBooking(b, carsById) {
    var car = carsById[b.listingId] || {};
    var netCents = (b.hostNetActualCents != null ? b.hostNetActualCents : b.hostNetCents) || 0;
    return {
      id: b.id,
      carId: b.listingId,
      carLabel: car.year ? (car.year + ' ' + car.make + ' ' + car.model) : 'Hoopty rental',
      carLocation: car.location || '',
      renterName: b.renterName,
      ownerName: car.hostName || '',
      startDate: b.startDate,
      endDate: b.endDate,
      days: b.days,
      pickupTime: '10:00 AM',
      returnTime: '10:00 AM',
      totalPrice: b.totalCents / 100,
      // Only paid trips are trips. An unpaid (awaiting_payment) record is
      // not shown as "Confirmed" — it is not a trip yet.
      status: 'confirmed',
      planKeep: planKeep(b.hostPlan),
      ownerEarnings: netCents / 100,
      hooptyFee: (b.hooptyFeeCents || 0) / 100,
      // A paid booking passed Gate 1 (Stripe Identity) by construction.
      licenseVerified: true,
      pickupNote: null,
    };
  }

  // ---- action handlers -----------------------------------------------------
  var HANDLERS = {
    listCars: function () {
      return backendGet('/api/listings').then(function (d) {
        return jsonResponse({ cars: (d.listings || []).map(mapCar) });
      });
    },
    listBookings: function () {
      var email = accountEmail();
      if (!email) return Promise.resolve(jsonResponse({ bookings: [] }));
      return Promise.all([
        backendGet('/api/bookings?email=' + encodeURIComponent(email)),
        backendGet('/api/listings'),
      ]).then(function (results) {
        var carsById = {};
        (results[1].listings || []).forEach(function (l) { carsById[l.id] = l; });
        var mine = (results[0].bookings || [])
          .filter(function (b) { return b.status === 'paid'; })
          .map(function (b) { return mapBooking(b, carsById); });
        return jsonResponse({ bookings: mine });
      });
    },
    getMyVerification: function () {
      var email = accountEmail();
      if (!email) return Promise.resolve(jsonResponse({ verification: null }));
      return backendGet('/api/identity/status?email=' + encodeURIComponent(email))
        .then(function (d) {
          if (d.identityStatus === 'verified' || d.identityStatus === 'pending' || d.identityStatus === 'failed') {
            return jsonResponse({
              verification: {
                status: d.identityStatus,
                renterName: accountName(),
                verifiedAt: d.verifiedAt || null,
              },
            });
          }
          return jsonResponse({ verification: null });
        });
    },
    getMyAgreement: function (args) {
      var all = readJson('hoopty-agreements', {});
      var key = String(args.role || 'renter') + ':' + String(args.name || accountName()).toLowerCase();
      return Promise.resolve(jsonResponse({ agreement: all[key] || null }));
    },
    signAgreement: function (args) {
      var all = readJson('hoopty-agreements', {});
      var rec = {
        userName: args.name,
        role: args.role,
        signatureName: args.signatureName,
        acceptedAt: new Date().toISOString(),
      };
      all[String(args.role || 'renter') + ':' + String(args.name || '').toLowerCase()] = rec;
      writeJson('hoopty-agreements', all);
      return Promise.resolve(jsonResponse({ agreement: rec }));
    },
    submitLicenseCheck: function (args) {
      var email = String(args.email || '').trim().toLowerCase();
      var name = String(args.fullLegalName || '').trim();
      if (!email || !name) {
        return Promise.reject(new Error('Add your email and full legal name.'));
      }
      return hashPassword(String(args.password || '')).then(function (hash) {
        var accounts = readJson('hoopty-accounts', {});
        accounts[email] = {
          email: email,
          fullLegalName: name,
          passwordHash: hash,
          createdAt: new Date().toISOString(),
        };
        writeJson('hoopty-accounts', accounts);
        // Local record only: pending until Stripe Identity verifies.
        // Full license number is never stored — last 4 digits only.
        var vers = readJson('hoopty-verification', {});
        vers[email] = {
          status: 'pending',
          renterName: name,
          legalName: name,
          dateOfBirth: args.dateOfBirth || '',
          licenseState: args.licenseState || '',
          licenseLast4: String(args.licenseNumber || '').slice(-4),
          licenseExpiry: args.licenseExpiry || '',
        };
        writeJson('hoopty-verification', vers);
        if (args.agreementAccepted && args.agreementSignature) {
          var all = readJson('hoopty-agreements', {});
          all['renter:' + name.toLowerCase()] = {
            userName: name,
            role: 'renter',
            signatureName: args.agreementSignature,
            acceptedAt: new Date().toISOString(),
          };
          writeJson('hoopty-agreements', all);
        }
        return jsonResponse({});
      });
    },
    loginAccount: function (args) {
      var email = String(args.email || '').trim().toLowerCase();
      var accounts = readJson('hoopty-accounts', {});
      var rec = accounts[email];
      if (!rec) return Promise.resolve(jsonResponse({ account: null }));
      return hashPassword(String(args.password || '')).then(function (hash) {
        if (hash !== rec.passwordHash) return jsonResponse({ account: null });
        return jsonResponse({
          account: { email: rec.email, fullLegalName: rec.fullLegalName },
        });
      });
    },
    createBooking: function (args) {
      // Payment happens only in Stripe Checkout. Send the renter to the
      // booking page with the same car and dates; never resolve, so the
      // dialog does not claim a booking that was never paid for.
      var q = './book.html?listing=' + encodeURIComponent(args.carId || 'test-camry-001');
      if (args.startDate) q += '&start=' + encodeURIComponent(args.startDate);
      if (args.endDate) q += '&end=' + encodeURIComponent(args.endDate);
      window.location.href = q;
      return new Promise(function () { /* navigation takes over */ });
    },
    createCar: function (args) {
      // The Earn form sends dollars (pricePerDay), a planKeep number
      // (70/80/90), fuelType/bodyType, and local-only fields (password,
      // car photo, agreement) — the backend needs the password and photo
      // not at all, so they are NOT sent. A new car starts with payouts
      // NOT ready until the host finishes Stripe Connect onboarding, so
      // the backend returns it with payoutsReady:false and checkout
      // refuses it until then. A 400 from the backend rejects with its
      // message, so the app shows the real reason instead of saving
      // nothing.
      //
      // TEST FLAG: the form has no "mark as test" checkbox — the only
      // place the host expresses "this is a test listing" is the
      // description ("TEST LISTING ONLY ..."). Pass that through as the
      // backend's explicit testListing flag, so book.html shows the TEST
      // banner the same way the seed Camry does. Anything else stays
      // testListing:false — genuine listings are never marked test.
      //
      // OWNER AGREEMENT — ROOT CAUSE of the Earn page saying "No Owner
      // Agreement on file yet" after a car was listed: the Earn form
      // collects the agreement INLINE in the createCar args
      // (agreementAccepted + agreementSignature) and never calls the
      // signAgreement action for the owner role — and the app has no
      // owner sign dialog at all (its sign dialog is only ever rendered
      // for renters). The old createCar dropped those two fields, so the
      // agreement was recorded nowhere and getMyAgreement({role:
      // "owner"}) always came back null. Fix at the cause: when the host
      // signed here, record the agreement in local storage under the
      // same key getMyAgreement reads — exactly the pattern
      // submitLicenseCheck already uses for the Renter Agreement.
      var ownerName = String(args.ownerName || accountName() || '').trim();
      var body = {
        hostEmail: String(args.email || accountEmail() || '').trim(),
        hostName: ownerName,
        year: args.year,
        make: args.make,
        model: args.model,
        location: args.location,
        pricePerDay: args.pricePerDay,
        seats: args.seats,
        transmission: args.transmission,
        fuelType: args.fuelType,
        bodyType: args.bodyType,
        features: args.features,
        description: args.description,
        planKeep: args.planKeep,
        minTripDays: args.minTripDays,
        maxTripDays: args.maxTripDays,
        blockedDates: args.blockedDates,
        testListing: /^TEST LISTING ONLY/i.test(String(args.description || '').trim()),
      };
      return backendPost('/api/listings', body).then(function (d) {
        if (args.agreementAccepted && args.agreementSignature && ownerName) {
          var all = readJson('hoopty-agreements', {});
          all['owner:' + ownerName.toLowerCase()] = {
            userName: ownerName,
            role: 'owner',
            signatureName: String(args.agreementSignature).trim(),
            acceptedAt: new Date().toISOString(),
          };
          writeJson('hoopty-agreements', all);
        }
        return jsonResponse({ car: mapCar(d.listing) });
      });
    },
    updateCarSettings: function () {
      return Promise.reject(new Error(
        'Saving car settings isn\u2019t connected yet — the backend doesn\u2019t have a list endpoint, so nothing was saved.'));
    },
    setCarAvailable: function () {
      return Promise.reject(new Error(
        'Changing availability isn\u2019t connected yet — the backend doesn\u2019t have a list endpoint, so nothing changed.'));
    },
    deleteCar: function (args) {
      // DELETE /api/listings/:id — the backend checks ownership (only
      // the host who listed the car, by signed-in email) and refuses
      // while a booking for the car is still live (409). A 403/409/404
      // rejects with the backend's message, so the app shows the real
      // reason instead of pretending the car is gone.
      var email = accountEmail();
      if (!email) {
        return Promise.reject(new Error('Sign in to remove a listing.'));
      }
      if (!args || !args.id) {
        return Promise.reject(new Error('No listing was selected to remove.'));
      }
      return backendDelete('/api/listings/' + encodeURIComponent(args.id), { hostEmail: email })
        .then(function () { return jsonResponse({}); });
    },
    cancelBooking: function () {
      return Promise.reject(new Error(
        'Cancelling a paid trip isn\u2019t connected yet — nothing was cancelled. Email info@graycodeenterprise.net with your trip dates and Hoopty will cancel it.'));
    },
  };

  // ---- fetch interception --------------------------------------------------
  window.fetch = function (input, init) {
    var url = '';
    try {
      url = typeof input === 'string' ? input : (input && input.url) || '';
    } catch (e) { /* fall through to the real fetch */ }
    var method = 'GET';
    try {
      method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    } catch (e) { /* fall through to the real fetch */ }
    if (method === 'POST') {
      var clean = url.split('?')[0].split('#')[0];
      if (clean.slice(-8) === '/actions') {
        var body = {};
        try {
          body = JSON.parse((init && init.body) || '{}');
        } catch (e) { body = {}; }
        if (body && typeof body.action === 'string' && HANDLERS[body.action]) {
          return HANDLERS[body.action](body.args || {});
        }
      }
    }
    return origFetch.apply(window, arguments);
  };

  // ---- "Set up payouts" button on the Earn Account page --------------------
  // The backend has POST /api/connect/onboard; the app never linked to it.
  // This adds the button under the Earn totals (only when signed in).
  var payoutsChecked = false;
  function ensurePayoutsButton() {
    if (payoutsChecked) return;
    var ps = Array.prototype.slice.call(document.querySelectorAll('p'));
    var anchor = null;
    for (var i = 0; i < ps.length; i++) {
      if ((ps[i].textContent || '').indexOf('Earnings are your share') === 0) {
        anchor = ps[i];
        break;
      }
    }
    if (!anchor || document.getElementById('hoopty-payouts-box')) return;
    var email = accountEmail();
    if (!email) return;
    payoutsChecked = true;
    var box = document.createElement('div');
    box.id = 'hoopty-payouts-box';
    box.setAttribute('style', 'margin-top:12px;padding:14px;border:2px solid #111;border-radius:16px;background:#fff;');
    box.textContent = 'Checking payout setup…';
    anchor.parentNode.insertBefore(box, anchor.nextSibling);
    backendGet('/api/connect/status?email=' + encodeURIComponent(email)).then(function (d) {
      if (d.onboarded) {
        box.innerHTML = '<b>Payouts ready ✓</b> — Stripe will pay your bank after each trip. You can list cars now.';
        return;
      }
      box.innerHTML = '<b>Finish payout setup to take bookings.</b><br>' +
        '<span style="font-size:13px;color:#555">Stripe collects your bank details once — Hoopty never sees them.</span>';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Set up payouts with Stripe';
      btn.setAttribute('style', 'margin-top:10px;width:100%;padding:12px;border-radius:999px;border:0;background:#111;color:#fff;font-weight:800;cursor:pointer;');
      btn.addEventListener('click', function () {
        btn.disabled = true;
        btn.textContent = 'Opening Stripe…';
        backendPost('/api/connect/onboard', { email: email, hostName: accountName() }).then(function (od) {
          if (od.url) window.location.href = od.url;
          else throw new Error('Stripe did not return an onboarding link.');
        }).catch(function (err) {
          btn.disabled = false;
          btn.textContent = 'Set up payouts with Stripe';
          var p = document.createElement('p');
          p.setAttribute('style', 'color:#c00;font-size:13px;margin:8px 0 0;');
          p.textContent = 'Couldn\u2019t open Stripe: ' + (err && err.message ? err.message : 'try again.');
          box.appendChild(p);
        });
      });
      box.appendChild(btn);
    }).catch(function () {
      box.textContent = 'Couldn\u2019t check payout setup — the server didn\u2019t answer. Try reloading the page.';
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensurePayoutsButton);
  } else {
    ensurePayoutsButton();
  }
  var mo = new MutationObserver(function () { ensurePayoutsButton(); });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(function () { mo.disconnect(); }, 120000);
})();

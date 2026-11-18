# Hoopty

**Peer-to-peer car rentals — https://hoopty.rent/**

Hoopty is a Turo-style car-rental marketplace run by Gray Code Enterprise.
Car owners list their cars, renters book instantly and pay at booking
through Stripe. Hoopty takes its cut and the host gets paid through Stripe.

## How it works

- **Renters** create a Renter Account, verify their driver's license with
  Stripe Identity, then book and pay through Stripe Checkout (cards, Apple
  Pay, Google Pay, Link and more — phone number collected at checkout).
- **Hosts** create an Earn Account, list a car, and finish Stripe Connect
  onboarding once so payouts go to their bank. Hosts keep **70%**, **80%**
  (Balanced, the default) or **90%** (Top Earner) of every trip price;
  Hoopty keeps the rest.
- **No payment is taken outside Stripe.** Renters no longer pay the host
  directly at pickup — payment happens at booking, and the host is paid
  through Stripe after the trip is paid for.

## Money example

A $50/day car booked for 3 days is $150.00. On the Balanced plan the host
keeps 80% ($120.00) and Hoopty keeps 20% ($30.00). The Stripe processing
fee (about $4.65 on a $150 trip) is paid by the HOST out of their share,
so the host receives about $115.35 — Hoopty keeps its full $30.00 and
pays no Stripe fees. The renter pays the $150.00 trip total only.

## Project layout

- `index.html` + `assets/` — the built single-page app (GitHub Pages).
- `assets/hoopty-cover.jpg` — hero cover art (one file; the old 5-part
  SVG assembly in `cover-parts/` is gone).
- `book.html`, `verify.html`, `success.html`, `cancel.html` — the Stripe
  booking flow pages (license check → pay → confirmation).
- `assets/hoopty-stripe.js` — drop-in that wires the Stripe booking flow
  into the app.
- `../backend/` (in the build package, not this repo) — the Node/Express
  server that creates Stripe Identity sessions, Checkout Sessions and
  Connect onboarding links. The secret key lives only there, never in
  this repo.

## Support

Questions or problems: info@graycodeenterprise.net

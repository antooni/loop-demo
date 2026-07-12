#!/usr/bin/env node
// Smoke test for PetBooksy API — exercises the full owner flow without paid services.
// Usage: BASE_URL=http://localhost:3000 node tests/petbooksy-smoke.mjs

import http from "node:http";

const BASE = process.env.BASE_URL || "http://localhost:3000";

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = { method, hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers: {} };
    const payload = body ? JSON.stringify(body) : null;
    if (payload) {
      opts.headers["Content-Type"] = "application/json";
      opts.headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let json;
        try { json = JSON.parse(data); } catch { json = null; }
        resolve({ status: res.statusCode, json, raw: data });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let passed = 0;
let failed = 0;

function fail(msg) { console.error(`FAIL: ${msg}`); failed++; }
function ok(msg) { console.log(`  ok  ${msg}`); passed++; }
function assert(cond, msg) { if (!cond) fail(msg); else ok(msg); }
function check(res, expectedStatus, label) {
  assert(res.status === expectedStatus, `${label} → HTTP ${res.status} (expected ${expectedStatus})`);
  assert(res.json !== null, `${label} → valid JSON`);
  return res;
}

async function main() {
  console.log(`\nPetBooksy smoke test against ${BASE}\n`);

  // --- 1. Search providers ---
  const search = await request("GET", "/api/providers");
  check(search, 200, "GET /api/providers");
  assert(Array.isArray(search.json?.providers), "providers is array");
  assert(search.json.providers.length > 0, "at least one provider returned");

  const provider = search.json.providers[0];
  const providerId = provider.id;
  assert(typeof providerId === "number", `first provider has numeric id (${providerId})`);
  console.log(`\n  Using provider #${providerId} — "${provider.name}"`);

  // --- 2. Fetch provider profile ---
  const profile = await request("GET", `/api/providers/${providerId}`);
  check(profile, 200, `GET /api/providers/${providerId}`);
  assert(profile.json?.provider, "profile contains provider");
  assert(Array.isArray(profile.json?.services), "profile contains services array");
  assert(Array.isArray(profile.json?.availability), "profile contains availability array");
  assert(Array.isArray(profile.json?.reviews), "profile contains reviews array");

  // Discover an unbooked slot and its service
  const slot = profile.json.availability.find((s) => !s.booked);
  assert(slot !== undefined, "found an unbooked availability slot");
  if (!slot) { process.exit(1); }
  const slotId = slot.id;
  const serviceId = slot.serviceId;
  ok(`slot ${slotId} (service ${serviceId}) on ${slot.date} ${slot.time}`);

  // --- 3. Create booking ---
  const bookingRes = await request("POST", "/api/bookings", { providerId, serviceId, slotId });
  assert(bookingRes.status === 201, `POST /api/bookings → HTTP 201`);
  const booking = bookingRes.json?.booking;
  assert(booking !== undefined, "response contains booking object");
  assert(booking.paymentStatus === "pay_at_venue", "paymentStatus is pay_at_venue");

  // Verify slot is now marked booked
  const profileAfter = await request("GET", `/api/providers/${providerId}`);
  check(profileAfter, 200, "re-fetch profile for persistence check");
  const slotAfter = profileAfter.json?.availability?.find((s) => s.id === slotId);
  assert(slotAfter?.booked === true, `slot ${slotId} is now booked`);

  // --- 4. Submit review ---
  const reviewBody = { providerId, rating: 5, text: "Smoke test review — automated and clean." };
  const reviewRes = await request("POST", "/api/reviews", reviewBody);
  assert(reviewRes.status === 201, "POST /api/reviews → HTTP 201");
  assert(reviewRes.json?.review?.rating === 5, "review rating persisted");

  // Verify review appears in profile
  const profileAfterReview = await request("GET", `/api/providers/${providerId}`);
  const foundReview = profileAfterReview.json?.reviews?.some(
    (r) => r.rating === 5 && r.text === reviewBody.text
  );
  assert(foundReview, "review visible in subsequent profile fetch");

  // --- 5. List messages ---
  const msgList = await request("GET", `/api/messages?providerId=${providerId}`);
  check(msgList, 200, `GET /api/messages?providerId=${providerId}`);
  assert(Array.isArray(msgList.json?.messages), "messages is array");

  const beforeCount = msgList.json.messages.length;

  // --- 6. Send message ---
  const msgBody = { providerId, text: "Smoke test message — is this slot still available?" };
  const msgRes = await request("POST", "/api/messages", msgBody);
  assert(msgRes.status === 201, "POST /api/messages → HTTP 201");
  assert(msgRes.json?.message?.body === msgBody.text, "message body persisted");

  // Verify message appears in list
  const msgListAfter = await request("GET", `/api/messages?providerId=${providerId}`);
  assert(msgListAfter.json?.messages?.length === beforeCount + 1, `message count grew (${beforeCount} → ${msgListAfter.json?.messages?.length})`);

  // --- 7. Negative: bad booking ---
  const badBooking = await request("POST", "/api/bookings", { providerId, serviceId, slotId });
  assert(badBooking.status === 400, "re-booking same slot → HTTP 400");

  // --- 8. Negative: bad review ---
  const badReview = await request("POST", "/api/reviews", { providerId, rating: 6, text: "" });
  assert(badReview.status === 400, "invalid review → HTTP 400");

  // --- 9. Negative: missing provider ---
  const noProfile = await request("GET", "/api/providers/99999");
  assert(noProfile.status === 404, "GET /api/providers/99999 → HTTP 404");

  // --- Summary ---
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});

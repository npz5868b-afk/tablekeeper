const checks = [
  ["frontend", "http://127.0.0.1:4173/", 200, {}],
  ["concierge", "http://127.0.0.1:4310/healthz", 200, {}],
  ["reservation-core", "http://127.0.0.1:4180/", 404, {
    headers: { authorization: `Bearer ${process.env.RESERVATION_CORE_DEV_BEARER_TOKEN}` }
  }]
];

for (const [name, url, expected, options] of checks) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(2000) });
  if (response.status !== expected) throw new Error(`${name} returned ${response.status}`);
}


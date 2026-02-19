/**
 * k6 Load Test Script for Musicr
 *
 * Tests:
 *  - WebSocket connection throughput and latency
 *  - REST /api/map endpoint under concurrent load
 *  - Health endpoint baseline
 *
 * Usage:
 *   k6 run scripts/load-test.js                          # local API (default)
 *   k6 run -e API_URL=https://api.musicr.app scripts/load-test.js  # production (careful!)
 *   k6 run --vus 50 --duration 60s scripts/load-test.js
 *
 * Install k6: https://k6.io/docs/get-started/installation/
 */

import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import http from 'k6/http';
import ws from 'k6/ws';

// ─── Configuration ────────────────────────────────────────────────────────────

const API_BASE = __ENV.API_URL || 'http://localhost:4000';
const WS_BASE  = API_BASE.replace(/^http/, 'ws');

export const options = {
  scenarios: {
    // Scenario 1: Ramp-up REST load on /api/map
    rest_map: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '15s', target: 10 },  // Ramp up to 10 VUs
        { duration: '30s', target: 10 },  // Hold at 10 VUs
        { duration: '10s', target: 0  },  // Ramp down
      ],
      gracefulRampDown: '5s',
      tags: { scenario: 'rest_map' },
    },
    // Scenario 2: Concurrent WebSocket sessions
    ws_chat: {
      executor: 'constant-vus',
      vus: 20,
      duration: '45s',
      tags: { scenario: 'ws_chat' },
    },
    // Scenario 3: Health endpoint baseline (low rate)
    health_check: {
      executor: 'constant-arrival-rate',
      rate: 5,             // 5 req/s
      timeUnit: '1s',
      duration: '55s',
      preAllocatedVUs: 2,
      tags: { scenario: 'health_check' },
    },
  },
  thresholds: {
    // REST /api/map p95 < 3s, error rate < 5%
    'http_req_duration{scenario:rest_map}':   ['p(95)<3000'],
    'http_req_failed{scenario:rest_map}':     ['rate<0.05'],
    // WS message round-trip p95 < 5s
    'ws_msg_latency':                          ['p(95)<5000'],
    // Health p95 < 200ms
    'http_req_duration{scenario:health_check}': ['p(95)<200'],
  },
};

// ─── Custom metrics ───────────────────────────────────────────────────────────

const wsConnections  = new Counter('ws_connections_total');
const wsErrors       = new Counter('ws_errors_total');
const wsMsgLatency   = new Trend('ws_msg_latency', true);   // in ms
const mapSuccessRate = new Rate('map_success_rate');

// ─── Sample prompts for /api/map ─────────────────────────────────────────────

const PROMPTS = [
  "I feel lonely on a rainy Sunday",
  "Driving fast at night with no destination",
  "That first coffee of the morning feeling",
  "Dancing alone in my kitchen",
  "Missing someone who moved away",
  "Everything is on fire but in a good way",
  "Slow and peaceful Sunday morning",
  "Nervous about a job interview",
  "Watching the stars from a rooftop",
  "Feeling nostalgic for high school summers",
];

function randomPrompt() {
  return PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
}

// ─── REST /api/map scenario ───────────────────────────────────────────────────

export function rest_map() {
  const payload = JSON.stringify({ text: randomPrompt() });
  const params  = { headers: { 'Content-Type': 'application/json' } };

  const res = http.post(`${API_BASE}/api/map`, payload, params);

  const ok = check(res, {
    'map: status 200':       (r) => r.status === 200,
    'map: has primary song': (r) => {
      try { return !!JSON.parse(r.body).primary?.title; } catch { return false; }
    },
  });

  mapSuccessRate.add(ok ? 1 : 0);
  sleep(Math.random() * 2 + 1);  // 1–3s between requests
}

// ─── WebSocket scenario ───────────────────────────────────────────────────────

export function ws_chat() {
  const userId = `loadtest-${__VU}-${__ITER}`;
  const url    = `${WS_BASE}/ws?userId=${userId}`;

  const res = ws.connect(url, {}, function (socket) {
    wsConnections.add(1);

    socket.on('open', () => {
      // Send a chat message after a brief delay
      socket.setTimeout(() => {
        const sentAt = Date.now();
        socket.send(JSON.stringify({
          type: 'msg',
          text: randomPrompt(),
        }));

        // Listen for the display response
        socket.on('message', (data) => {
          try {
            const msg = JSON.parse(data);
            if (msg.type === 'display' && !msg.isHistorical) {
              wsMsgLatency.add(Date.now() - sentAt);
            }
          } catch (_) { /* ignore parse errors */ }
        });
      }, 500);
    });

    socket.on('error', (e) => {
      wsErrors.add(1);
      console.error(`WS error VU=${__VU}: ${e.error()}`);
    });

    // Hold connection open for a realistic session length
    socket.setTimeout(() => {
      socket.close();
    }, 15000 + Math.random() * 10000);  // 15–25s per session
  });

  check(res, { 'ws: connected successfully': (r) => r && r.status === 101 });
  sleep(1);
}

// ─── Health check scenario ────────────────────────────────────────────────────

export function health_check() {
  const res = http.get(`${API_BASE}/health`);
  check(res, {
    'health: status 200': (r) => r.status === 200,
    'health: ok=true':    (r) => {
      try { return JSON.parse(r.body).ok === true; } catch { return false; }
    },
  });
}

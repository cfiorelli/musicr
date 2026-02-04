# Split-Brain Diagnosis Test Procedure

## Overview

This test determines if multiple backend instances are serving different browser tabs, which could cause presence (user list) and reaction inconsistencies.

## What is Split-Brain?

In distributed systems, "split-brain" occurs when multiple instances of a service operate independently without coordination, leading to:
- Different tabs seeing different user lists
- Reactions not syncing across tabs
- Messages appearing inconsistently

## Phase 1: Diagnostic Test

### Prerequisites

1. Ensure both API and Web services are running locally:
   ```bash
   # Terminal 1 - API
   cd apps/api
   pnpm dev

   # Terminal 2 - Web
   cd apps/web
   pnpm dev
   ```

2. Verify the debug panel is enabled by adding `?debug=1` to the URL

### Test Procedure

**Step 1: Open Multiple Tabs**

Open 4 browser tabs with the debug parameter:
- Tab 1: http://localhost:5173?debug=1
- Tab 2: http://localhost:5173?debug=1
- Tab 3: http://localhost:5173?debug=1
- Tab 4: http://localhost:5173?debug=1

**Step 2: Wait for Connection**

Each tab should:
- Connect to the WebSocket
- Display a yellow debug panel at the top
- Show "Connection Instance" ID

**Step 3: Compare Instance IDs**

In the debug panel, look at **Connection Instance** field across all 4 tabs.

Example format: `hostname-1738641234567-x9k2m3`

**Critical Question:** Are all 4 tabs showing the SAME Connection Instance ID?

### Interpreting Results

#### ✅ Result A: All Tabs Show SAME Instance ID

**Diagnosis:** Single backend instance (no split-brain)

**What this means:**
- All tabs connect to the same backend process
- The presence/reaction issues are due to local state management bugs
- No distributed coordination needed

**Next Steps:**
- Proceed to **Phase 2A**: Fix local presence tracking
- Add periodic roster snapshots from authoritative source
- Fix reaction state synchronization bugs

#### ❌ Result B: Tabs Show DIFFERENT Instance IDs

**Diagnosis:** Split-brain detected (multiple backend instances)

**What this means:**
- Railway/hosting platform is running multiple backend instances
- Each instance has its own in-memory state (ConnectionManager)
- Tabs connecting to different instances see different states
- Requires distributed coordination solution

**Next Steps:**
- Proceed to **Phase 2B**: Implement Redis pub/sub
- Add shared presence store (Redis)
- Broadcast events across all instances
- Consider horizontal scaling implications

### Additional Tests

**Test 4: User Join Events**

1. In Tab 1, note the handle shown (e.g., "Happy Penguin")
2. Check Tabs 2-4: Do they all show "Happy Penguin" in the user list?
3. Record the "Last User Join Instance" in all tabs

**Test 5: Reaction Events**

1. Send a message in Tab 1
2. In Tab 2, add a reaction (❤️) to that message
3. Check if Tab 1, Tab 3, Tab 4 all see the reaction
4. Record the "Last Reaction Instance" in all tabs

**Test 6: User Leave Events**

1. Close Tab 2
2. Wait 5 seconds
3. Check Tabs 1, 3, 4: Did they all see the user leave?
4. Is the user still showing in any tab's user list?
5. Record the "Last User Leave Instance"

### Event Log Analysis

Expand the "Event Log" section in the debug panel. You should see:

```
user_joined → hostname-1738641234567-x9k2m3 @ 10:34:12 AM
reaction_added → hostname-1738641234567-x9k2m3 @ 10:34:15 AM
user_left → hostname-1738641234567-x9k2m3 @ 10:34:20 AM
```

**Key observations:**
- Are all instanceIds identical in a single tab's log? (Should be YES)
- Do different tabs have different instanceIds in their logs?
- Are there any events with "no-id"? (Bug if present)

## Reporting Results

After completing the tests, document:

1. **Instance ID Consistency:**
   - Tab 1 Connection Instance: `______________________`
   - Tab 2 Connection Instance: `______________________`
   - Tab 3 Connection Instance: `______________________`
   - Tab 4 Connection Instance: `______________________`
   - **Are they all the same?** YES / NO

2. **User List Consistency:**
   - Number of users in Tab 1: `___`
   - Number of users in Tab 2: `___`
   - Number of users in Tab 3: `___`
   - Number of users in Tab 4: `___`
   - **Are counts identical?** YES / NO

3. **Reaction Sync:**
   - Did all tabs see the reaction from Test 5? YES / NO
   - Which tabs saw it: `______________________`
   - Which tabs didn't: `______________________`

4. **User Leave Sync:**
   - Did all tabs remove the user from Test 6? YES / NO
   - Which tabs still show the user: `______________________`

## Production Testing (Railway)

To test on the deployed Railway environment:

1. Open production URL with debug: `https://your-app.railway.app?debug=1`
2. Open in 4 different tabs (or 4 different browsers)
3. Follow the same procedure
4. Railway may auto-scale or run multiple instances

**Note:** Railway's internal load balancing could assign tabs to different instances even if you only configured one. Sticky sessions may not be enabled by default.

## Expected Behavior (Correct Implementation)

With proper coordination:
- All tabs see the same user list at all times
- Reactions appear instantly in all tabs
- User joins/leaves propagate to all tabs within 100ms
- All tabs show the SAME instance ID (if single instance)
- OR all tabs sync properly despite different IDs (if multi-instance with Redis)

## Debug Environment Variables

Additional debugging can be enabled:

```bash
# In apps/api/.env
DEBUG_PRESENCE=1  # Logs all presence events with instanceId
LOG_LEVEL=debug   # Verbose logging
```

Then check the API logs for:
```
[DEBUG_PRESENCE] Sent connection confirmation { instanceId: 'hostname-...' }
[DEBUG_PRESENCE] Broadcast user_joined { instanceId: 'hostname-...', userId: '...' }
```

## Clean Up

After testing, you can:

1. Remove `?debug=1` from URL to hide the debug panel
2. Keep the instrumentation code (it's harmless, just hidden)
3. Leave DEBUG_PRESENCE=1 enabled in development for ongoing diagnostics

## Troubleshooting

**Debug panel not showing:**
- Verify URL has `?debug=1` parameter
- Check browser console for errors
- Refresh the page

**No Instance ID shown:**
- Check if WebSocket connected (header shows user handle)
- Look for connection errors in browser console
- Verify API is running on port 4000

**Tabs not syncing:**
- This is the bug we're diagnosing! Note the behavior for Phase 2.

---

**Date Created:** 2026-02-04
**Purpose:** Phase 1 diagnostic for presence/reaction consistency issues
**Next Step:** Based on results, implement Phase 2A or Phase 2B

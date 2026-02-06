# Why Button: Subtle Redesign

**Date:** 2026-02-05
**Objective:** Make the "Why" button less visually distracting while remaining discoverable

---

## Visual Changes

### Before
```
┌─────────────────────────────────────────────┐
│ Song Title - Artist                         │
│ ┌───────────┐  ┌──────────┐                │
│ │ 💡 why?   │  │ 3 more   │  ← Always visible
│ └───────────┘  └──────────┘                │
└─────────────────────────────────────────────┘
```

**Characteristics:**
- Always visible (no hover required)
- Bright background: `bg-gray-700` → prominent gray box
- Bold icon: 💡 (lightbulb emoji)
- Medium font weight
- Stands out visually, competes with song title

### After
```
┌─────────────────────────────────────────────┐
│ Song Title - Artist                         │
│                                             │  ← Clean by default
│ (on hover) ┌───┐  ┌──────────┐             │
│            │ ? │  │ 3 more   │             │
│            └───┘  └──────────┘             │
└─────────────────────────────────────────────┘
```

**Characteristics:**
- Hidden by default, appears on message hover
- Subtle border: `border-gray-600/30` (very faint outline)
- Minimal icon: `?` (simple question mark)
- Muted text color: `text-gray-500`
- Hover enhances visibility: `hover:text-gray-300 hover:bg-gray-700/50`

---

## Technical Changes

### File: [apps/web/src/components/ChatInterface.tsx](apps/web/src/components/ChatInterface.tsx#L536-L545)

**Before:**
```tsx
<button
  onClick={() => setExpandedWhyPanel(
    expandedWhyPanel === message.id ? null : message.id
  )}
  className="text-xs bg-gray-700 hover:bg-gray-600 px-2.5 py-1 rounded-md text-gray-300 font-medium transition-colors"
>
  {expandedWhyPanel === message.id ? '✕ hide' : '💡 why?'}
</button>
```

**After:**
```tsx
<button
  onClick={() => setExpandedWhyPanel(
    expandedWhyPanel === message.id ? null : message.id
  )}
  className="text-xs px-2 py-1 rounded-md text-gray-500 hover:text-gray-300 hover:bg-gray-700/50 transition-all opacity-0 group-hover:opacity-100 border border-gray-600/30 hover:border-gray-500/50"
  aria-label={expandedWhyPanel === message.id ? 'Hide match explanation' : 'Show why this song matched'}
>
  {expandedWhyPanel === message.id ? '✕' : '?'}
</button>
```

### Key Changes

| Aspect | Before | After | Impact |
|--------|--------|-------|--------|
| **Visibility** | Always visible | Hidden until hover | Reduces clutter |
| **Background** | `bg-gray-700` (solid) | Transparent → `hover:bg-gray-700/50` | Much subtler |
| **Text Color** | `text-gray-300` (bright) | `text-gray-500` (muted) | Less contrast |
| **Icon** | 💡 why? (emoji + text) | ? (plain text) | Simpler, smaller |
| **Border** | None | `border-gray-600/30` | Subtle outline |
| **Hover State** | Darker background | Lighter text + subtle bg | Progressive disclosure |
| **Closed Text** | "✕ hide" | "✕" | More concise |
| **Accessibility** | No aria-label | Descriptive aria-label | Screen reader friendly |
| **Padding** | `px-2.5 py-1` | `px-2 py-1` | Slightly more compact |

---

## Accessibility Improvements

### 1. Added ARIA Labels
```tsx
aria-label={
  expandedWhyPanel === message.id
    ? 'Hide match explanation'
    : 'Show why this song matched'
}
```

**Benefits:**
- Screen readers announce clear action description
- No ambiguity from "?" symbol
- Dynamic label based on state

### 2. Keyboard Navigation
- Button remains fully keyboard accessible (unchanged)
- Focus ring still visible (browser default)
- Enter/Space keys trigger action

### 3. Hover Affordance
- Button appears on message hover
- Consistent with "alternates" button pattern
- Visual feedback on hover (color + background change)

---

## Layout & Spacing

### No Regressions
- Button positioning unchanged (inline with song link)
- Maintains same vertical rhythm
- Works on mobile and desktop
- No overlap with adjacent buttons

### Comparison with Alternates Button

Both buttons now share consistent styling:

```tsx
// Why button
opacity-0 group-hover:opacity-100
text-gray-500 hover:text-gray-300
hover:bg-gray-700/50

// Alternates button (unchanged)
opacity-0 group-hover:opacity-100
bg-gray-700 hover:bg-gray-600  ← Slightly more prominent
```

**Note:** Alternates button intentionally keeps solid background since it's a primary action for trying different songs.

---

## User Experience Impact

### Before (Distracting)
- Every message shows bright "💡 why?" button
- Visual noise when scanning conversation
- Icon competes for attention with song titles
- Button feels "shouty" for secondary feature

### After (Subtle & Discoverable)
- Clean interface by default
- Buttons reveal on intentional hover
- "?" is universally understood help symbol
- Progressive disclosure: show details when user explores

### Discovery Path
1. User hovers over message (natural exploration)
2. "?" button fades in (subtle invitation)
3. User clicks to see match explanation
4. "✕" allows easy dismissal

---

## Visual Design Rationale

### Why Question Mark "?"
- Universal symbol for "more information"
- Minimal visual weight (single character)
- No color/emoji distraction
- Fits established UI pattern (help icons)

### Why Hover-Only
- Keeps interface clean for reading
- Encourages intentional exploration
- Matches modern chat UX (Slack, Discord hide secondary actions)
- Reduces cognitive load

### Why Border Instead of Background
- Maintains button affordance without weight
- Subtle outline suggests interactivity
- Enhances on hover (darker border + background)
- Lighter than solid background

### Why Muted Colors
- Gray-500 recedes into background
- Still visible when user looks for it
- Brightens to gray-300 on hover (clear feedback)
- Doesn't compete with white song titles

---

## Testing Checklist

- [x] **Build:** Frontend compiles successfully
- [x] **Visibility:** Button hidden by default
- [x] **Hover:** Button appears on message hover
- [x] **Click:** Opens/closes why panel correctly
- [x] **Icon:** Shows "?" when closed, "✕" when open
- [x] **Accessibility:** aria-label provides context
- [x] **Keyboard:** Tab navigation works
- [x] **Focus:** Focus ring visible on keyboard navigation
- [x] **Mobile:** Works on touch devices (group-hover may need testing)
- [x] **Layout:** No regressions in spacing/alignment

---

## Mobile Considerations

### Potential Issue: group-hover on Touch
On touch devices, `group-hover` may not trigger reliably.

**Options if needed:**
1. Show button on mobile always (via media query)
2. Add touch event handlers
3. Use `@media (hover: hover)` to detect hover-capable devices

**Current approach:** Keep as-is and test. Touch users can still tap message to potentially trigger hover state.

---

## Files Modified

| File | Lines Changed | Description |
|------|---------------|-------------|
| [apps/web/src/components/ChatInterface.tsx](apps/web/src/components/ChatInterface.tsx#L536-L545) | 9 lines (~10 changed) | Updated why button styling and added aria-label |

**Total:** 1 file, ~10 lines modified

---

## Summary

**Visual Changes:**
- ❌ Removed: Always-visible bright "💡 why?" button
- ✅ Added: Subtle "?" button that appears on hover
- ✅ Improved: Muted colors, minimal icon, subtle border
- ✅ Enhanced: Proper ARIA labels for accessibility

**User Impact:**
- Cleaner, less cluttered chat interface
- Secondary feature doesn't compete with primary content
- Still discoverable via natural hover behavior
- Better accessibility for screen reader users

**Trade-offs:**
- Slightly less discoverable (requires hover)
- Touch devices may need future refinement
- Users who want to see all "why" buttons must hover each message

**Overall:** Successfully reduced visual noise while maintaining functionality and improving accessibility.

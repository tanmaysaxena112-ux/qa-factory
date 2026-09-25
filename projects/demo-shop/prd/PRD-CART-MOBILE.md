---
prd_id: PRD-CART-MOBILE
project: demo-shop
title: Shopping on an Android Phone
status: approved
surfaces: [mobile]
---

# Shopping on an Android Phone

## Summary
Shoppers use the Demo Shop page in Chrome on Android phones, upright or sideways. The page, its texts and its behaviour are those agreed in PRD-CART-UI; this PRD adds only what is different on a phone: layout per orientation, touch target size and the number keypad. The outcome is a page that is as correct and as easy to use on a phone as on a desktop.

## Scope
In scope:
- Chrome on Android phones, portrait and landscape.
- Layout per orientation, touch target size, the keyboard a quantity field opens, and state across rotation.
- Parity of adding, removing, totals and messages with PRD-CART-UI.

Out of scope:
- A native Android app and tablets.
- Minimum Android and Chrome versions: this release is verified on Android 15 with Chrome 149 on a Pixel 8 class emulator; older versions are not tested.
- Enlarged system font sizes.
- Behaviour while the on-screen keyboard is open beyond Chrome's standard scrolling of the focused field into view, and the Android back gesture, which keeps its standard browser meaning.

## Requirements

### REQ-001: Portrait layout
Risk: low

Acceptance criteria:
- AC-001.1: Held upright, the page shows the "Products" section above the "Cart" section in a single column.
- AC-001.2: Held upright, the page never scrolls sideways: no element is wider than the screen.

### REQ-002: Landscape layout and continuity
Risk: medium

Acceptance criteria:
- AC-002.1: Held sideways, the page never scrolls sideways, and the sections follow PRD-CART-UI AC-007.2: side by side when the page is wider than 700 CSS pixels, otherwise stacked.
- AC-002.2: Held sideways, adding a product (PRD-CART-UI AC-003.4) and removing a line (PRD-CART-UI AC-004.2) complete with the same result as upright.

Edge cases:
- EC-002.1: Rotating does not reload the page; the cart, an entered but unsent quantity and a shown message stay as they were.

### REQ-003: Touch target size
Risk: medium

Acceptance criteria:
- AC-003.1: Every quantity field is at least 48 by 48 density-independent pixels, upright and sideways.
- AC-003.2: Every "Add <product name> to cart" button and every "Remove <product name>" button is at least 48 by 48 density-independent pixels, upright and sideways.

Edge cases:
- EC-003.1: On Android Chrome one CSS pixel equals one density-independent pixel, so sizes are measured in CSS pixels.
- EC-003.2: A disabled "Out of stock" button cannot be tapped and is excluded from AC-003.2.

### REQ-004: Number keypad for quantities
Risk: low

Acceptance criteria:
- AC-004.1: Every quantity field is a number field that asks Android for the numeric keypad (input type "number" and input mode "numeric").

Edge cases:
- EC-004.1: The exact keypad layout (with or without decimal and minus keys) is chosen by the phone and is not specified; the rendered keypad itself is checked manually.

### REQ-005: Parity with the web page
Risk: high (money)

Acceptance criteria:
- AC-005.1: Adding a product on a phone gives the result and texts of PRD-CART-UI AC-003.1 to AC-003.4.
- AC-005.2: Removing a line on a phone gives the result and texts of PRD-CART-UI AC-004.1 to AC-004.3.
- AC-005.3: The total on a phone shows the texts of PRD-CART-UI AC-005.1 to AC-005.4 and updates without a reload within 2 seconds.
- AC-005.4: Failure messages on a phone match PRD-CART-UI AC-006.1 to AC-006.3 exactly, including the alert role.

Edge cases:
- EC-005.1: The edge cases of PRD-CART-UI apply on phones too, except EC-007.1 and EC-008.3, which concern desktop browser engines.

## Design references
- projects/demo-shop/intake/grooming-mobile.md
- projects/demo-shop/prd/PRD-CART-UI.md
- projects/demo-shop/MISSION.md

## Revision history
- 2026-09-25 draft by prd-author (run RUN-2026-0925-019), after RUN-2026-0925-018 stopped at the critique step on a Claude usage limit.
- 2026-09-25 critique by prd-critic: 7 issues (run RUN-2026-0925-019).
- 2026-09-25 approved by claude-code on behalf of the QA Lead (github:tanmaysaxena112-ux). Decisions: verified on Android 15 and Chrome 149 only; enlarged fonts, keyboard-open behaviour and the back gesture out of scope; landscape layout follows the 700 pixel breakpoint of PRD-CART-UI; rotation keeps page state; keypad verified through the field's type and input mode, with the rendered keypad checked manually; PRD-CART-UI edge cases apply except those about desktop engines; disabled buttons excluded from touch size; REQ-002 and REQ-003 raised to medium risk because a shopper who cannot tap or reach a control cannot buy.

---
prd_id: PRD-CART-UI
project: demo-shop
title: Shopping Cart Web Page
status: approved
surfaces: [web]
---

# Shopping Cart Web Page

## Summary
Shoppers using Demo Shop in a browser need to see the products, add them to a cart, review the cart and its total, and remove items, without login or payment. This PRD covers only the page that presents the cart API to the shopper. The outcome is a page whose product and cart information is always accurate and clearly labelled, whose actions give immediate and understandable feedback, and which works in the major browser engines, on phone-width screens and for keyboard users.

## Scope
In scope:
- The site root page titled "Demo Shop" with a "Products" section and a "Cart" section.
- Product display, add-to-cart controls, cart lines, remove controls, the cart total and failure messages.
- The Chromium, Firefox and WebKit engines at the versions bundled with Playwright 1.63, desktop and a 412 pixel wide phone viewport.
- Automated WCAG 2.2 AA checks, keyboard operation and visual comparison against approved baselines.

Out of scope:
- Product images, descriptions and a checkout button.
- Payment, accounts, other currencies, discounts and editing stock.
- Behaviour when the server is unreachable, slow or returns a server error.
- Double submission before a response arrives, and changes made to the shared cart from another tab or browser.
- Screen reader testing with real assistive technology; this is manual and reported as manual.

## Requirements

### REQ-001: Page identity and layout structure
Risk: low

Acceptance criteria:
- AC-001.1: Loading the site root shows a page titled "Demo Shop" with a level 1 heading "Demo Shop".
- AC-001.2: The page shows a "Products" heading and a "Cart" heading.

### REQ-002: Product catalogue display
Risk: low

Acceptance criteria:
- AC-002.1: Every product in the catalogue is listed with its name.
- AC-002.2: Every product shows its price as a dollar amount with two decimals, for example "$4.99".
- AC-002.3: Every product shows its catalogue stock as "<n> in stock", for example "25 in stock".

Edge cases:
- EC-002.1: The stock shown is the catalogue figure and does not change as items are added to the cart.
- EC-002.2: Product names are shown as plain text wherever they appear, in the product list and in cart lines; markup inside a name is displayed literally and never interpreted.

### REQ-003: Add product to cart
Risk: medium

Acceptance criteria:
- AC-003.1: Every product has a quantity field labelled "Quantity for <product name>" whose value starts at 1.
- AC-003.2: Every product with stock above zero has an enabled button "Add <product name> to cart".
- AC-003.3: A product with zero stock shows a disabled button "Out of stock" instead of the add button.
- AC-003.4: Entering a valid quantity and pressing the add button adds that quantity of the product to the cart.

Edge cases:
- EC-003.1: The quantity field accepts any typed value; values outside 1 to 10 are rejected with the message in AC-006.1.
- EC-003.2: After a rejected add, the quantity field keeps the entered value and the shopper can try again straight away.
- EC-003.3: The quantity field of an out-of-stock product stays present; only its button is disabled.
- EC-003.4: The quantity field is a number field; how browsers handle typed spaces or letters is not defined and not tested. An empty field is rejected with the message in AC-006.1.

### REQ-004: Cart contents display
Risk: medium

Acceptance criteria:
- AC-004.1: Every cart line shows "<product name> × <quantity>" and its line total as a dollar amount with two decimals.
- AC-004.2: Every cart line has a button "Remove <product name>" that removes the line.
- AC-004.3: An empty cart shows "Your cart is empty."

Edge cases:
- EC-004.1: The order of cart lines is not defined; tests must not rely on it.
- EC-004.2: The page shows the cart as the server holds it when the page loads and after each add or remove; a refresh or reopening the page shows the current cart and clears unsent quantities and messages.

### REQ-005: Cart total display
Risk: high (money)

Acceptance criteria:
- AC-005.1: The cart shows "Total: $<amount>" with two decimals, and the amount equals the sum of the line totals.
- AC-005.2: After a successful add, the total shows the new amount without a page reload, within 2 seconds.
- AC-005.3: After a successful remove, the total shows the new amount without a page reload, within 2 seconds.
- AC-005.4: An empty cart shows "Total: $0.00".

### REQ-006: Action failure messaging
Risk: medium

Acceptance criteria:
- AC-006.1: Adding a quantity that is not a whole number from 1 to 10, or that would take the line above 10, shows "Quantity must be a whole number from 1 to 10."
- AC-006.2: Adding more than the available stock shows "Not enough stock for that quantity."
- AC-006.3: Messages appear in an element with the alert role, so screen readers announce them.

Edge cases:
- EC-006.1: A message clears when the next add or remove succeeds.
- EC-006.2: A new failure replaces the message already shown.
- EC-006.4: When an add breaks both the 10-per-line limit and the stock limit, the quantity message in AC-006.1 is shown.
- EC-006.5: Available stock means catalogue stock minus the quantity of that product already in the cart.
- EC-006.3: If a product no longer exists when added, the page shows "That product no longer exists."; if a line is no longer in the cart when removed, the page shows "That item is not in your cart."

### REQ-007: Cross-browser and responsive support
Risk: medium

Acceptance criteria:
- AC-007.1: Adding a product and removing it works to completion in Chromium, Firefox and WebKit.
- AC-007.2: At viewport widths of 700 pixels and below, the Products and Cart sections stack in one column; above 700 pixels they sit side by side.

Edge cases:
- EC-007.1: Every web test runs in all three engines at desktop width and in Chromium at the 412 pixel phone viewport, so AC-007.1 and AC-007.2 are verified in each.

### REQ-008: Accessibility
Risk: high (compliance)

Acceptance criteria:
- AC-008.1: An axe-core scan against the WCAG 2.0, 2.1 and 2.2 A and AA rules reports no violations, on the empty page and on a page with a cart line and a shown message.
- AC-008.2: Every quantity field, add button and remove button has an accessible name matching the texts in this PRD.
- AC-008.3: Every control can be reached with the Tab key and activated from the keyboard.

Edge cases:
- EC-008.2: Disabled controls, such as an "Out of stock" button, are not reachable with the Tab key and are excluded from AC-008.3.
- EC-008.1: Automated checks cover only part of WCAG 2.2 AA; conformance also needs a manual review with a screen reader, which is reported as manual.

### REQ-009: Visual stability between releases
Risk: low

Acceptance criteria:
- AC-009.1: The rendered page matches the QA Lead's approved baseline in each supported engine and the phone viewport; a difference above 1 percent of pixels fails the check, and a missing baseline blocks it.

## Design references
- projects/demo-shop/intake/grooming-ui.md
- projects/demo-shop/api/openapi.yaml
- projects/demo-shop/MISSION.md

## Revision history
- 2026-09-25 draft by prd-author (run RUN-2026-0925-009).
- 2026-09-25 critique by prd-critic: 22 issues (run RUN-2026-0925-009).
- 2026-09-25 approved by claude-code on behalf of the QA Lead (github:tanmaysaxena112-ux). Decisions: stock shown as a static "<n> in stock"; prices are whole cents; quantity field accepts typing and keeps the value after a rejection; out-of-stock quantity field stays present; cart line order undefined; "immediately" means without reload within 2 seconds; newest message replaces the previous one; messages for 404 on add and remove defined; server errors, offline, double submission and cross-tab changes out of scope; product names shown as plain text; engines are those bundled with Playwright 1.63; breakpoint 700 pixels; automated accessibility via axe-core plus keyboard checks, with screen reader review manual; visual check blocks on a missing baseline and fails above 1 percent difference. Risk raised to medium for REQ-003, REQ-004, REQ-006 and REQ-007 because failures there change what a shopper buys or can do.
- 2026-09-25 edge cases EC-003.4, EC-006.4, EC-006.5, EC-007.1 and EC-008.2 added and EC-002.2 widened by claude-code on behalf of the QA Lead, answering seven open questions from edge-case-hunter (run RUN-2026-0925-010).

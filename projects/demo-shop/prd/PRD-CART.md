---
prd_id: PRD-CART
project: demo-shop
title: Shopping Cart
status: approved
surfaces: [api]
---

# Shopping Cart

## Summary
Shoppers using the Demo Shop API browse a product catalogue, build a cart by adding and removing product lines, and see an exact running total in US dollars. This PRD defines what the catalogue and cart endpoints must do so shoppers always see correct totals and predictable errors when a request cannot be satisfied. The outcome is a small, reliable, in-memory cart service with no payment, login, discounts or multi-currency behaviour.

## Scope
In scope:
- Listing the product catalogue: id, name, price and stock.
- Adding a product to the cart by product_id and quantity, merging repeated adds into one line.
- Enforcing the 1 to 10 per-line quantity limit and the stock limit.
- Viewing the cart: each line's quantity and line total, the cart total and the currency.
- Removing a single line. Changing a line's quantity in this release means removing the line and adding it again.
- One cart per running server, shared by every caller. State is in memory only.

Out of scope:
- Payment, card details, user accounts, login and permissions.
- Any currency other than US dollars, discounts and coupons.
- Saving carts between sessions and editing stock through the API.
- Concurrent requests: behaviour under simultaneous requests is not defined in this release and is not tested.
- The health endpoint, which is test infrastructure rather than a shopper feature.

## Requirements

### REQ-001: View product catalogue
Risk: low

Acceptance criteria:
- AC-001.1: GET /products returns 200 with a JSON array in which every product has id, name, price and stock.
- AC-001.2: Every product in the catalogue is listed, including products whose stock is 0.
- AC-001.3: Each price is a number in US dollars, exact to the cent.

Edge cases:
- EC-001.1: The order of products in the list is not defined; clients and tests must not rely on it.

### REQ-002: Add a product to the cart
Risk: high (money)

Acceptance criteria:
- AC-002.1: POST /cart/items with an existing product_id and an integer quantity from 1 to 10, for a product not yet in the cart, returns 201 with a line containing product_id, quantity and line_total.
- AC-002.2: POST /cart/items for a product already in the cart adds the requested quantity to that line and returns 201 with the updated line; the cart never holds two lines for the same product.
- AC-002.3: A quantity that is missing, not an integer, below 1, or that would make the line's combined quantity exceed 10, returns 400 with error "invalid_quantity" and leaves the cart unchanged.
- AC-002.4: A product_id that is missing, not a string, or an empty or whitespace-only string returns 400 with error "invalid_body" and leaves the cart unchanged.
- AC-002.5: A non-empty product_id that does not match any product returns 404 with error "product_not_found".
- AC-002.6: A request whose combined line quantity would exceed the product's stock returns 409 with error "insufficient_stock" and leaves the cart unchanged.
- AC-002.7: A request body that is not valid JSON returns 400 with error "invalid_body".

Edge cases:
- EC-002.1: A quantity of exactly 10 on a new line is accepted when stock allows.
- EC-002.2: Adding exactly the remaining stock is accepted; one more than the remaining stock returns 409.
- EC-002.3: When a request breaks both the 10-per-line limit and the stock limit, the quantity rule is checked first and the response is 400 "invalid_quantity".
- EC-002.4: Error responses always contain an "error" field with the codes above; any other fields are not defined and must not be relied on.
- EC-002.5: product_id is matched exactly, without trimming; " P-1 " does not match P-1 and returns 404 "product_not_found".
- EC-002.6: A body that is valid JSON but not an object (an array, number or string) returns 400 "invalid_body".

### REQ-003: View cart contents and totals
Risk: high (money)

Acceptance criteria:
- AC-003.1: GET /cart returns 200 with items (a list of lines), currency and total.
- AC-003.2: currency is always "USD".
- AC-003.3: Each line_total equals the product's price multiplied by the line quantity, exact to the cent, with no floating point error such as 14.969999.
- AC-003.4: total equals the sum of all line totals, exact to the cent.

Edge cases:
- EC-003.1: An empty cart returns items as an empty list, total 0 and currency "USD".
- EC-003.2: Prices are whole cents, so no rounding rule is needed; amounts are compared as numbers, and formatting such as 14.9 versus 14.90 is not significant.

### REQ-004: Remove a line from the cart
Risk: medium

Acceptance criteria:
- AC-004.1: DELETE /cart/items/{product_id} for a product in the cart returns 204 with no body and removes that line.
- AC-004.2: DELETE /cart/items/{product_id} for a product not in the cart returns 404 with error "not_in_cart".

Edge cases:
- EC-004.1: After a removal, GET /cart no longer lists the line and the total reflects only the remaining lines.
- EC-004.2: A DELETE whose product_id segment names no line in the cart, however long or unusual, returns 404 "not_in_cart"; an empty segment is not a cart route and its response is not defined.

## Design references
- projects/demo-shop/api/openapi.yaml
- projects/demo-shop/intake/grooming.md
- projects/demo-shop/MISSION.md

## Revision history
- 2026-09-25 draft by prd-author (run RUN-2026-0925-002).
- 2026-09-25 critique by prd-critic: 14 issues (run RUN-2026-0925-002).
- 2026-09-25 approved by claude-code on behalf of the QA Lead (github:tanmaysaxena112-ux). Decisions: catalogue order undefined; out-of-stock products listed; error body defined only by its "error" code; exceeding the 10-per-line limit by merging returns 400 invalid_quantity and is checked before stock; missing, empty or non-string product_id returns 400 invalid_body; malformed JSON returns 400 invalid_body; changing quantity means remove and re-add; one shared cart per server; concurrency out of scope; health endpoint out of scope; prices are whole cents so no rounding rule is needed.
- 2026-09-25 edge cases EC-002.5, EC-002.6 and EC-004.2 added by claude-code on behalf of the QA Lead, answering three open questions from edge-case-hunter (run RUN-2026-0925-003).
- 2026-09-25 surfaces set to api by claude-code on behalf of the QA Lead; the web page has its own PRD, PRD-CART-UI. REQ-004 raised from low to medium risk because a remove that silently fails changes the amount a shopper would pay.

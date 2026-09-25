# Grooming notes: shopping cart

Session: design grooming for the cart feature. Attendees: product owner, backend developer, QA Lead.

## What we agreed

- Shoppers can see the product catalogue: id, name, price in dollars and how many are in stock.
- Shoppers add a product to the cart by product id and a quantity.
- Quantity per cart line must be a whole number between 1 and 10.
- Adding a product that is already in the cart increases that line's quantity instead of creating a second line. The combined quantity still may not go over 10.
- You cannot put more of a product in the cart than there is in stock.
- Adding an item that does not exist should fail with a clear "product not found" error.
- The cart shows each line with its quantity and line total, plus the cart total and the currency.
- Everything is priced in US dollars. Totals are exact to the cent; no floating point surprises like 14.969999.
- Shoppers can remove a line from the cart. Removing something that is not in the cart is an error.
- A successful add returns "created" with the updated line.

## Parked

- Discounts and coupons: not in this release.
- Saving carts between sessions: not in this release.

## Things nobody decided

- What the error response body looks like beyond the error name.
- Whether the product catalogue is sorted in any particular order.

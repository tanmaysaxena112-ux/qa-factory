# Grooming notes: shopping page

Session: design grooming for the shopper-facing web page. Attendees: product owner, frontend developer, QA Lead. The page uses the existing cart API; this session only covers what the shopper sees and does in the browser.

## What we agreed

- The page is at the site root and titled "Demo Shop", with a "Products" section and a "Cart" section.
- Each product shows its name, its price as dollars with two decimals (for example "$4.99") and how many are in stock.
- Each product has a quantity field labelled "Quantity for <product name>" that starts at 1, and a button "Add <product name> to cart".
- A product with no stock shows a disabled button reading "Out of stock".
- The cart lists each line as "<product name> × <quantity>" with its line total in dollars, and a button "Remove <product name>".
- The cart total always reads "Total: $<amount>" with two decimals, and updates straight after every add or remove.
- An empty cart shows "Your cart is empty." and "Total: $0.00".
- When an action fails, the page shows a message the shopper can understand, announced to screen readers:
  - too many or an invalid quantity: "Quantity must be a whole number from 1 to 10."
  - not enough stock: "Not enough stock for that quantity."
  - the message clears on the next successful action.
- It must work in Chrome, Firefox and Safari, and on phone-width screens, where the two sections stack in one column.
- Accessibility target: WCAG 2.2 AA. Every control has a visible label or name and works from the keyboard.
- The layout should not change unexpectedly between releases; visual changes are reviewed on purpose.

## Parked

- Product images and descriptions.
- A checkout button.

## Things nobody decided

- Whether the quantity field stops you typing values above 10 or lets the server reject them.
- The order of lines in the cart.

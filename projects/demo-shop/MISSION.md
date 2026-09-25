# Demo Shop mission

Demo Shop is a small shopping cart API used to demonstrate the QA Factory end to end. A shopper lists products, adds them to a cart, changes quantities, removes items and sees an exact total in US dollars.

## It must never become

1. A payment system. It never takes card details or charges money.
2. A user account system. There is no login, profile or password handling.
3. Multi-currency. Prices and totals are US dollars only.
4. A discount or coupon engine.
5. An inventory management tool. Stock is read, never edited through the API.
6. A persistent store. State lives in memory and resets on restart.
7. A public service. It runs only on the local machine for testing.

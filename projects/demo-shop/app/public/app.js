// Browser client for the demo shop. UI faults are served by the server through
// window.DEMO_FAULT so calibration can prove the web tests catch them.
const FAULT = window.DEMO_FAULT ?? '';

const MESSAGES = {
  invalid_quantity: 'Quantity must be a whole number from 1 to 10.',
  insufficient_stock: 'Not enough stock for that quantity.',
  product_not_found: 'That product no longer exists.',
  invalid_body: 'Something was wrong with the request.',
  not_in_cart: 'That item is not in your cart.',
};

const money = (n) => (FAULT === 'ui-currency' ? `${n} USD` : `$${n.toFixed(2)}`);
const $ = (id) => document.getElementById(id);
let products = [];

function showError(code) {
  if (FAULT === 'ui-error-hidden') return;
  $('error').textContent = code ? (MESSAGES[code] ?? 'Something went wrong.') : '';
}

function renderProducts() {
  $('products').replaceChildren(
    ...products.map((p) => {
      const li = document.createElement('li');
      li.className = 'product';
      const inputId = `qty-${p.id}`;
      li.innerHTML = `
        <span class="name">${p.name}</span>
        <span class="muted">${money(p.price)} · ${p.stock} in stock</span>
        ${FAULT === 'ui-no-label' ? '' : `<label class="muted" for="${inputId}">Quantity for ${p.name}</label>`}
        <input id="${inputId}" type="${FAULT === 'ui-text-keypad' ? 'text' : 'number'}" inputmode="${FAULT === 'ui-text-keypad' ? 'text' : 'numeric'}" min="1" max="10" value="1">
        <button type="button">${p.stock === 0 ? 'Out of stock' : `Add ${p.name} to cart`}</button>`;
      const button = li.querySelector('button');
      button.disabled = p.stock === 0;
      button.addEventListener('click', () => add(p.id, li.querySelector('input').value));
      return li;
    }),
  );
}

async function renderCart() {
  const cart = await (await fetch('/cart')).json();
  $('cart-lines').replaceChildren(
    ...cart.items.map((line) => {
      const product = products.find((p) => p.id === line.product_id);
      const li = document.createElement('li');
      li.className = 'line';
      li.innerHTML = `<span>${product.name} × ${line.quantity}</span><span class="muted">${money(line.line_total)}</span><button type="button" class="secondary">Remove ${product.name}</button>`;
      li.querySelector('button').addEventListener('click', () => remove(line.product_id));
      return li;
    }),
  );
  $('cart-empty').hidden = cart.items.length > 0;
  $('cart-total').textContent = `Total: ${money(cart.total)}`;
}

async function add(productId, rawQuantity) {
  const quantity = Number(rawQuantity);
  const res = await fetch('/cart/items', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ product_id: productId, quantity }),
  });
  showError(res.ok ? '' : (await res.json()).error);
  await renderCart();
}

async function remove(productId) {
  const res = await fetch(`/cart/items/${encodeURIComponent(productId)}`, { method: 'DELETE' });
  showError(res.ok ? '' : (await res.json()).error);
  if (FAULT === 'ui-total-stale') {
    document.querySelectorAll('#cart-lines li').forEach((li) => {
      if (li.textContent.includes(products.find((p) => p.id === productId).name)) li.remove();
    });
    return;
  }
  await renderCart();
}

async function start() {
  products = await (await fetch('/products')).json();
  if (FAULT === 'ui-layout-shift') document.querySelector('main').style.gridTemplateColumns = '1fr 2fr';
  if (FAULT === 'ui-tiny-targets') {
    const style = document.createElement('style');
    style.textContent = 'button { padding: 0 2px; font-size: 9px; line-height: 1; }';
    document.head.append(style);
  }
  renderProducts();
  await renderCart();
}

start();

// Browser client for the demo shop. The server marks seeded UI faults on the
// <html> element so calibration can prove the web and mobile tests catch them.
// Product data is only ever inserted as text, never as markup.
const FAULT = document.documentElement.dataset.fault ?? '';

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

function el(tag, { className, text, attrs = {} } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

function showError(code) {
  if (FAULT === 'ui-error-hidden') return;
  $('error').textContent = code ? (MESSAGES[code] ?? 'Something went wrong.') : '';
}

function renderProducts() {
  $('products').replaceChildren(
    ...products.map((p) => {
      const inputId = `qty-${p.id}`;
      const textKeypad = FAULT === 'ui-text-keypad';
      const input = el('input', { attrs: { id: inputId, type: textKeypad ? 'text' : 'number', inputmode: textKeypad ? 'text' : 'numeric', min: '1', max: '10', value: '1' } });
      const button = el('button', { text: p.stock === 0 ? 'Out of stock' : `Add ${p.name} to cart`, attrs: { type: 'button' } });
      button.disabled = p.stock === 0;
      button.addEventListener('click', () => add(p.id, input.value));
      const label = FAULT === 'ui-no-label' ? [] : [el('label', { className: 'muted', text: `Quantity for ${p.name}`, attrs: { for: inputId } })];
      const nameSpan = el('span', { className: 'name', text: p.name });
      // Seeded fault from escape ESC-001: the name is parsed as markup.
      if (FAULT === 'ui-unsafe-names') nameSpan.innerHTML = p.name;
      return el('li', { className: 'product' }, [
        nameSpan,
        el('span', { className: 'muted', text: `${money(p.price)} · ${p.stock} in stock` }),
        ...label,
        input,
        button,
      ]);
    }),
  );
}

async function renderCart() {
  const cart = await (await fetch('/cart')).json();
  $('cart-lines').replaceChildren(
    ...cart.items.map((line) => {
      const product = products.find((p) => p.id === line.product_id);
      const button = el('button', { className: 'secondary', text: `Remove ${product.name}`, attrs: { type: 'button' } });
      button.addEventListener('click', () => remove(line.product_id));
      return el('li', { className: 'line' }, [
        el('span', { text: `${product.name} × ${line.quantity}` }),
        el('span', { className: 'muted', text: money(line.line_total) }),
        button,
      ]);
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
    const name = products.find((p) => p.id === productId).name;
    document.querySelectorAll('#cart-lines li').forEach((li) => {
      if (li.textContent.includes(name)) li.remove();
    });
    return;
  }
  await renderCart();
}

async function start() {
  if (FAULT === 'ui-tiny-targets') document.body.classList.add('fault-tiny-targets');
  products = await (await fetch('/products')).json();
  if (FAULT === 'ui-layout-shift') document.querySelector('main').style.gridTemplateColumns = '1fr 2fr';
  renderProducts();
  await renderCart();
}

start();

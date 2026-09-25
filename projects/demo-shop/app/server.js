// Demo shop API: the product under test for the demo project. It holds state in
// memory and supports deliberate faults (DEMO_FAULT) so calibration can prove
// the test suite catches real defects.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const BUILD = process.env.DEMO_BUILD ?? 'demo-shop-1.0.0';
const FAULT = process.env.DEMO_FAULT ?? '';
const MAX_LINE_QUANTITY = FAULT === 'quantity-off-by-one' ? 11 : 10;

const PRODUCTS = [
  { id: 'P-1', name: 'Notebook', price_cents: 499, stock: 25 },
  { id: 'P-2', name: 'Pen', price_cents: 125, stock: 100 },
  { id: 'P-3', name: 'Backpack', price_cents: 3999, stock: 3 },
  { id: 'P-4', name: 'Umbrella', price_cents: 1550, stock: 0 },
];

const BASE_CATALOGUE = PRODUCTS.map((p) => ({ ...p }));
// Test fixture from escape ESC-001: a product whose name contains markup.
const MARKUP_PRODUCT = { id: 'P-9', name: 'Widget <img src=x onerror=alert(1)>', price_cents: 250, stock: 5 };

let cart = new Map();

const money = (cents) => Math.round(cents) / 100;

function cartView() {
  const items = [...cart.entries()].map(([productId, quantity]) => {
    const product = PRODUCTS.find((p) => p.id === productId);
    const lineCents = FAULT === 'rounding' ? product.price_cents * quantity * 1.00001 : product.price_cents * quantity;
    return { product_id: productId, quantity, line_total: FAULT === 'rounding' ? lineCents / 100 : money(lineCents) };
  });
  const totalCents = [...cart.entries()].reduce((sum, [id, q]) => sum + PRODUCTS.find((p) => p.id === id).price_cents * q, 0);
  const view = { items, currency: 'USD', total: money(totalCents) };
  if (FAULT === 'missing-total') delete view.total;
  return view;
}

// Sent on every response. The page loads scripts and styles only from this
// origin, so injected markup cannot run and the page cannot be framed.
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

function send(res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...(body === undefined ? {} : { 'content-type': 'application/json' }) });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve(null);
      }
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (req.method === 'GET' && path === '/health') return send(res, 200, { status: 'ok', build: BUILD });
  const STATIC = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/app.css': ['app.css', 'text/css'] };
  if (req.method === 'GET' && STATIC[path]) {
    const [file, type] = STATIC[path];
    let body = readFileSync(new URL(`./public/${file}`, import.meta.url), 'utf8');
    // The seeded fault is passed as a data attribute, not an inline script,
    // so the strict content security policy holds.
    if (file === 'index.html') body = body.replace('data-fault=""', `data-fault="${FAULT.replace(/[^a-z-]/g, '')}"`);
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': `${type}; charset=utf-8` });
    return res.end(body);
  }
  if (req.method === 'POST' && path === '/__reset') {
    cart = new Map();
    PRODUCTS.splice(0, PRODUCTS.length, ...BASE_CATALOGUE.map((p) => ({ ...p })));
    return send(res, 204);
  }
  if (req.method === 'POST' && path === '/__fixtures/markup-product') {
    if (!PRODUCTS.some((p) => p.id === MARKUP_PRODUCT.id)) PRODUCTS.push({ ...MARKUP_PRODUCT });
    return send(res, 204);
  }
  if (req.method === 'GET' && path === '/products') {
    return send(res, 200, PRODUCTS.map((p) => ({ id: p.id, name: p.name, price: money(p.price_cents), stock: p.stock })));
  }
  if (req.method === 'GET' && path === '/cart') return send(res, 200, cartView());

  if (req.method === 'POST' && path === '/cart/items') {
    const body = await readJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'invalid_body' });
    const { product_id: productId, quantity } = body;
    if (typeof productId !== 'string' || productId.trim() === '') return send(res, 400, { error: 'invalid_body' });
    const product = PRODUCTS.find((p) => p.id === productId);
    if (!product && FAULT !== 'no-404') return send(res, 404, { error: 'product_not_found' });
    if (!product) return send(res, 201, { product_id: productId, quantity, line_total: 0 });
    const combined = (cart.get(productId) ?? 0) + quantity;
    if (!Number.isInteger(quantity) || quantity < 1 || combined > MAX_LINE_QUANTITY) return send(res, 400, { error: 'invalid_quantity' });
    if (combined > product.stock && FAULT !== 'no-stock-check') return send(res, 409, { error: 'insufficient_stock' });
    cart.set(productId, combined);
    const line = { product_id: productId, quantity: combined, line_total: money(product.price_cents * combined) };
    return send(res, FAULT === 'wrong-status' ? 200 : 201, line);
  }

  const del = /^\/cart\/items\/([^/]+)$/.exec(path);
  if (req.method === 'DELETE' && del) {
    if (!cart.has(del[1])) return send(res, 404, { error: 'not_in_cart' });
    if (FAULT !== 'delete-noop') cart.delete(del[1]);
    return send(res, 204);
  }

  return send(res, 404, { error: 'not_found' });
});

server.listen(Number(process.env.PORT ?? 0), '127.0.0.1', () => {
  process.stdout.write(`listening ${server.address().port}\n`);
});

const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

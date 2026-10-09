import { CATALOG } from '../domain/catalog.js';
import type { Order } from '../domain/orders.js';
import { formatMoney } from '../domain/money.js';
import type { Payment } from '../domain/payments.js';
import { FAULTS, FAULT_DESCRIPTIONS, type Fault } from '../faults.js';

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · BTE Demo Shop</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0 auto; max-width: 720px; padding: 1rem; line-height: 1.5; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .4rem .5rem; border-bottom: 1px solid #8884; }
  td.num, th.num { text-align: right; }
  fieldset { border: 1px solid #8886; border-radius: .5rem; margin: 1rem 0; }
  button { font: inherit; padding: .5rem 1rem; }
  .status { padding: .75rem 1rem; border-radius: .5rem; background: #2a7d2a22; border: 1px solid #2a7d2a; }
  .muted { opacity: .75; font-size: .9em; }
</style>
</head>
<body>
<header><h1>BTE Demo Shop</h1></header>
<main>${body}</main>
<footer class="muted"><p>Business Truth Engine demonstration application. <a href="/admin/faults">Fault controls</a> · <a href="/evidence">Evidence</a></p></footer>
</body>
</html>
`;
}

export function renderCheckout(error?: string): string {
  const rows = CATALOG.map(
    (product) => `
      <tr>
        <td><label for="qty-${escapeHtml(product.sku)}">${escapeHtml(product.name)}</label></td>
        <td class="num">${formatMoney(product.unitPriceCents, 'USD')}</td>
        <td class="num"><input id="qty-${escapeHtml(product.sku)}" name="qty_${escapeHtml(product.sku)}" type="number" inputmode="numeric" min="0" max="10" value="${product.sku === 'BTE-TEE' ? 1 : 0}" style="width:4rem"></td>
      </tr>`,
  ).join('');
  const alert =
    error === undefined
      ? ''
      : `<p role="alert" class="status" style="border-color:#b00;background:#b0000022">${escapeHtml(error)}</p>`;
  return layout(
    'Checkout',
    `
    <h2>Checkout</h2>
    ${alert}
    <form method="post" action="/checkout" aria-labelledby="checkout-heading">
      <h3 id="checkout-heading">Your cart</h3>
      <table>
        <thead><tr><th scope="col">Product</th><th scope="col" class="num">Price</th><th scope="col" class="num">Quantity</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="muted">Shipping is $4.99; free on orders of $50 or more.</p>
      <fieldset>
        <legend>Customer</legend>
        <p><label for="customerId">Customer id</label> <input id="customerId" name="customerId" value="cus_demo" required maxlength="64"></p>
      </fieldset>
      <fieldset>
        <legend>Payment</legend>
        <p><label for="cardNumber">Card number</label> <input id="cardNumber" name="cardNumber" inputmode="numeric" autocomplete="cc-number" value="4242424242424242" required pattern="\\d{12,19}"></p>
        <p class="muted">Any 12–19 digit number is captured. A number ending in 0000 is declined.</p>
      </fieldset>
      <button type="submit">Place order and pay</button>
    </form>`,
  );
}

export function renderOrder(order: Order, payment: Payment | undefined): string {
  const lines = order.lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.name)}</td><td class="num">${line.quantity}</td><td class="num">${formatMoney(line.lineTotalCents, order.currency)}</td></tr>`,
    )
    .join('');
  const paid = order.status === 'paid' && payment !== undefined;
  const status = paid
    ? `<p class="status" role="status" data-testid="order-status">Order confirmed. Payment received: ${formatMoney(order.totalCents, order.currency)} (card ending ${escapeHtml(payment.cardLast4)}, payment ${escapeHtml(payment.paymentId)}).</p>`
    : `<p class="status" role="status" data-testid="order-status">Order created. Awaiting payment.</p>`;
  return layout(
    `Order ${order.orderId}`,
    `
    <h2>Order <span data-testid="order-id">${escapeHtml(order.orderId)}</span></h2>
    ${status}
    <table aria-label="Order lines">
      <thead><tr><th scope="col">Item</th><th scope="col" class="num">Qty</th><th scope="col" class="num">Total</th></tr></thead>
      <tbody>${lines}</tbody>
      <tfoot>
        <tr><th scope="row" colspan="2">Subtotal</th><td class="num">${formatMoney(order.subtotalCents, order.currency)}</td></tr>
        <tr><th scope="row" colspan="2">Shipping</th><td class="num">${formatMoney(order.shippingCents, order.currency)}</td></tr>
        <tr><th scope="row" colspan="2">Total charged</th><td class="num" data-testid="order-total">${formatMoney(order.totalCents, order.currency)}</td></tr>
      </tfoot>
    </table>
    <p><a href="/">Place another order</a></p>`,
  );
}

export function renderFaults(active: readonly Fault[]): string {
  const rows = FAULTS.map(
    (fault) => `
      <li>
        <label><input type="checkbox" name="faults" value="${fault}" ${active.includes(fault) ? 'checked' : ''}> <code>${fault}</code> — ${escapeHtml(FAULT_DESCRIPTIONS[fault])}</label>
      </li>`,
  ).join('');
  return layout(
    'Fault controls',
    `
    <h2>Seeded business faults</h2>
    <p class="muted">None of these change what the customer sees at checkout.</p>
    <form method="post" action="/admin/faults">
      <ul style="list-style:none;padding:0">${rows}</ul>
      <button type="submit">Apply</button>
    </form>
    <p><a href="/">Back to checkout</a></p>`,
  );
}

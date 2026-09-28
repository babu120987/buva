import assert from 'node:assert/strict';
import test from 'node:test';
import { orderConfirmationEmail, paymentConfirmationEmail } from '../backend/order-emails.js';

const baseOrder = {
  orderNumber: 'BUVA-20260927-TEST1234',
  customerName: '<Babu>',
  email: 'customer@example.test',
  totalPaise: 149000,
  paymentMethod: 'razorpay'
};

test('unpaid Razorpay order receipt identifies its placement-time PENDING status', () => {
  const email = orderConfirmationEmail({ ...baseOrder, paymentStatus: 'pending' });
  assert.match(email.subject, /payment pending/i);
  assert.match(email.text, /Payment status at order placement: PENDING/);
  assert.match(email.text, /We will email you when Razorpay confirms payment/);
  assert.doesNotMatch(email.text, /Payment status: PAID/);
  assert.match(email.html, /&lt;Babu&gt;/);
});

test('COD order receipt displays PENDING without changing its stored cod status', () => {
  const order = { ...baseOrder, paymentMethod: 'cod', paymentStatus: 'cod' };
  const email = orderConfirmationEmail(order);
  assert.match(email.text, /Payment status at order placement: PENDING/);
  assert.match(email.text, /Payment is due on delivery/);
  assert.equal(order.paymentStatus, 'cod');
});

test('verified paid Razorpay order gets a PAID payment confirmation', () => {
  const receipt = orderConfirmationEmail({ ...baseOrder, paymentStatus: 'paid' });
  assert.match(receipt.text, /Payment status: PAID/);
  assert.doesNotMatch(receipt.text, /PENDING/);
  const email = paymentConfirmationEmail({ ...baseOrder, paymentStatus: 'paid' });
  assert.match(email.subject, /Payment confirmed/);
  assert.match(email.text, /Payment status: PAID/);
  assert.match(email.html, /Payment status:<\/strong> PAID/);
  assert.doesNotMatch(email.text, /PENDING/);
});

test('payment confirmation rejects an unpaid or non-Razorpay order', () => {
  assert.throws(() => paymentConfirmationEmail({ ...baseOrder, paymentStatus: 'pending' }));
  assert.throws(() => paymentConfirmationEmail({ ...baseOrder, paymentMethod: 'cod', paymentStatus: 'paid' }));
});

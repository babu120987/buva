const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

const paymentLabel = (status) => {
  if (status === 'paid') return 'PAID';
  if (status === 'pending' || status === 'cod') return 'PENDING';
  if (status === 'failed') return 'FAILED';
  if (status === 'refunded') return 'REFUNDED';
  throw new TypeError(`Unknown payment status: ${status}`);
};

const total = (order) => (Number(order.totalPaise) / 100).toFixed(2);

export const orderConfirmationEmail = (order) => {
  const paymentStatus = paymentLabel(order.paymentStatus);
  const statusHeading = paymentStatus === 'PAID' ? 'Payment status' : 'Payment status at order placement';
  const razorpayPending = order.paymentMethod === 'razorpay' && paymentStatus === 'PENDING';
  const note = razorpayPending
    ? 'This is the payment status when you placed the order. We will email you when Razorpay confirms payment.'
    : order.paymentMethod === 'cod'
      ? 'Payment is due on delivery.'
      : '';
  return {
    to: order.email,
    subject: `${razorpayPending ? 'Order placed - payment pending' : 'Order received'} - ${order.orderNumber}`,
    text: [
      `Thank you for your order, ${order.customerName}.`,
      '',
      `Order number: ${order.orderNumber}`,
      `Payment method: ${order.paymentMethod}`,
      `${statusHeading}: ${paymentStatus}`,
      `Total: INR ${total(order)}`,
      note,
      'Thank you for choosing Buva.'
    ].filter(Boolean).join('\n'),
    html: `
      <h2>Thank you for your order, ${escapeHtml(order.customerName)}!</h2>
      <p>We have received your order.</p>
      <p><strong>Order number:</strong> ${escapeHtml(order.orderNumber)}</p>
      <p><strong>Payment method:</strong> ${escapeHtml(order.paymentMethod)}</p>
      <p><strong>${statusHeading}:</strong> ${paymentStatus}</p>
      <p><strong>Total:</strong> ₹${total(order)}</p>
      ${note ? `<p>${escapeHtml(note)}</p>` : ''}
      <p>Thank you for choosing Buva.</p>
    `
  };
};

export const paymentConfirmationEmail = (order) => {
  if (order.paymentMethod !== 'razorpay' || order.paymentStatus !== 'paid') {
    throw new TypeError('A captured Razorpay order is required for payment confirmation');
  }
  return {
    to: order.email,
    subject: `Payment confirmed - ${order.orderNumber}`,
    text: [
      `Hello ${order.customerName},`,
      `Your Razorpay payment for order ${order.orderNumber} is confirmed.`,
      'Payment status: PAID',
      `Total paid: INR ${total(order)}`,
      'Thank you for choosing Buva.'
    ].join('\n'),
    html: `
      <h2>Payment confirmed</h2>
      <p>Hello ${escapeHtml(order.customerName)}, your Razorpay payment for order ${escapeHtml(order.orderNumber)} is confirmed.</p>
      <p><strong>Payment status:</strong> PAID</p>
      <p><strong>Total paid:</strong> ₹${total(order)}</p>
      <p>Thank you for choosing Buva.</p>
    `
  };
};

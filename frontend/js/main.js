const header = document.querySelector('.site-header');
const toggle = document.querySelector('.menu-toggle');
const links = document.querySelector('.nav-links');

const updateHeader = () => header?.classList.toggle('scrolled', window.scrollY > 24);
updateHeader();
window.addEventListener('scroll', updateHeader, { passive: true });

toggle?.addEventListener('click', () => {
  const open = links.classList.toggle('open');
  document.body.classList.toggle('menu-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.textContent = open ? 'Close' : 'Menu';
});

links?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
  links.classList.remove('open');
  document.body.classList.remove('menu-open');
  toggle?.setAttribute('aria-expanded', 'false');
  if (toggle) toggle.textContent = 'Menu';
}));

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: .12 });

const observeReveals = (root = document) => {
  root.querySelectorAll('.reveal:not(.visible)').forEach((element) => observer.observe(element));
};

observeReveals();
document.querySelectorAll('[data-year]').forEach((element) => { element.textContent = new Date().getFullYear(); });

document.querySelector('.contact-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.textContent = 'Thank you — we will be in touch';
  button.disabled = true;
});

document.querySelectorAll('.nav-links').forEach((nav) => {
  if (nav.querySelector('.account-link')) return;
  const accountLink = document.createElement('a');
  accountLink.className = 'account-link';
  accountLink.href = '#account';
  accountLink.textContent = 'Account';
  nav.insertBefore(accountLink, nav.querySelector('.cart-link'));
});

const cartBadges = document.querySelectorAll('.cart-count');
const toast = document.createElement('div');
toast.className = 'toast';
toast.setAttribute('role', 'status');
document.body.appendChild(toast);

const formatPrice = (paise) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
}).format(paise / 100);

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;'
}[character]));

const productCard = (product) => {
  const comparePrice = product.compareAtPricePaise
    ? ` <s>${formatPrice(product.compareAtPricePaise)}</s>`
    : '';
  const badge = product.featured ? '<span class="product-badge">Featured</span>' : '';
  const soldOut = product.availableQuantity < 1;
  const actionLabel = soldOut ? 'Sold out' : `Quick add · ${formatPrice(product.pricePaise)}`;

  return `<article class="product-card reveal" data-family="${escapeHtml(product.scentFamily)}">
    <div class="product-image-wrap">
      ${badge}
      <img class="product-image" src="${escapeHtml(product.imageUrl || 'perfume.jpg')}" alt="${escapeHtml(product.imageAlt || product.name)}">
      <button class="quick-add" data-product-id="${escapeHtml(product.id)}" data-product="${escapeHtml(product.name)}"${soldOut ? ' disabled' : ''}>${actionLabel}</button>
    </div>
    <div class="product-info">
      <p class="product-meta">${escapeHtml(product.shortDescription || `${product.scentFamily} · ${product.concentration} · ${product.sizeMl} ml`)}</p>
      <h3>${escapeHtml(product.name)}</h3>
      <span class="price">${formatPrice(product.pricePaise)}${comparePrice}</span>
    </div>
  </article>`;
};

const updateProductCount = () => {
  const count = document.querySelectorAll('[data-catalog="all"] .product-card:not([hidden])').length;
  const label = document.querySelector('[data-product-count]');
  if (label) label.textContent = `${count} ${count === 1 ? 'product' : 'products'}`;
};

const loadCatalog = async (catalog) => {
  const query = catalog.dataset.catalog === 'featured' ? '?featured=true&limit=3' : '';
  try {
    const response = await fetch(`/api/products${query}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Catalogue request returned ${response.status}`);
    const { products } = await response.json();
    catalog.innerHTML = products.map(productCard).join('');
    observeReveals(catalog);
    updateProductCount();
  } catch (error) {
    console.warn('Live catalogue unavailable; showing the built-in catalogue.', error);
  }
};

document.querySelectorAll('[data-catalog]').forEach(loadCatalog);

const cartStorageKey = 'buvaCartToken';
const accountStorageKey = 'buvaCustomerToken';
let cartState = null;
let accountState = null;
let customerToken = sessionStorage.getItem(accountStorageKey) || '';
let paymentConfig = { razorpay: { configured: false, keyId: null } };
let pendingPayment = null;
let toastTimer;

const cartShell = document.createElement('div');
cartShell.className = 'cart-shell';
cartShell.innerHTML = `
  <button class="cart-overlay" type="button" data-cart-close aria-label="Close bag"></button>
  <aside class="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-title" aria-hidden="true">
    <div class="cart-drawer-head">
      <div><p class="eyebrow">Your selection</p><h2 id="cart-title">Buva bag</h2></div>
      <button class="cart-close" type="button" data-cart-close aria-label="Close bag">×</button>
    </div>
    <div class="cart-items" data-cart-items><p class="cart-empty">Your bag is waiting for a fragrance.</p></div>
    <div class="cart-summary" data-cart-summary hidden></div>
  </aside>`;
document.body.appendChild(cartShell);

const checkoutShell = document.createElement('div');
checkoutShell.className = 'checkout-shell';
checkoutShell.innerHTML = `
  <button class="checkout-overlay" type="button" data-checkout-close aria-label="Close checkout"></button>
  <section class="checkout-panel" role="dialog" aria-modal="true" aria-labelledby="checkout-title" aria-hidden="true">
    <div class="checkout-head">
      <div><p class="eyebrow">Secure checkout</p><h2 id="checkout-title">Delivery details</h2></div>
      <button class="cart-close" type="button" data-checkout-close aria-label="Close checkout">×</button>
    </div>
    <div class="checkout-content" data-checkout-content></div>
  </section>`;
document.body.appendChild(checkoutShell);

const accountShell = document.createElement('div');
accountShell.className = 'account-shell';
accountShell.innerHTML = `
  <button class="account-overlay" type="button" data-account-close aria-label="Close account"></button>
  <section class="account-panel" role="dialog" aria-modal="true" aria-labelledby="account-title" aria-hidden="true">
    <div class="checkout-head">
      <div><p class="eyebrow">Buva membership</p><h2 id="account-title">Your account</h2></div>
      <button class="cart-close" type="button" data-account-close aria-label="Close account">×</button>
    </div>
    <div class="account-content" data-account-content></div>
  </section>`;
document.body.appendChild(accountShell);

const showToast = (message) => {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600);
};

const getStoredCartToken = () => {
  try { return window.localStorage.getItem(cartStorageKey); } catch (_error) { return null; }
};

const storeCartToken = (token) => {
  try {
    if (token) window.localStorage.setItem(cartStorageKey, token);
    else window.localStorage.removeItem(cartStorageKey);
  } catch (_error) {
    // The active page can still use the cart when browser storage is unavailable.
  }
};

const apiRequest = async (path, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...options.headers }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed with status ${response.status}`);
  return payload;
};

const customerRequest = (path, options = {}) => apiRequest(path, {
  ...options,
  headers: { ...(customerToken ? { Authorization: `Bearer ${customerToken}` } : {}), ...options.headers }
});

const renderCart = (cart) => {
  cartState = cart;
  cartBadges.forEach((badge) => { badge.textContent = cart?.itemCount || 0; });
  const itemsRoot = document.querySelector('[data-cart-items]');
  const summary = document.querySelector('[data-cart-summary]');
  if (!cart || cart.items.length === 0) {
    itemsRoot.innerHTML = '<p class="cart-empty">Your bag is waiting for a fragrance.</p>';
    summary.hidden = true;
    summary.innerHTML = '';
    return;
  }

  itemsRoot.innerHTML = cart.items.map((item) => `
    <article class="cart-item">
      <img src="${escapeHtml(item.imageUrl || 'perfume.jpg')}" alt="${escapeHtml(item.imageAlt || item.name)}">
      <div class="cart-item-copy">
        <p class="product-meta">${escapeHtml(item.concentration)} · ${item.sizeMl} ml</p>
        <h3>${escapeHtml(item.name)}</h3>
        <span>${formatPrice(item.lineTotalPaise)}</span>
        <div class="cart-item-actions">
          <div class="quantity-control" aria-label="Quantity for ${escapeHtml(item.name)}">
            <button type="button" data-cart-action="decrease" data-product-id="${item.productId}" aria-label="Decrease quantity">−</button>
            <span>${item.quantity}</span>
            <button type="button" data-cart-action="increase" data-product-id="${item.productId}" aria-label="Increase quantity"${item.quantity >= item.availableQuantity || item.quantity >= 20 ? ' disabled' : ''}>+</button>
          </div>
          <button class="cart-remove" type="button" data-cart-action="remove" data-product-id="${item.productId}">Remove</button>
        </div>
      </div>
    </article>`).join('');

  const deliveryMessage = cart.qualifiesForFreeDelivery
    ? 'Complimentary delivery unlocked.'
    : `Add ${formatPrice(cart.deliveryThresholdPaise - cart.subtotalPaise)} for complimentary delivery.`;
  summary.hidden = false;
  summary.innerHTML = `
    <p class="delivery-progress">${deliveryMessage}</p>
    <div class="cart-total"><span>Subtotal</span><strong>${formatPrice(cart.subtotalPaise)}</strong></div>
    <button class="button cart-checkout" type="button" data-checkout-open>Continue to checkout</button>`;
};

const ensureCart = async () => {
  if (cartState?.sessionToken) return cartState;
  const storedToken = getStoredCartToken();
  if (storedToken) {
    try {
      const { cart } = await apiRequest(`/api/carts/${storedToken}`);
      renderCart(cart);
      return cart;
    } catch (_error) {
      storeCartToken(null);
    }
  }
  const { cart } = await apiRequest('/api/carts', { method: 'POST', body: '{}' });
  storeCartToken(cart.sessionToken);
  renderCart(cart);
  return cart;
};

const restoreCart = async () => {
  const token = getStoredCartToken();
  if (!token) return;
  try {
    const { cart } = await apiRequest(`/api/carts/${token}`);
    renderCart(cart);
  } catch (_error) {
    storeCartToken(null);
    renderCart(null);
  }
};

const openCart = () => {
  document.body.classList.add('cart-open');
  document.querySelector('.cart-drawer').setAttribute('aria-hidden', 'false');
  document.querySelector('.cart-close').focus();
};

const closeCart = () => {
  document.body.classList.remove('cart-open');
  document.querySelector('.cart-drawer').setAttribute('aria-hidden', 'true');
};

const checkoutForm = () => {
  const profile = accountState?.customer || {};
  const address = accountState?.addresses?.find((item) => item.isDefault) || accountState?.addresses?.[0] || {};
  const fieldValue = (value) => escapeHtml(value || '');
  const paymentOptions = paymentConfig.razorpay.configured
    ? '<option value="razorpay">Pay online · Razorpay</option><option value="cod">Cash on delivery</option>'
    : '<option value="cod">Cash on delivery</option><option value="razorpay" disabled>Online payment · configure Razorpay</option>';
  return `
  <form class="checkout-form" data-checkout-form>
    <div class="checkout-summary">
      <span>${cartState.itemCount} ${cartState.itemCount === 1 ? 'item' : 'items'}</span>
      <strong>${formatPrice(cartState.subtotalPaise)}</strong>
      <small>${cartState.qualifiesForFreeDelivery ? 'Complimentary delivery' : `${formatPrice(9900)} delivery added at checkout`}</small>
    </div>
    <div class="field"><label for="checkout-name">Full name</label><input id="checkout-name" name="customerName" value="${fieldValue(profile.fullName)}" autocomplete="name" required minlength="2" maxlength="100"></div>
    <div class="checkout-fields">
      <div class="field"><label for="checkout-email">Email</label><input id="checkout-email" name="email" type="email" value="${fieldValue(profile.email)}" autocomplete="email" required maxlength="254"></div>
      <div class="field"><label for="checkout-phone">Phone</label><input id="checkout-phone" name="phone" type="tel" value="${fieldValue(profile.phone || address.phone)}" autocomplete="tel" required minlength="10" maxlength="20"></div>
    </div>
    <div class="field"><label for="checkout-line1">Address</label><input id="checkout-line1" name="line1" value="${fieldValue(address.line1)}" autocomplete="address-line1" required minlength="3" maxlength="160"></div>
    <div class="field"><label for="checkout-line2">Apartment, suite or landmark <span>optional</span></label><input id="checkout-line2" name="line2" value="${fieldValue(address.line2)}" autocomplete="address-line2" maxlength="160"></div>
    <div class="checkout-fields checkout-fields-three">
      <div class="field"><label for="checkout-city">City</label><input id="checkout-city" name="city" value="${fieldValue(address.city)}" autocomplete="address-level2" required maxlength="80"></div>
      <div class="field"><label for="checkout-state">State</label><input id="checkout-state" name="state" value="${fieldValue(address.state)}" autocomplete="address-level1" required maxlength="80"></div>
      <div class="field"><label for="checkout-postal">PIN code</label><input id="checkout-postal" name="postalCode" value="${fieldValue(address.postalCode)}" inputmode="numeric" autocomplete="postal-code" required pattern="[1-9][0-9]{5}" maxlength="6"></div>
    </div>
    <div class="checkout-fields">
      <div class="field"><label for="checkout-coupon">Coupon <span>optional</span></label><input id="checkout-coupon" name="couponCode" maxlength="40" placeholder="WELCOME10"></div>
      <div class="field"><label for="checkout-payment">Payment</label><select id="checkout-payment" name="paymentMethod">${paymentOptions}</select></div>
    </div>
    ${accountState ? '<label class="checkout-save"><input name="saveAddress" type="checkbox"> Save this address to my account</label>' : ''}
    <div class="field"><label for="checkout-notes">Order notes <span>optional</span></label><textarea id="checkout-notes" name="customerNotes" maxlength="500" rows="2"></textarea></div>
    <p class="checkout-error" data-checkout-error role="alert" hidden></p>
    <button class="button checkout-submit" type="submit">Place order</button>
    <p class="checkout-terms">By placing your order, you confirm the delivery details above.</p>
  </form>`;
};

const openCheckout = () => {
  if (!cartState?.items.length) return;
  closeCart();
  document.querySelector('[data-checkout-content]').innerHTML = checkoutForm();
  document.body.classList.add('checkout-open');
  document.querySelector('.checkout-panel').setAttribute('aria-hidden', 'false');
  document.querySelector('#checkout-name').focus();
};

const closeCheckout = () => {
  document.body.classList.remove('checkout-open');
  document.querySelector('.checkout-panel').setAttribute('aria-hidden', 'true');
};

const accountAuthMarkup = (mode = 'login') => mode === 'register' ? `
  <form class="account-form" data-register-form>
    <p>Create an account to save delivery details and follow your Buva orders.</p>
    <div class="field"><label>Full name</label><input name="fullName" autocomplete="name" required minlength="2" maxlength="100"></div>
    <div class="field"><label>Email</label><input name="email" type="email" autocomplete="email" required maxlength="254"></div>
    <div class="field"><label>Phone</label><input name="phone" type="tel" autocomplete="tel" required minlength="10" maxlength="20"></div>
    <div class="field"><label>Password</label><input name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="128"></div>
    <p class="checkout-error" data-account-error role="alert" hidden></p>
    <button class="button" type="submit">Create account</button>
    <button class="account-switch" type="button" data-account-mode="login">Already a member? Sign in</button>
  </form>` : `
  <form class="account-form" data-login-form>
    <p>Sign in to view orders and reuse saved delivery details.</p>
    <div class="field"><label>Email or phone</label><input name="identifier" autocomplete="username" required maxlength="254"></div>
    <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="128"></div>
    <p class="checkout-error" data-account-error role="alert" hidden></p>
    <button class="button" type="submit">Sign in</button>
    <button class="account-switch" type="button" data-account-mode="register">New to Buva? Create account</button>
  </form>`;

const renderAccount = (mode = 'login') => {
  const root = document.querySelector('[data-account-content]');
  if (!accountState) {
    root.innerHTML = accountAuthMarkup(mode);
    return;
  }
  const orders = accountState.orders.length ? accountState.orders.map((order) => `
    <article class="account-order">
      <div><strong>${escapeHtml(order.orderNumber)}</strong><span>${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(order.createdAt))}</span></div>
      <div><strong>${formatPrice(order.totalPaise)}</strong><span>${escapeHtml(order.status)} · ${escapeHtml(order.paymentStatus)}</span></div>
    </article>`).join('') : '<p>No orders yet. Your fragrance wardrobe awaits.</p>';
  const addresses = accountState.addresses.length ? accountState.addresses.map((address) => `
    <p class="account-address"><strong>${escapeHtml(address.label)}</strong><br>${escapeHtml(address.line1)}${address.line2 ? `<br>${escapeHtml(address.line2)}` : ''}<br>${escapeHtml(address.city)}, ${escapeHtml(address.state)} ${escapeHtml(address.postalCode)}</p>`).join('') : '<p>No saved delivery addresses.</p>';
  root.innerHTML = `
    <div class="account-profile"><p class="eyebrow">Welcome back</p><h3>${escapeHtml(accountState.customer.fullName)}</h3><p>${escapeHtml(accountState.customer.email)} · ${escapeHtml(accountState.customer.phone)}</p><button class="account-switch" type="button" data-account-logout>Sign out</button></div>
    <section class="account-section"><h4>Recent orders</h4>${orders}</section>
    <section class="account-section"><h4>Saved addresses</h4>${addresses}</section>`;
};

const loadAccount = async () => {
  if (!customerToken) return;
  try {
    accountState = await customerRequest('/api/account');
  } catch (_error) {
    customerToken = '';
    accountState = null;
    sessionStorage.removeItem(accountStorageKey);
  }
};

const openAccount = () => {
  renderAccount();
  document.body.classList.add('account-open');
  document.querySelector('.account-panel').setAttribute('aria-hidden', 'false');
  document.querySelector('.account-panel input, .account-panel button')?.focus();
};

const closeAccount = () => {
  document.body.classList.remove('account-open');
  document.querySelector('.account-panel').setAttribute('aria-hidden', 'true');
};

const loadRazorpayScript = () => new Promise((resolve, reject) => {
  if (window.Razorpay) return resolve();
  const existing = document.querySelector('script[data-razorpay-checkout]');
  if (existing) {
    existing.addEventListener('load', resolve, { once: true });
    existing.addEventListener('error', () => reject(new Error('Unable to load Razorpay Checkout')), { once: true });
    return;
  }
  const script = document.createElement('script');
  script.src = 'https://checkout.razorpay.com/v1/checkout.js';
  script.dataset.razorpayCheckout = 'true';
  script.onload = resolve;
  script.onerror = () => reject(new Error('Unable to load Razorpay Checkout'));
  document.head.appendChild(script);
});

const completeRazorpayPayment = async ({ payment, order }) => {
  await loadRazorpayScript();
  return new Promise((resolve, reject) => {
    let completed = false;
    const checkout = new window.Razorpay({
      key: payment.keyId,
      amount: payment.amountPaise,
      currency: payment.currency,
      name: 'Buva Chennai',
      description: `Order ${order.orderNumber}`,
      order_id: payment.providerOrderId,
      prefill: { name: order.customerName, email: order.email, contact: order.phone },
      theme: { color: '#b89258' },
      handler: async (result) => {
        completed = true;
        try {
          const verified = await customerRequest('/api/payments/razorpay/verify', {
            method: 'POST',
            body: JSON.stringify({
              orderId: order.id,
              razorpayPaymentId: result.razorpay_payment_id,
              razorpayOrderId: result.razorpay_order_id,
              razorpaySignature: result.razorpay_signature
            })
          });
          resolve(verified.order);
        } catch (error) { reject(error); }
      },
      modal: { ondismiss: () => { if (!completed) reject(new Error('Payment window closed. You can retry this payment.')); } }
    });
    checkout.on('payment.failed', (result) => reject(new Error(result.error?.description || 'Razorpay payment failed')));
    checkout.open();
  });
};

const showOrderConfirmation = (order) => {
  document.querySelector('[data-checkout-content]').innerHTML = `
    <div class="order-confirmation">
      <span class="order-check" aria-hidden="true">✓</span>
      <p class="eyebrow">Order confirmed</p>
      <h2>Thank you, ${escapeHtml(order.customerName)}.</h2>
      <p>Your order <strong>${escapeHtml(order.orderNumber)}</strong> has been placed. We sent the details to ${escapeHtml(order.email)}.</p>
      <div class="order-total"><span>Total · ${order.paymentMethod === 'razorpay' ? 'paid online' : 'cash on delivery'}</span><strong>${formatPrice(order.totalPaise)}</strong></div>
      <p class="order-address">Delivering to ${escapeHtml(order.shippingAddress.city)}, ${escapeHtml(order.shippingAddress.state)} · ${escapeHtml(order.shippingAddress.postalCode)}</p>
      <button class="button" type="button" data-checkout-close>Continue shopping</button>
    </div>`;
  document.querySelector('[data-checkout-close].button')?.focus();
};

const changeCartItem = async (action, productId) => {
  const item = cartState?.items.find((candidate) => String(candidate.productId) === productId);
  if (!item || !cartState) return;
  if (action === 'remove' || (action === 'decrease' && item.quantity === 1)) {
    const { cart } = await apiRequest(`/api/carts/${cartState.sessionToken}/items/${productId}`, { method: 'DELETE' });
    renderCart(cart);
    return;
  }
  const quantity = item.quantity + (action === 'increase' ? 1 : -1);
  const { cart } = await apiRequest(`/api/carts/${cartState.sessionToken}/items/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify({ quantity })
  });
  renderCart(cart);
};

document.addEventListener('click', async (event) => {
  const accountLink = event.target.closest('.account-link');
  if (accountLink) {
    event.preventDefault();
    links?.classList.remove('open');
    document.body.classList.remove('menu-open');
    toggle?.setAttribute('aria-expanded', 'false');
    if (toggle) toggle.textContent = 'Menu';
    openAccount();
    return;
  }
  if (event.target.closest('[data-account-close]')) {
    closeAccount();
    return;
  }
  const accountMode = event.target.closest('[data-account-mode]');
  if (accountMode) {
    renderAccount(accountMode.dataset.accountMode);
    return;
  }
  if (event.target.closest('[data-account-logout]')) {
    try { await customerRequest('/api/auth/logout', { method: 'POST', body: '{}' }); } catch (_error) { /* Clear the local session either way. */ }
    customerToken = '';
    accountState = null;
    sessionStorage.removeItem(accountStorageKey);
    renderAccount();
    showToast('Signed out');
    return;
  }
  if (event.target.closest('[data-checkout-close]')) {
    closeCheckout();
    return;
  }
  if (event.target.closest('[data-checkout-open]')) {
    openCheckout();
    return;
  }

  const cartLink = event.target.closest('.cart-link');
  if (cartLink) {
    event.preventDefault();
    openCart();
    return;
  }
  if (event.target.closest('[data-cart-close]')) {
    closeCart();
    return;
  }

  const button = event.target.closest('.quick-add');
  if (button && !button.disabled) {
    if (!button.dataset.productId) {
      showToast('The live catalogue is still loading. Please try again.');
      return;
    }
    button.disabled = true;
    try {
      const cart = await ensureCart();
      const result = await apiRequest(`/api/carts/${cart.sessionToken}/items`, {
        method: 'POST',
        body: JSON.stringify({ productId: button.dataset.productId, quantity: 1 })
      });
      renderCart(result.cart);
      showToast(`${button.dataset.product || 'Fragrance'} added to your Buva bag`);
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
    return;
  }

  const cartAction = event.target.closest('[data-cart-action]');
  if (cartAction && !cartAction.disabled) {
    cartAction.disabled = true;
    try {
      await changeCartItem(cartAction.dataset.cartAction, cartAction.dataset.productId);
    } catch (error) {
      showToast(error.message);
      cartAction.disabled = false;
    }
    return;
  }

  const chip = event.target.closest('.filter-chip');
  if (chip) {
    document.querySelectorAll('.filter-chip').forEach((item) => item.classList.remove('active'));
    chip.classList.add('active');
    const filter = chip.dataset.filter;
    document.querySelectorAll('.product-card[data-family]').forEach((card) => {
      card.hidden = filter !== 'all' && card.dataset.family !== filter;
    });
    updateProductCount();
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-checkout-form]');
  if (!form) return;
  event.preventDefault();
  if (!cartState?.sessionToken) return;

  const submit = form.querySelector('[type="submit"]');
  const errorRoot = form.querySelector('[data-checkout-error]');
  submit.disabled = true;
  submit.textContent = 'Placing order…';
  errorRoot.hidden = true;

  const fields = Object.fromEntries(new FormData(form));
  const payload = {
    customerName: fields.customerName,
    email: fields.email,
    phone: fields.phone,
    shippingAddress: {
      recipientName: fields.customerName,
      line1: fields.line1,
      line2: fields.line2,
      city: fields.city,
      state: fields.state,
      postalCode: fields.postalCode,
      countryCode: 'IN'
    },
    couponCode: fields.couponCode,
    paymentMethod: fields.paymentMethod,
    customerNotes: fields.customerNotes,
    saveAddress: fields.saveAddress === 'on'
  };

  try {
    const checkoutResult = pendingPayment || await customerRequest(`/api/carts/${cartState.sessionToken}/checkout`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    let order = checkoutResult.order;
    if (checkoutResult.payment) {
      pendingPayment = checkoutResult;
      submit.textContent = 'Opening Razorpay…';
      const verifiedOrder = await completeRazorpayPayment(checkoutResult);
      order = { ...order, ...verifiedOrder, shippingAddress: order.shippingAddress };
      pendingPayment = null;
    }
    storeCartToken(null);
    renderCart(null);
    showOrderConfirmation(order);
    if (customerToken) await loadAccount();
  } catch (error) {
    errorRoot.textContent = error.message;
    errorRoot.hidden = false;
    submit.disabled = false;
    submit.textContent = pendingPayment ? 'Retry Razorpay payment' : 'Place order';
  }
});

document.addEventListener('submit', async (event) => {
  const loginForm = event.target.closest('[data-login-form]');
  const registerForm = event.target.closest('[data-register-form]');
  const form = loginForm || registerForm;
  if (!form) return;
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(form));
  const errorRoot = form.querySelector('[data-account-error]');
  const submit = form.querySelector('[type="submit"]');
  errorRoot.hidden = true;
  submit.disabled = true;
  try {
    const result = await apiRequest(registerForm ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(fields)
    });
    customerToken = result.session.token;
    sessionStorage.setItem(accountStorageKey, customerToken);
    await loadAccount();
    renderAccount();
    showToast(registerForm ? 'Your Buva account is ready' : 'Welcome back');
  } catch (error) {
    errorRoot.textContent = error.message;
    errorRoot.hidden = false;
    submit.disabled = false;
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (document.body.classList.contains('checkout-open')) closeCheckout();
  else if (document.body.classList.contains('account-open')) closeAccount();
  else if (document.body.classList.contains('cart-open')) closeCart();
});

Promise.all([
  restoreCart(),
  loadAccount(),
  apiRequest('/api/payments/config').then((config) => { paymentConfig = config; }).catch(() => {})
]);

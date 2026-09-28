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

document.querySelector('.contact-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  button.textContent = 'Sending…';
  try {
    const fields = Object.fromEntries(new FormData(form));
    await apiRequest('/api/support', { method: 'POST', body: JSON.stringify({ ...fields, topic: fields.interest }) });
    form.reset();
    button.textContent = 'Thank you — we will be in touch';
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Send to Buva';
    showToast(error.message);
  }
});

document.querySelector('[data-newsletter-form]')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  const message = form.querySelector('[data-newsletter-message]');
  button.disabled = true;
  message.textContent = 'Subscribing…';
  try {
    await apiRequest('/api/newsletter', { method: 'POST', body: JSON.stringify({ email: new FormData(form).get('email') }) });
    form.reset();
    message.textContent = 'You are on the list.';
  } catch (error) {
    message.textContent = error.message;
  } finally { button.disabled = false; }
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
window.addEventListener('buva:notification', (event) => {
  showToast(event.detail?.body || event.detail?.title || 'You have a new Buva update');
});

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

  const rating = product.reviewCount ? `<span class="product-rating" aria-label="${product.averageRating} out of 5 stars">★ ${product.averageRating} (${product.reviewCount})</span>` : '<span class="product-rating">Not yet rated</span>';
  return `<article class="product-card reveal" data-product-id="${escapeHtml(product.id)}" data-family="${escapeHtml(product.scentFamily)}" data-search="${escapeHtml(`${product.name} ${product.shortDescription || ''} ${product.scentFamily} ${product.concentration}`.toLowerCase())}" data-price="${product.pricePaise}">
    <div class="product-image-wrap">
      ${badge}
      <img class="product-image" src="${escapeHtml(product.imageUrl || 'perfume.jpg')}" alt="${escapeHtml(product.imageAlt || `${product.name} ${product.concentration} by BUVA Chennai`)}">
      <button class="wishlist-button" type="button" data-wishlist="${escapeHtml(product.id)}" aria-label="Save ${escapeHtml(product.name)} to wishlist">♡</button>
      <button class="quick-add" data-product-id="${escapeHtml(product.id)}" data-product="${escapeHtml(product.name)}"${soldOut ? ' disabled' : ''}>${actionLabel}</button>
    </div>
    <div class="product-info">
      <p class="product-meta">${escapeHtml(product.shortDescription || `${product.scentFamily} · ${product.concentration} · ${product.sizeMl} ml`)}</p>
      <h3>${escapeHtml(product.name)}</h3>
      <span class="price">${formatPrice(product.pricePaise)}${comparePrice}</span>${rating}<a class="review-link" href="product.html?slug=${encodeURIComponent(product.slug)}">Explore ${escapeHtml(product.name)}</a>${product.reviewCount ? `<button class="review-link" type="button" data-review-slug="${escapeHtml(product.slug)}">Read reviews</button>` : ''}
    </div>
  </article>`;
};

const applyCatalogControls = () => {
  const catalog = document.querySelector('[data-catalog="all"]');
  if (!catalog) return;
  const term = (document.querySelector('[data-product-search]')?.value || '').trim().toLowerCase();
  const family = document.querySelector('.filter-chip.active')?.dataset.filter || 'all';
  const minimumValue = document.querySelector('[data-product-min-price]')?.value || '';
  const maximumValue = document.querySelector('[data-product-max-price]')?.value || '';
  const minimumPaise = minimumValue === '' ? null : Math.max(0, Number(minimumValue)) * 100;
  const maximumPaise = maximumValue === '' ? null : Math.max(0, Number(maximumValue)) * 100;
  const cards = [...catalog.querySelectorAll('.product-card')];
  cards.forEach((card) => {
    const price = Number(card.dataset.price);
    card.hidden = (family !== 'all' && card.dataset.family !== family)
      || !card.dataset.search.includes(term)
      || (minimumPaise !== null && price < minimumPaise)
      || (maximumPaise !== null && price > maximumPaise);
  });
  const sort = document.querySelector('[data-product-sort]')?.value || 'featured';
  cards.sort((a, b) => sort === 'price_asc' ? Number(a.dataset.price) - Number(b.dataset.price)
    : sort === 'price_desc' ? Number(b.dataset.price) - Number(a.dataset.price) : 0).forEach((card) => catalog.appendChild(card));
  updateProductCount();
};

const catalogHead = document.querySelector('[data-catalog="all"]')?.closest('.section')?.querySelector('.catalog-head');
if (catalogHead && !document.querySelector('[data-catalog-tools]')) {
  const tools = document.createElement('div');
  tools.className = 'catalog-tools';
  tools.dataset.catalogTools = '';
  tools.innerHTML = '<label>Search fragrances<input type="search" data-product-search placeholder="Jasmine, fresh, oud…"></label><label>Minimum price ₹<input type="number" data-product-min-price min="0" step="1" inputmode="numeric" placeholder="No minimum"></label><label>Maximum price ₹<input type="number" data-product-max-price min="0" step="1" inputmode="numeric" placeholder="No maximum"></label><label>Sort<select data-product-sort><option value="featured">Featured</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option></select></label>';
  catalogHead.after(tools);
  tools.addEventListener('input', applyCatalogControls);
  tools.addEventListener('change', applyCatalogControls);
}

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
    if (catalog.dataset.catalog === 'all') {
      const sets = products.filter((product) => product.scentFamily === 'sets');
      const feature = document.querySelector('[data-sets-feature]');
      if (feature) {
        feature.querySelector('[data-sets-catalog]').innerHTML = sets.map(productCard).join('');
        feature.hidden = sets.length === 0;
        if (sets.length) observeReveals(feature);
      }
    }
    observeReveals(catalog);
    updateProductCount();
    applyCatalogControls();
  } catch (error) {
    console.warn('Live catalogue unavailable; showing the built-in catalogue.', error);
  }
};

document.querySelectorAll('[data-catalog]').forEach(loadCatalog);

const renderRecommendations = async () => {
  const catalog = document.querySelector('[data-catalog="all"]');
  if (!catalog) return;
  let section = document.querySelector('[data-recommendations]');
  if (!customerToken) { section?.remove(); return; }
  try {
    const { products } = await customerRequest('/api/account/recommendations');
    if (!products.length) { section?.remove(); return; }
    if (!section) {
      section = document.createElement('section');
      section.className = 'section';
      section.dataset.recommendations = '';
      catalog.closest('.section').after(section);
    }
    section.innerHTML = `<div class="shell"><div class="catalog-head"><div><p class="eyebrow">Picked for you</p><h2>Explore <span class="gold">next.</span></h2></div></div><div class="catalog-grid">${products.map(productCard).join('')}</div></div>`;
    observeReveals(section);
  } catch (error) { console.warn('Recommendations unavailable', error); }
};

const cartStorageKey = 'buvaCartToken';
const accountStorageKey = 'buvaCustomerToken';
let cartState = null;
let accountState = null;
let customerToken = sessionStorage.getItem(accountStorageKey) || '';
let accountTab = 'orders';
const notifyAccountChanged = () => window.dispatchEvent(new Event('buva:account-changed'));
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

const reviewsShell = document.createElement('div');
reviewsShell.className = 'reviews-shell';
reviewsShell.innerHTML = '<button class="reviews-overlay" type="button" data-reviews-close aria-label="Close reviews"></button><section class="reviews-panel" role="dialog" aria-modal="true" aria-labelledby="reviews-title"><div class="checkout-head"><h2 id="reviews-title">Customer reviews</h2><button class="cart-close" type="button" data-reviews-close>×</button></div><div class="reviews-content"></div></section>';
document.body.appendChild(reviewsShell);

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
    <button class="button google-login-button" type="button" data-google-login>Continue with Google</button>
    <button class="account-switch" type="button" data-account-mode="register">New to Buva? Create account</button>
  </form>`;

const invoicePrice = (paise) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 2
}).format(Number(paise || 0) / 100);
const invoiceDate = (value) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(value));
const renderAccountInvoice = (invoice) => {
  const address = invoice.billingAddress || {};
  const addressLines = [address.recipientName, address.line1, address.line2,
    [address.city, address.state, address.postalCode].filter(Boolean).join(', ')].filter(Boolean);
  const tax = Number(invoice.igstPaise) > 0
    ? `<div><span>IGST</span><strong>${invoicePrice(invoice.igstPaise)}</strong></div>`
    : `<div><span>CGST</span><strong>${invoicePrice(invoice.cgstPaise)}</strong></div><div><span>SGST</span><strong>${invoicePrice(invoice.sgstPaise)}</strong></div>`;
  return `<div class="account-invoice" aria-label="Invoice ${escapeHtml(invoice.invoiceNumber)}">
    <div class="account-invoice-head"><div><small>Tax invoice</small><h5>${escapeHtml(invoice.invoiceNumber)}</h5><p>Issued ${invoiceDate(invoice.issuedAt)}</p></div><a href="invoice.html?number=${encodeURIComponent(invoice.invoiceNumber)}&print=1" target="_blank" rel="noopener">Print / save PDF</a></div>
    <div class="account-invoice-meta"><div><small>Bill to</small><strong>${escapeHtml(invoice.customerName)}</strong><p>${addressLines.map(escapeHtml).join('<br>')}</p></div><div><small>Order</small><strong>${escapeHtml(invoice.orderNumber)}</strong><p>${escapeHtml(invoice.paymentStatus)} · ${escapeHtml(invoice.paymentMethod)}</p></div></div>
    <div class="account-invoice-items">${(invoice.items || []).map((item) => `<div><span>${escapeHtml(item.name)} × ${Number(item.quantity)}</span><strong>${invoicePrice(item.lineTotalPaise)}</strong></div>`).join('')}</div>
    <div class="account-invoice-totals"><div><span>Subtotal</span><strong>${invoicePrice(invoice.subtotalPaise)}</strong></div>${Number(invoice.discountPaise) ? `<div><span>Discount</span><strong>−${invoicePrice(invoice.discountPaise)}</strong></div>` : ''}<div><span>Shipping</span><strong>${invoicePrice(invoice.shippingPaise)}</strong></div>${tax}<div class="account-invoice-total"><span>Total</span><strong>${invoicePrice(invoice.totalPaise)}</strong></div></div>
  </div>`;
};

const renderAccount = (mode = 'login') => {
  const root = document.querySelector('[data-account-content]');
  if (!accountState) {
    root.innerHTML = accountAuthMarkup(mode);
    return;
  }
  const orders = accountState.orders.length ? accountState.orders.map((order) => {
    const canRequestReturn = order.status === 'delivered'
      && !['pending', 'approved'].includes(order.returnRequestStatus);

    const returnStatus = order.returnRequestStatus
      ? `
        <div class="account-return-status">
          <span>Return request · ${escapeHtml(order.returnRequestStatus)}</span>
          ${order.returnAdminNote ? `<small>${escapeHtml(order.returnAdminNote)}</small>` : ''}
        </div>`
      : '';

    const returnAction = canRequestReturn
      ? `
        <div class="account-return-action">
          <button
            class="account-switch"
            type="button"
            data-return-order="${escapeHtml(order.id)}"
          >${order.returnRequestStatus === 'rejected' ? 'Request Return Again' : 'Request Return'}</button>
        </div>`
      : '';

    const tracking = order.trackingNumber ? `<p class="account-tracking"><strong>${escapeHtml(order.courierName || 'Courier')}</strong> · ${escapeHtml(order.trackingNumber)}${order.trackingUrl ? ` · <a href="${escapeHtml(order.trackingUrl)}" target="_blank" rel="noopener">Track parcel</a>` : ''}</p>` : '';
    const invoiceAction = order.invoiceNumber
      ? `<button class="account-switch" type="button" data-order-invoice="${escapeHtml(order.invoiceNumber)}" aria-expanded="false">View invoice</button>`
      : '';
    const reviewActions = order.status === 'delivered' ? (order.items || []).map((item) => item.reviewId
      ? `<span class="review-complete">${item.rating}★ · ${escapeHtml(item.reviewStatus)}</span>`
      : `<button class="account-switch" type="button" data-review-order="${escapeHtml(order.id)}" data-review-product="${escapeHtml(item.productId)}" data-review-name="${escapeHtml(item.name)}">Review ${escapeHtml(item.name)}</button>`).join('') : '';

    return `
      <article class="account-order">
        <div>
          <strong>${escapeHtml(order.orderNumber)}</strong>
          <span>${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(order.createdAt))}</span>
        </div>
        <div>
          <strong>${formatPrice(order.totalPaise)}</strong>
          <span>${escapeHtml(order.status)} · ${escapeHtml(order.paymentStatus)}</span>
          ${tracking}
          ${invoiceAction}
          <div class="account-review-actions">${reviewActions}</div>
          ${returnStatus}
          ${returnAction}
          <div class="account-return-form-slot" data-return-slot="${escapeHtml(order.id)}" hidden></div>
        </div>
        ${order.invoiceNumber ? `<div class="account-invoice-slot" data-invoice-slot="${escapeHtml(order.invoiceNumber)}" hidden></div>` : ''}
      </article>`;
  }).join('') : '<p>No orders yet. Your fragrance wardrobe awaits.</p>';
  const returnForm = (orderId) => `
    <form class="account-return-form" data-return-form="${escapeHtml(orderId)}">
      <h5>Request a return</h5>
      <div class="field">
        <label>Reason</label>
        <input
          name="reason"
          type="text"
          required
          minlength="3"
          maxlength="200"
          placeholder="Why would you like to return this order?"
        >
      </div>
      <div class="field">
        <label>Additional note <span>(optional)</span></label>
        <textarea
          name="customerNote"
          maxlength="1000"
          rows="3"
          placeholder="Add any additional details"
        ></textarea>
      </div>
      <p class="checkout-error" data-return-error role="alert" hidden></p>
      <div class="account-return-buttons">
        <button class="button" type="submit">Submit Return Request</button>
        <button class="account-switch" type="button" data-return-cancel>Cancel</button>
      </div>
    </form>`;

  const addresses = accountState.addresses.length ? accountState.addresses.map((address) => `
    <div class="account-address"><strong>${escapeHtml(address.label)}${address.isDefault ? ' · Default' : ''}</strong><br>${escapeHtml(address.line1)}${address.line2 ? `<br>${escapeHtml(address.line2)}` : ''}<br>${escapeHtml(address.city)}, ${escapeHtml(address.state)} ${escapeHtml(address.postalCode)}<div><button class="account-switch" type="button" data-address-edit="${escapeHtml(address.id)}">Edit</button> <button class="account-switch" type="button" data-address-delete="${escapeHtml(address.id)}">Delete</button></div></div>`).join('') : '<p>No saved delivery addresses.</p>';
  const wishlist = accountState.wishlist?.length ? accountState.wishlist.map((item) => `<div class="wishlist-item"><img src="${escapeHtml(item.imageUrl || 'perfume.jpg')}" alt=""><span>${escapeHtml(item.name)} · ${formatPrice(item.pricePaise)}</span><button class="account-switch" type="button" data-wishlist-remove="${item.productId}">Remove</button></div>`).join('') : '<p>No saved fragrances yet.</p>';
  const recent = accountState.recentlyViewed?.length ? accountState.recentlyViewed.map((item) => `<div class="wishlist-item"><img src="${escapeHtml(item.imageUrl || 'perfume.jpg')}" alt=""><span>${escapeHtml(item.name)} · ${formatPrice(item.pricePaise)}</span><button class="account-switch" type="button" data-view-slug="${escapeHtml(item.slug)}" data-view-product-id="${item.productId}">View</button></div>`).join('') : '<p>Products you view will appear here.</p>';
  const tickets = accountState.supportTickets?.length ? accountState.supportTickets.map((ticket) => `<article class="account-order"><div><strong>${escapeHtml(ticket.topic)}</strong><span>${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(ticket.createdAt))}</span></div><div><span>${escapeHtml(ticket.status)}</span><p>${escapeHtml(ticket.message)}</p>${ticket.customerReply ? `<p><strong>Buva reply:</strong> ${escapeHtml(ticket.customerReply)}</p>` : ''}</div></article>`).join('') : '<p>No support requests yet.</p>';
  const preferences = accountState.notificationPreferences || { orderUpdates: true, marketing: false };
  root.innerHTML = `
    <div class="account-profile"><p class="eyebrow">Welcome back</p><h3>${escapeHtml(accountState.customer.fullName)}</h3><p>${escapeHtml(accountState.customer.email)} · ${escapeHtml(accountState.customer.phone)}</p><button class="account-switch" type="button" data-profile-edit>Edit profile</button> <button class="account-switch" type="button" data-account-logout>Sign out</button></div>
    <div class="account-tabs" role="tablist" aria-label="Account sections">${[['orders', 'Orders'], ['wishlist', 'Wishlist'], ['recent', 'Recently viewed'], ['addresses', 'Addresses'], ['support', 'Support'], ['notifications', 'Notifications']].map(([id, label]) => `<button type="button" role="tab" id="account-tab-${id}" aria-controls="account-panel-${id}" aria-selected="${accountTab === id}" data-account-tab="${id}">${label}</button>`).join('')}</div>
    <section class="account-section" id="account-panel-orders" role="tabpanel" aria-labelledby="account-tab-orders" ${accountTab === 'orders' ? '' : 'hidden'}><h4>Orders</h4>${orders}</section>
    <section class="account-section" id="account-panel-wishlist" role="tabpanel" aria-labelledby="account-tab-wishlist" ${accountTab === 'wishlist' ? '' : 'hidden'}><h4>Wishlist</h4>${wishlist}</section>
    <section class="account-section" id="account-panel-recent" role="tabpanel" aria-labelledby="account-tab-recent" ${accountTab === 'recent' ? '' : 'hidden'}><h4>Recently viewed</h4>${recent}</section>
    <section class="account-section" id="account-panel-addresses" role="tabpanel" aria-labelledby="account-tab-addresses" ${accountTab === 'addresses' ? '' : 'hidden'}><h4>Saved addresses</h4>${addresses}<button class="account-switch" type="button" data-address-add>Add address</button></section>
    <section class="account-section" id="account-panel-support" role="tabpanel" aria-labelledby="account-tab-support" ${accountTab === 'support' ? '' : 'hidden'}><h4>Your support requests</h4>${tickets}<form class="account-form" data-support-form><h4>Ask Buva</h4><div class="field"><label>Topic<input name="topic" required minlength="2" maxlength="100"></label></div><div class="field"><label>Message<textarea name="message" required minlength="10" maxlength="4000" rows="4"></textarea></label></div><p class="checkout-error" data-editor-error hidden></p><button class="button" type="submit">Send request</button></form></section>
    <section class="account-section" id="account-panel-notifications" role="tabpanel" aria-labelledby="account-tab-notifications" ${accountTab === 'notifications' ? '' : 'hidden'}><h4>Notifications</h4><form data-notification-form><label><input type="checkbox" name="orderUpdates" ${preferences.orderUpdates ? 'checked' : ''}> Order updates</label><label><input type="checkbox" name="marketing" ${preferences.marketing ? 'checked' : ''}> Product news and offers</label><button class="account-switch" type="submit">Save preferences</button> <button class="account-switch" type="button" data-enable-notifications>Enable browser alerts</button></form></section>
    <div data-account-editor></div>`;
};

const addressFormMarkup = (address = {}) => `<form class="account-form account-editor" data-address-form="${escapeHtml(address.id || '')}"><h4>${address.id ? 'Edit' : 'Add'} address</h4>
  <div class="field"><label>Label<input name="label" value="${escapeHtml(address.label || 'Home')}" required maxlength="40"></label></div>
  <div class="field"><label>Recipient<input name="recipientName" value="${escapeHtml(address.recipientName || accountState.customer.fullName)}" required></label></div>
  <div class="field"><label>Phone<input name="phone" value="${escapeHtml(address.phone || accountState.customer.phone)}" required></label></div>
  <div class="field"><label>Address<input name="line1" value="${escapeHtml(address.line1 || '')}" required></label></div>
  <div class="field"><label>Apartment / landmark<input name="line2" value="${escapeHtml(address.line2 || '')}"></label></div>
  <div class="field"><label>City<input name="city" value="${escapeHtml(address.city || '')}" required></label></div>
  <div class="field"><label>State<input name="state" value="${escapeHtml(address.state || '')}" required></label></div>
  <div class="field"><label>PIN code<input name="postalCode" value="${escapeHtml(address.postalCode || '')}" pattern="[1-9][0-9]{5}" required></label></div>
  <label><input type="checkbox" name="isDefault" ${address.isDefault ? 'checked' : ''}> Default address</label><p class="checkout-error" data-editor-error hidden></p>
  <button class="button" type="submit">Save address</button> <button class="account-switch" type="button" data-editor-cancel>Cancel</button></form>`;

const openAccountEditor = (markup) => {
  const editor = document.querySelector('[data-account-editor]');
  if (editor) { editor.innerHTML = markup; editor.querySelector('input, textarea')?.focus(); }
};

const loadAccount = async () => {
  if (!customerToken) { accountState = null; notifyAccountChanged(); await renderRecommendations(); return; }
  try {
    accountState = await customerRequest('/api/account');
    document.querySelectorAll('[data-wishlist]').forEach((button) => {
      const wished = accountState.wishlist?.some((item) => String(item.productId) === button.dataset.wishlist);
      button.classList.toggle('active', Boolean(wished));
      button.textContent = wished ? '♥' : '♡';
    });
  } catch (_error) {
    customerToken = '';
    accountState = null;
    sessionStorage.removeItem(accountStorageKey);
  }
  notifyAccountChanged();
  await renderRecommendations();
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
  if (event.target.closest('[data-reviews-close]')) { document.body.classList.remove('reviews-open'); return; }
  const viewProduct = event.target.closest('[data-view-slug]');
  if (viewProduct) {
    try {
      const { product, reviews } = await apiRequest(`/api/products/${encodeURIComponent(viewProduct.dataset.viewSlug)}`);
      document.querySelector('#reviews-title').textContent = product.name;
      document.querySelector('.reviews-content').innerHTML = `<img class="product-detail-image" src="${escapeHtml(product.imageUrl || 'perfume.jpg')}" alt="${escapeHtml(product.imageAlt || product.name)}"><p class="eyebrow">${escapeHtml(product.categoryName || product.scentFamily)}</p><p>${escapeHtml(product.shortDescription || '')}</p>${product.description ? `<p>${escapeHtml(product.description)}</p>` : ''}<dl class="product-detail-facts"><div><dt>Concentration / type</dt><dd>${escapeHtml(product.concentration)}</dd></div><div><dt>Size</dt><dd>${Number(product.sizeMl)} ml</dd></div><div><dt>Availability</dt><dd>${product.availableQuantity > 0 ? `${Number(product.availableQuantity)} available` : 'Sold out'}</dd></div></dl><p><strong>${formatPrice(product.pricePaise)}</strong>${product.compareAtPricePaise ? ` <s>${formatPrice(product.compareAtPricePaise)}</s>` : ''}</p><button class="button quick-add" type="button" style="position:static;opacity:1;transform:none" data-product-id="${escapeHtml(product.id)}" data-product="${escapeHtml(product.name)}" ${product.availableQuantity > 0 ? '' : 'disabled'}>Add to bag</button><h3>Customer reviews · ${Number(product.averageRating || 0)}★ (${Number(product.reviewCount || 0)})</h3>${reviews.length ? reviews.map((review) => `<article class="public-review"><strong>${Number(review.rating)}★ · ${escapeHtml(review.reviewerName)}</strong><p>${escapeHtml(review.reviewText || '')}</p></article>`).join('') : '<p>No approved reviews yet.</p>'}`;
      document.body.classList.add('reviews-open');
      if (customerToken) {
        await customerRequest('/api/account/view-history', { method: 'POST', body: JSON.stringify({ productId: viewProduct.dataset.viewProductId }) });
        await loadAccount();
        if (document.body.classList.contains('account-open')) renderAccount();
      }
    } catch (error) { showToast(error.message); }
    return;
  }
  const publicReviews = event.target.closest('[data-review-slug]');
  if (publicReviews) {
    try {
      const { product, reviews } = await apiRequest(`/api/products/${encodeURIComponent(publicReviews.dataset.reviewSlug)}`);
      document.querySelector('#reviews-title').textContent = 'Customer reviews';
      document.querySelector('.reviews-content').innerHTML = `<p class="eyebrow">${escapeHtml(product.name)} · ${product.averageRating}★</p>${reviews.length ? reviews.map((review) => `<article class="public-review"><strong>${review.rating}★ · ${escapeHtml(review.reviewerName)}</strong><p>${escapeHtml(review.reviewText || '')}</p><small>${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(review.createdAt))}</small></article>`).join('') : '<p>No approved reviews yet.</p>'}`;
      document.body.classList.add('reviews-open');
    } catch (error) { showToast(error.message); }
    return;
  }
  const accountMode = event.target.closest('[data-account-mode]');
  if (accountMode) {
    renderAccount(accountMode.dataset.accountMode);
    return;
  }
  const tabButton = event.target.closest('[data-account-tab]');
  if (tabButton) {
    accountTab = tabButton.dataset.accountTab;
    document.querySelectorAll('[data-account-tab]').forEach((tab) => tab.setAttribute('aria-selected', String(tab === tabButton)));
    document.querySelectorAll('.account-section[role="tabpanel"]').forEach((panel) => { panel.hidden = panel.id !== `account-panel-${accountTab}`; });
    return;
  }
  const invoiceButton = event.target.closest('[data-order-invoice]');
  if (invoiceButton) {
    const invoiceNumber = invoiceButton.dataset.orderInvoice;
    const slot = invoiceButton.closest('.account-order')?.querySelector('[data-invoice-slot]');
    if (!slot || slot.dataset.invoiceSlot !== invoiceNumber) return;
    if (!slot.hidden) { slot.hidden = true; invoiceButton.setAttribute('aria-expanded', 'false'); return; }
    slot.hidden = false;
    slot.innerHTML = '<p>Loading invoice…</p>';
    invoiceButton.setAttribute('aria-expanded', 'true');
    try {
      const { invoice } = await customerRequest(`/api/invoices/${encodeURIComponent(invoiceNumber)}`);
      const matchingOrder = accountState?.orders.find((order) => order.invoiceNumber === invoiceNumber);
      if (!matchingOrder || invoice.orderNumber !== matchingOrder.orderNumber) throw new Error('Invoice does not match this order.');
      if (slot.isConnected && !slot.hidden) slot.innerHTML = renderAccountInvoice(invoice);
    } catch (error) {
      if (slot.isConnected && !slot.hidden) slot.innerHTML = `<p role="alert">${escapeHtml(error.message || 'Unable to load invoice.')}</p>`;
    }
    return;
  }
  const returnButton = event.target.closest('[data-return-order]');
  if (returnButton) {
    const orderId = returnButton.dataset.returnOrder;
    const slot = document.querySelector(`[data-return-slot="${CSS.escape(orderId)}"]`);

    if (slot) {
      const alreadyOpen = !slot.hidden;
      document.querySelectorAll('[data-return-slot]').forEach((item) => {
        item.hidden = true;
        item.innerHTML = '';
      });

      if (!alreadyOpen) {
        slot.innerHTML = returnForm(orderId);
        slot.hidden = false;
        slot.querySelector('input[name="reason"]')?.focus();
      }
    }

    return;
  }

  if (event.target.closest('[data-return-cancel]')) {
    const form = event.target.closest('[data-return-form]');
    const slot = form?.closest('[data-return-slot]');

    if (slot) {
      slot.hidden = true;
      slot.innerHTML = '';
    }

    return;
  }

  if (event.target.closest('[data-editor-cancel]')) { document.querySelector('[data-account-editor]').innerHTML = ''; return; }
  if (event.target.closest('[data-profile-edit]')) {
    openAccountEditor(`<form class="account-form account-editor" data-profile-form><h4>Edit profile</h4><div class="field"><label>Full name<input name="fullName" value="${escapeHtml(accountState.customer.fullName)}" required></label></div><div class="field"><label>Phone<input name="phone" value="${escapeHtml(accountState.customer.phone)}" required></label></div><p class="checkout-error" data-editor-error hidden></p><button class="button" type="submit">Save profile</button> <button class="account-switch" type="button" data-editor-cancel>Cancel</button></form>`);
    return;
  }
  const addressEdit = event.target.closest('[data-address-edit]');
  if (addressEdit) { openAccountEditor(addressFormMarkup(accountState.addresses.find((item) => item.id === addressEdit.dataset.addressEdit))); return; }
  if (event.target.closest('[data-address-add]')) { openAccountEditor(addressFormMarkup()); return; }
  const addressDelete = event.target.closest('[data-address-delete]');
  if (addressDelete) {
    try { await customerRequest(`/api/account/addresses/${encodeURIComponent(addressDelete.dataset.addressDelete)}`, { method: 'DELETE' }); await loadAccount(); renderAccount(); showToast('Address removed'); } catch (error) { showToast(error.message); }
    return;
  }
  const wishlistRemove = event.target.closest('[data-wishlist-remove]');
  if (wishlistRemove) {
    await customerRequest(`/api/account/wishlist/${wishlistRemove.dataset.wishlistRemove}`, { method: 'DELETE' }); await loadAccount(); renderAccount(); return;
  }
  if (event.target.closest('[data-enable-notifications]')) {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) { showToast('Browser notifications are not available'); return; }
    const requestPermission = window.requestBuvaNotificationPermission || (await import('/js/firebase-messaging.js')).requestNotificationPermission;
    const token = await requestPermission();
    if (token) { await customerRequest('/api/account/notification-devices', { method: 'POST', body: JSON.stringify({ token }) }); showToast('Browser alerts enabled'); }
    return;
  }
  const wishlistButton = event.target.closest('[data-wishlist]');
  if (wishlistButton) {
    if (!customerToken) { openAccount(); showToast('Sign in to save a wishlist'); return; }
    const wished = accountState?.wishlist?.some((item) => String(item.productId) === wishlistButton.dataset.wishlist);
    try {
      await customerRequest(`/api/account/wishlist/${wishlistButton.dataset.wishlist}`, { method: wished ? 'DELETE' : 'POST', ...(wished ? {} : { body: '{}' }) });
      await loadAccount(); showToast(wished ? 'Removed from wishlist' : 'Saved to wishlist');
    } catch (error) { showToast(error.message); }
    return;
  }
  const reviewButton = event.target.closest('[data-review-order]');
  if (reviewButton) {
    openAccountEditor(`<form class="account-form account-editor" data-review-form="${escapeHtml(reviewButton.dataset.reviewOrder)}" data-product-id="${escapeHtml(reviewButton.dataset.reviewProduct)}"><h4>Review ${escapeHtml(reviewButton.dataset.reviewName)}</h4><div class="field"><label>Rating<select name="rating" required><option value="5">5 — Excellent</option><option value="4">4 — Very good</option><option value="3">3 — Good</option><option value="2">2 — Fair</option><option value="1">1 — Poor</option></select></label></div><div class="field"><label>Review<textarea name="reviewText" maxlength="2000"></textarea></label></div><p class="checkout-error" data-editor-error hidden></p><button class="button" type="submit">Submit review</button></form>`);
    return;
  }

  if (event.target.closest('[data-account-logout]')) {
    const deviceToken = localStorage.getItem('buvaNotificationToken');
    if (deviceToken) {
      try {
        await customerRequest('/api/account/notification-devices', { method: 'DELETE', body: JSON.stringify({ token: deviceToken }) });
        const { removeNotificationDevice } = await import('/js/firebase-messaging.js');
        await removeNotificationDevice();
      } catch (error) { console.warn('Could not remove browser alerts on sign out', error); }
    }
    try { await customerRequest('/api/auth/logout', { method: 'POST', body: '{}' }); } catch (_error) { /* Clear the local session either way. */ }
    customerToken = '';
    accountState = null;
    accountTab = 'orders';
    sessionStorage.removeItem(accountStorageKey);
    renderAccount();
    notifyAccountChanged();
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
    applyCatalogControls();
  }
});

document.addEventListener('submit', async (event) => {
  const profileForm = event.target.closest('[data-profile-form]');
  const addressForm = event.target.closest('[data-address-form]');
  const reviewForm = event.target.closest('[data-review-form]');
  const notificationForm = event.target.closest('[data-notification-form]');
  const supportForm = event.target.closest('[data-support-form]');
  const editorForm = profileForm || addressForm || reviewForm || notificationForm || supportForm;
  if (!editorForm) return;
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(editorForm));
  const errorRoot = editorForm.querySelector('[data-editor-error]');
  try {
    if (profileForm) await customerRequest('/api/account/profile', { method: 'PATCH', body: JSON.stringify(fields) });
    if (addressForm) {
      const id = addressForm.dataset.addressForm;
      await customerRequest(id ? `/api/account/addresses/${encodeURIComponent(id)}` : '/api/account/addresses', {
        method: id ? 'PATCH' : 'POST', body: JSON.stringify({ ...fields, countryCode: 'IN', isDefault: fields.isDefault === 'on' })
      });
    }
    if (reviewForm) await customerRequest(`/api/account/orders/${encodeURIComponent(reviewForm.dataset.reviewForm)}/reviews`, {
      method: 'POST', body: JSON.stringify({ productId: Number(reviewForm.dataset.productId), rating: Number(fields.rating), reviewText: fields.reviewText })
    });
    if (notificationForm) await customerRequest('/api/account/notification-preferences', {
      method: 'PUT', body: JSON.stringify({ orderUpdates: fields.orderUpdates === 'on', marketing: fields.marketing === 'on' })
    });
    if (supportForm) await customerRequest('/api/support', { method: 'POST', body: JSON.stringify(fields) });
    await loadAccount(); renderAccount(); showToast(supportForm ? 'Support request sent' : reviewForm ? 'Review submitted for moderation' : 'Account updated');
  } catch (error) {
    if (errorRoot) { errorRoot.textContent = error.message; errorRoot.hidden = false; } else showToast(error.message);
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
    accountTab = 'orders';
    sessionStorage.setItem(accountStorageKey, customerToken);
    await loadAccount();
    renderAccount();
    if (document.body.dataset.invoicePage) closeAccount();
    showToast(registerForm ? 'Your Buva account is ready' : 'Welcome back');
  } catch (error) {
    errorRoot.textContent = error.message;
    errorRoot.hidden = false;
    submit.disabled = false;
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-return-form]');
  if (!form) return;

  event.preventDefault();

  const orderId = form.dataset.returnForm;
  const errorRoot = form.querySelector('[data-return-error]');
  const submitButton = form.querySelector('button[type="submit"]');
  const reason = form.elements.reason.value.trim();
  const customerNote = form.elements.customerNote.value.trim();

  errorRoot.hidden = true;
  errorRoot.textContent = '';
  submitButton.disabled = true;
  submitButton.textContent = 'Submitting…';

  try {
    await customerRequest(`/api/account/orders/${encodeURIComponent(orderId)}/return-request`, {
      method: 'POST',
      body: JSON.stringify({
        reason,
        customerNote
      })
    });

    await loadAccount();
    renderAccount();
    showToast('Return request submitted');
  } catch (error) {
    errorRoot.textContent = error.message;
    errorRoot.hidden = false;
    submitButton.disabled = false;
    submitButton.textContent = 'Submit Return Request';
  }
});

document.addEventListener('click', (event) => {
  const googleButton = event.target.closest('[data-google-login]');
  if (!googleButton) return;

  googleButton.disabled = true;
  googleButton.textContent = 'Connecting to Google…';
  if (document.body.dataset.invoicePage) sessionStorage.setItem('buvaPostLoginReturn', `${location.pathname}${location.search}`);

  window.location.href = '/api/auth/google';
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (document.body.classList.contains('reviews-open')) document.body.classList.remove('reviews-open');
  else if (document.body.classList.contains('checkout-open')) closeCheckout();
  else if (document.body.classList.contains('account-open')) closeAccount();
  else if (document.body.classList.contains('cart-open')) closeCart();
});

const handleGoogleCallback = async () => {
  const params = new URLSearchParams(window.location.search);
  const googleSession = params.get('google_session');

  if (!googleSession) return;

  customerToken = googleSession;
  accountTab = 'orders';
  sessionStorage.setItem(accountStorageKey, customerToken);

  params.delete('google_session');

  const cleanUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
  window.history.replaceState({}, document.title, cleanUrl);

  try {
    await loadAccount();
    renderAccount();
    showToast('Welcome to Buva');
    const returnPath = sessionStorage.getItem('buvaPostLoginReturn');
    sessionStorage.removeItem('buvaPostLoginReturn');
    if (returnPath?.startsWith('/invoice.html')) window.location.replace(returnPath);
  } catch (error) {
    customerToken = '';
    sessionStorage.removeItem(accountStorageKey);
    showToast(error.message || 'Google sign-in failed');
  }
};

handleGoogleCallback().catch((error) => {
  console.error('Google callback handling failed:', error);
});

Promise.all([
  restoreCart(),
  loadAccount().then(() => { if (location.hash === '#account') openAccount(); }),
  apiRequest('/api/payments/config').then((config) => { paymentConfig = config; }).catch(() => {}),
  apiRequest(`/api/banners?placement=${document.querySelector('[data-catalog="all"]') ? 'shop' : 'home'}`).then(({ banners }) => {
    if (!banners.length) return;
    const root = document.createElement('section');
    root.className = 'campaign-banners shell';
    root.setAttribute('aria-label', 'Current offers');
    root.innerHTML = banners.map((banner) => `<a class="campaign-banner" href="${escapeHtml(banner.linkUrl || 'service.html')}"${banner.imageUrl ? ` style="background-image:url('${escapeHtml(banner.imageUrl)}')"` : ''}><strong>${escapeHtml(banner.title)}</strong>${banner.subtitle ? `<span>${escapeHtml(banner.subtitle)}</span>` : ''}</a>`).join('');
    document.querySelector('main')?.prepend(root);
  }).catch(() => {})
]);

const loadStoryProductImages = async () => {
  const storyImages = document.querySelectorAll('[data-story-product]');
  if (!storyImages.length) return;

  try {
    const response = await fetch('/api/products', {
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) return;

    const data = await response.json();
    const products = data.products || [];

    storyImages.forEach((image) => {
      const product = products.find(
        (item) => item.name === image.dataset.storyProduct
      );

      if (product?.imageUrl) {
        if (image.tagName === 'IMG') {
          image.src = product.imageUrl;
          if (product.imageAlt) {
            image.alt = product.imageAlt;
          }
        } else {
          image.style.backgroundImage = `url("${product.imageUrl}")`;
        }
      }
    });
  } catch (error) {
    console.error('Story product images failed to load:', error);
  }
};

loadStoryProductImages();

/* BUVA RAG Chatbot */
const buvaRagAsk = async (question) => {
  const response = await fetch('/api/assistant', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ question })
  });

  if (!response.ok) {
    throw new Error('BUVA assistant is temporarily unavailable.');
  }

  const data = await response.json();
  return data.answer || 'I could not find an answer to that.';
};

window.buvaRagAsk = buvaRagAsk;

const initFallbackAssistant = () => {
if (!document.getElementById('buva-rag-chat')) {
  const assistant = document.createElement('div');
  assistant.className = 'buva-assistant';
  assistant.innerHTML = `<button class="buva-assistant-toggle" type="button">Ask BUVA</button><section class="buva-assistant-panel" hidden aria-label="BUVA shopping assistant"><div class="buva-assistant-head"><strong>BUVA Assistant</strong><button type="button" data-assistant-close>×</button></div><div class="buva-assistant-messages"><div class="buva-assistant-message">Tell me the mood, notes or budget you have in mind.</div></div><form class="buva-assistant-form"><input aria-label="Ask BUVA" maxlength="500" required><button type="submit">Send</button></form></section>`;
  document.body.appendChild(assistant);
  const panel = assistant.querySelector('.buva-assistant-panel');
  const messages = assistant.querySelector('.buva-assistant-messages');
  assistant.querySelector('.buva-assistant-toggle').addEventListener('click', () => { panel.hidden = false; assistant.querySelector('input').focus(); });
  assistant.querySelector('[data-assistant-close]').addEventListener('click', () => { panel.hidden = true; });
  assistant.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault(); const input = event.currentTarget.querySelector('input'); const question = input.value.trim(); if (!question) return;
    messages.insertAdjacentHTML('beforeend', `<div class="buva-assistant-message user">${escapeHtml(question)}</div>`); input.value = '';
    try { const answer = await buvaRagAsk(question); messages.insertAdjacentHTML('beforeend', `<div class="buva-assistant-message">${escapeHtml(answer)}</div>`); }
    catch (error) { messages.insertAdjacentHTML('beforeend', `<div class="buva-assistant-message">${escapeHtml(error.message)}</div>`); }
    messages.scrollTop = messages.scrollHeight;
  });
}
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initFallbackAssistant, { once: true });
else initFallbackAssistant();

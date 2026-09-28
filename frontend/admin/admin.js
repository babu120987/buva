const storageKey = 'buvaAdminKey';
const productDraftKey = 'buvaNewProductDraft';
const loginView = document.querySelector('[data-login-view]');
const dashboard = document.querySelector('[data-dashboard]');
const ordersBody = document.querySelector('[data-orders-body]');
const productsBody = document.querySelector('[data-products-body]');
const detailDrawer = document.querySelector('.detail-drawer');
const detailContent = document.querySelector('[data-detail-content]');
const adminInvoiceShell = document.querySelector('[data-admin-invoice-shell]');
const toast = document.querySelector('[data-toast]');

const customersBody = document.querySelector('[data-customers-body]');

let activeCustomerSearch = '';


let adminKey = sessionStorage.getItem(storageKey) || '';
let activeStatus = '';
let activeSearch = '';
let activeProductState = 'all';
let activeProductSearch = '';
let lowStockOnly = false;
let productCategories = [];
let productsById = new Map();
let toastTimer;

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
}[character]));

const formatPrice = (paise) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0
}).format(Number(paise) / 100);
const formatInvoicePrice = (paise) => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 2
}).format(Number(paise) / 100);

const formatDate = (value) => new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium', timeStyle: 'short'
}).format(new Date(value));

const titleCase = (value) => value.charAt(0).toUpperCase() + value.slice(1);
const statusBadge = (status) => `<span class="status status-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
const productSlug = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const readProductDraft = () => {
  try { return JSON.parse(localStorage.getItem(productDraftKey) || 'null'); } catch (_error) { return null; }
};

const saveProductDraft = (form) => {
  if (form.dataset.productId) return;
  const draft = {};
  Array.from(form.elements).forEach((field) => {
    if (!field.name) return;
    draft[field.name] = field.type === 'checkbox' ? field.checked : field.value;
  });
  try { localStorage.setItem(productDraftKey, JSON.stringify(draft)); } catch (_error) { /* Storage may be unavailable. */ }
};

const clearProductDraft = () => {
  try { localStorage.removeItem(productDraftKey); } catch (_error) { /* Storage may be unavailable. */ }
};

const productFieldLabel = (field) => {
  const label = field?.closest('label');
  const labelText = label ? Array.from(label.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent)
    .join(' ') : '';
  return labelText.replace(/\s*·\s*required\s*/i, '').trim() || field?.name || 'required field';
};

const showProductFormError = (form, message, field = null) => {
  const errorRoot = form.querySelector('[data-product-form-error]');
  errorRoot.textContent = message;
  errorRoot.hidden = false;
  showToast(message);
  if (field) {
    field.focus({ preventScroll: true });
    field.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};

const showToast = (message) => {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
};

const showLogin = (message = '') => {
  adminKey = '';
  sessionStorage.removeItem(storageKey);
  dashboard.hidden = true;
  loginView.hidden = false;
  document.querySelectorAll('[data-admin-view]').forEach((button) => button.classList.toggle('active', button.dataset.adminView === 'orders'));
  document.querySelectorAll('[data-view-panel]').forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== 'orders'; });
  closeDetail();
  const error = document.querySelector('[data-login-error]');
  error.textContent = message;
  error.hidden = !message;
  document.querySelector('#admin-key').focus();
};

const adminRequest = async (path, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Admin-Key': adminKey, ...options.headers }
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    showLogin('The access key is incorrect.');
    throw new Error(payload.error || 'Access denied');
  }
  if (!response.ok) throw new Error(payload.error || `Request failed with status ${response.status}`);
  return payload;
};

const uploadProductImage = async (file) => {
  if (!file) throw new Error('Please choose an image.');

  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch('/api/admin/upload-image', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'X-Admin-Key': adminKey
    },
    body: formData
  });

  const payload = await response.json().catch(() => ({}));

  if (response.status === 401) {
    showLogin('The access key is incorrect.');
    throw new Error(payload.error || 'Access denied');
  }

  if (!response.ok) {
    throw new Error(payload.error || `Image upload failed with status ${response.status}`);
  }

  return payload;
};

const renderSummary = (summary) => {
  Object.entries(summary).forEach(([key, value]) => {
    const root = document.querySelector(`[data-stat="${key}"]`);
    if (!root) return;
    root.textContent = key === 'revenuePaise' ? formatPrice(value) : value;
  });
};

const renderOrders = (orders) => {
  if (!orders.length) {
    ordersBody.innerHTML = '<tr><td colspan="7" class="empty-state">No orders match this view.</td></tr>';
    return;
  }
  ordersBody.innerHTML = orders.map((order) => `
    <tr data-order-id="${escapeHtml(order.id)}" tabindex="0">
      <td><span class="order-number">${escapeHtml(order.orderNumber)}</span></td>
      <td class="customer-cell">${escapeHtml(order.customerName)}<span>${escapeHtml(order.email)}</span></td>
      <td>${escapeHtml(formatDate(order.createdAt))}</td>
      <td>${order.itemCount}</td>
      <td>${formatPrice(order.totalPaise)}</td>
      <td>${statusBadge(order.status)}</td>
      <td><button class="admin-invoice-button" type="button" data-admin-invoice="${escapeHtml(order.id)}">View / Print</button></td>
    </tr>`).join('');
};

const loadOrders = async () => {
  ordersBody.innerHTML = '<tr><td colspan="7" class="empty-state">Loading orders…</td></tr>';
  const params = new URLSearchParams({ limit: '100' });
  if (activeStatus) params.set('status', activeStatus);
  if (activeSearch) params.set('search', activeSearch);
  const { orders, summary, meta } = await adminRequest(`/api/admin/orders?${params}`);
  loginView.hidden = true;
  dashboard.hidden = false;
  renderSummary(summary);
  renderOrders(orders);
  document.querySelector('[data-results-note]').textContent = `${meta.count} ${meta.count === 1 ? 'order' : 'orders'} shown`;
};

const renderCustomerSummary = (customers) => {
  const totalCustomers = customers.length;
  const activeCustomers = customers.filter((customer) => customer.active).length;
  const customersWithOrders = customers.filter((customer) => Number(customer.orderCount) > 0).length;
  const totalSpentPaise = customers.reduce(
    (total, customer) => total + Number(customer.totalSpentPaise || 0),
    0
  );

  const values = {
    totalCustomers,
    activeCustomers,
    customersWithOrders,
    totalSpentPaise
  };

  Object.entries(values).forEach(([key, value]) => {
    const root = document.querySelector(`[data-customer-stat="${key}"]`);
    if (!root) return;
    root.textContent = key === 'totalSpentPaise' ? formatPrice(value) : value;
  });
};

const renderCustomers = (customers) => {
  if (!customers.length) {
    customersBody.innerHTML = '<tr><td colspan="7" class="empty-state">No customers match this search.</td></tr>';
    return;
  }

  customersBody.innerHTML = customers.map((customer) => `
    <tr data-customer-id="${escapeHtml(customer.id)}" tabindex="0">
      <td>
        <strong>${escapeHtml(customer.fullName)}</strong>
      </td>
      <td>${escapeHtml(customer.email)}</td>
      <td>${escapeHtml(customer.phone || '—')}</td>
      <td>${Number(customer.orderCount || 0)}</td>
      <td>${formatPrice(customer.totalSpentPaise || 0)}</td>
      <td>
        ${customer.active
          ? '<span class="status status-delivered">Active</span>'
          : '<span class="status status-cancelled">Inactive</span>'}
      </td>
      <td>
        <button
          class="status-action"
          type="button"
          data-customer-view="${escapeHtml(customer.id)}"
        >
          View
        </button>
      </td>
    </tr>
  `).join('');
};

const loadCustomers = async () => {
  customersBody.innerHTML = '<tr><td colspan="7" class="empty-state">Loading customers…</td></tr>';

  const params = new URLSearchParams();

  if (activeCustomerSearch) {
    params.set('search', activeCustomerSearch);
  }

  const query = params.toString();
  const result = await adminRequest(`/api/admin/customers${query ? `?${query}` : ''}`);

  const customers = result.customers || [];

  renderCustomerSummary(customers);
  renderCustomers(customers);

  const note = document.querySelector('[data-customer-results-note]');
  if (note) {
    note.textContent = `${customers.length} ${customers.length === 1 ? 'customer' : 'customers'} shown`;
  }
};

const renderProductSummary = (summary) => {
  Object.entries(summary).forEach(([key, value]) => {
    const root = document.querySelector(`[data-product-stat="${key}"]`);
    if (root) root.textContent = value;
  });
};

const loadMarketing = async () => {
  const [{ banners }, { coupons }] = await Promise.all([adminRequest('/api/admin/banners'), adminRequest('/api/admin/coupons')]);
  document.querySelector('[data-banners-list]').innerHTML = banners.length ? banners.map((banner) => `<article><strong>${escapeHtml(banner.title)}</strong><span>${escapeHtml(banner.placement)} · ${banner.active ? 'Active' : 'Inactive'}</span><button type="button" data-banner-edit='${escapeHtml(JSON.stringify(banner))}'>Edit</button> <button type="button" data-banner-toggle="${banner.id}" data-banner='${escapeHtml(JSON.stringify(banner))}'>${banner.active ? 'Disable' : 'Enable'}</button></article>`).join('') : '<p>No banners.</p>';
  const search = document.querySelector('[data-coupon-search]').value.trim().toLowerCase();
  const visibleCoupons = coupons.filter((coupon) => coupon.code.toLowerCase().includes(search));
  document.querySelector('[data-coupons-list]').innerHTML = visibleCoupons.length ? visibleCoupons.map((coupon) => `<article><strong>${escapeHtml(coupon.code)}</strong><span>${escapeHtml(coupon.discountType)} · ${coupon.discountValue} · minimum ${formatPrice(coupon.minimumOrderPaise)} · ${coupon.usageLimit ?? 'unlimited'} uses · ${coupon.active ? 'Active' : 'Inactive'}</span><button type="button" data-coupon-edit='${escapeHtml(JSON.stringify(coupon))}'>Edit</button> <button type="button" data-coupon-toggle="${coupon.id}" data-coupon='${escapeHtml(JSON.stringify(coupon))}'>${coupon.active ? 'Disable' : 'Enable'}</button></article>`).join('') : '<p>No coupons match.</p>';
};

document.querySelector('[data-coupon-search]')?.addEventListener('input', () => {
  loadMarketing().catch((error) => showToast(error.message));
});

const loadOperations = async () => {
  const [{ reviews }, { tickets }] = await Promise.all([adminRequest('/api/admin/reviews'), adminRequest('/api/admin/support')]);
  document.querySelector('[data-reviews-list]').innerHTML = reviews.length ? reviews.map((review) => `<article><strong>${escapeHtml(review.productName)} · ${review.rating}★</strong><span>${escapeHtml(review.customerName)} · ${escapeHtml(review.reviewText || 'No written review')} · ${escapeHtml(review.status)}</span>${review.status === 'pending' ? `<div><button type="button" data-review-moderate="${review.id}" data-review-status="approved">Approve</button> <button type="button" data-review-moderate="${review.id}" data-review-status="rejected">Reject</button></div>` : ''}</article>`).join('') : '<p>No reviews.</p>';
  document.querySelector('[data-support-list]').innerHTML = tickets.length ? tickets.map((ticket) => `<article><strong>${escapeHtml(ticket.topic)} · ${escapeHtml(ticket.name)}</strong><span>${escapeHtml(ticket.email)} · ${escapeHtml(ticket.message)} · ${escapeHtml(ticket.status)}</span><form data-support-reply="${escapeHtml(ticket.id)}"><label>Reply to customer<textarea name="customerReply" rows="3" maxlength="4000" required>${escapeHtml(ticket.customerReply || '')}</textarea></label><label>Status<select name="status"><option value="in_progress" ${ticket.status === 'in_progress' ? 'selected' : ''}>In progress</option><option value="resolved" ${ticket.status === 'resolved' ? 'selected' : ''}>Resolved</option></select></label><button type="submit">Send reply</button><p data-support-email-status role="status"></p></form>${ticket.status !== 'resolved' ? `<button type="button" data-support-resolve="${ticket.id}">Resolve</button>` : ''}</article>`).join('') : '<p>No support tickets.</p>';
};

const renderProducts = (products) => {
  productsById = new Map(products.map((product) => [String(product.id), product]));
  if (!products.length) {
    productsBody.innerHTML = '<tr><td colspan="7" class="empty-state">No products match this view.</td></tr>';
    return;
  }
  productsBody.innerHTML = products.map((product) => {
    const stockClass = product.availableQuantity === 0 ? 'stock-zero' : product.availableQuantity <= product.lowStockThreshold ? 'stock-low' : '';
    return `<tr data-product-id="${escapeHtml(product.id)}" tabindex="0">
      <td><div class="product-cell"><img src="${escapeHtml(product.imageUrl || '/perfume.jpg')}" alt=""><div><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.slug)}</span></div></div></td>
      <td>${escapeHtml(product.sku)}</td>
      <td>${escapeHtml(product.categoryName)}</td>
      <td><label class="inline-product-field"><span class="sr-only">Price for ${escapeHtml(product.name)}</span><span>₹</span><input data-product-price type="number" value="${product.pricePaise / 100}" min="0" step="0.01" aria-label="Price for ${escapeHtml(product.name)}"></label></td>
      <td class="${stockClass}"><label class="inline-product-field"><span class="sr-only">Inventory for ${escapeHtml(product.name)}</span><input data-product-quantity type="number" value="${product.quantity}" min="${product.reservedQuantity}" max="1000000" step="1" aria-label="Inventory for ${escapeHtml(product.name)}"></label></td>
      <td>${product.active ? '<span class="status status-delivered">Active</span>' : '<span class="status status-cancelled">Archived</span>'}</td>
      <td><div class="inline-product-actions"><button class="status-action" type="button" data-product-quick-save="${escapeHtml(product.id)}">Save</button><button class="text-button" type="button" data-product-edit="${escapeHtml(product.id)}">Full edit</button></div></td>
    </tr>`;
  }).join('');
};

const loadProducts = async () => {
  productsBody.innerHTML = '<tr><td colspan="6" class="empty-state">Loading products…</td></tr>';
  const params = new URLSearchParams({ active: activeProductState, lowStock: String(lowStockOnly) });
  if (activeProductSearch) params.set('search', activeProductSearch);
  const { products, summary, meta } = await adminRequest(`/api/admin/products?${params}`);
  renderProductSummary(summary);
  renderProducts(products);
  document.querySelector('[data-product-results-note]').textContent = `${meta.count} ${meta.count === 1 ? 'product' : 'products'} shown`;
};

const ensureProductCategories = async () => {
  if (productCategories.length) return;
  const result = await adminRequest('/api/admin/catalog/categories');
  productCategories = result.categories;
};

const productFormMarkup = (product = null) => {
  const editing = Boolean(product);
  const value = (key, fallback = '') => escapeHtml(product?.[key] ?? fallback);
  const categoryOptions = productCategories.map((category) => `<option value="${escapeHtml(category.slug)}"${category.slug === product?.categorySlug ? ' selected' : ''}>${escapeHtml(category.name)}${category.active ? '' : ' · archived'}</option>`).join('');
  const familyOptions = ['floral', 'fresh', 'woody', 'sets'].map((family) => `<option value="${family}"${family === product?.scentFamily ? ' selected' : ''}>${titleCase(family)}</option>`).join('');
  return `
    <div class="detail-head"><div><p class="eyebrow">Catalogue</p><h2 id="detail-title">${editing ? 'Edit product' : 'New product'}</h2></div><button class="close-button" type="button" data-detail-close aria-label="Close">×</button></div>
    <div class="detail-body" style="max-height: calc(100vh - 170px); overflow-y: auto;">
  <form class="product-form" data-product-form data-product-id="${editing ? escapeHtml(product.id) : ''}" novalidate>
      <div class="product-form-grid">
        <label class="full">Product name · required<input name="name" value="${value('name')}" placeholder="Example: Madurai Jasmine" required minlength="2" maxlength="140"></label>
        <label>Slug · required<input name="slug" value="${value('slug')}" placeholder="madurai-jasmine" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxlength="100"></label>
        <label>SKU · required<input name="sku" value="${value('sku')}" placeholder="BUVA-MJ-050" required pattern="[A-Za-z0-9][A-Za-z0-9-]*" maxlength="60"></label>
        <label>Category<select name="categorySlug" required>${categoryOptions}</select></label>
        <label>Scent family<select name="scentFamily" required>${familyOptions}</select></label>
        <label>Concentration<input name="concentration" value="${value('concentration', 'Eau de Parfum')}" required maxlength="80"></label>
        <label>Size · ml<input name="sizeMl" type="number" value="${value('sizeMl', 50)}" min="1" max="10000" required></label>
        <label>Price · ₹ · required<input name="price" type="number" value="${product ? product.pricePaise / 100 : ''}" placeholder="1490" min="0" step="0.01" required></label>
        <label>Compare-at price · ₹<input name="compareAtPrice" type="number" value="${product?.compareAtPricePaise ? product.compareAtPricePaise / 100 : ''}" min="0" step="0.01"></label>
        <label>Inventory quantity<input name="quantity" type="number" value="${value('quantity', 0)}" min="${product?.reservedQuantity || 0}" max="1000000" required></label>
        <label>Low-stock threshold<input name="lowStockThreshold" type="number" value="${value('lowStockThreshold', 5)}" min="0" max="1000000" required></label>
        <label class="full">Short description<input name="shortDescription" value="${value('shortDescription')}" maxlength="240"></label>
        <label class="full">Description<textarea name="description" maxlength="4000">${value('description')}</textarea></label>
        <label class="full">Product image
          <input name="imageFile" type="file" accept="image/jpeg,image/png,image/webp">
          <span class="product-form-help">Choose a JPG, PNG, or WebP image. It will be uploaded when you save the product.</span>
        </label>
        <label class="full">Image URL<input name="imageUrl" value="${value('imageUrl', '/perfume.jpg')}" required maxlength="500"></label>
        <label class="full">Image alt text<input name="imageAlt" value="${value('imageAlt')}" maxlength="240"></label>
      </div>
      ${editing && product.reservedQuantity ? `<p class="product-form-help">${product.reservedQuantity} units are currently reserved; inventory cannot be set below this amount.</p>` : ''}
      <div class="checkbox-row">
        <label><input name="active" type="checkbox"${product?.active ?? true ? ' checked' : ''}> Available in storefront</label>
        <label><input name="featured" type="checkbox"${product?.featured ? ' checked' : ''}> Featured</label>
      </div>
      ${editing ? '' : '<p class="product-form-help">Your draft is saved automatically. The product is added only after you select Create product.</p>'}
      <p class="product-form-error" data-product-form-error role="alert" hidden></p>
      <div class="product-form-actions"><button class="secondary-action" type="button" ${editing ? 'data-detail-close' : 'data-product-cancel'}>Cancel</button><button class="status-action" type="submit">${editing ? 'Save changes' : 'Create product'}</button></div>
    </form></div>`;
};

const openProductForm = async (product = null) => {
  try {
    await ensureProductCategories();
    detailContent.innerHTML = productFormMarkup(product);

    const form = detailContent.querySelector('[data-product-form]');
    const draft = product ? null : readProductDraft();

    if (draft && form) {
      Object.entries(draft).forEach(([name, value]) => {
        const field = form.elements.namedItem(name);

        if (!field) return;

        if (field.type === 'checkbox') {
          field.checked = Boolean(value);
        } else {
          field.value = value;
        }
      });
    }

    document.body.classList.add('detail-open');
    detailDrawer.setAttribute('aria-hidden', 'false');
    form?.elements.namedItem('name')?.focus();
  } catch (error) {
    showToast(error.message);
  }
};

const renderDetail = (order, allowedTransitions) => {
  const address = order.shippingAddress || {};
  const addressLines = [address.recipientName, address.line1, address.line2, `${address.city || ''}, ${address.state || ''} ${address.postalCode || ''}`, address.countryCode]
    .filter(Boolean).map(escapeHtml).join('<br>');
  const discount = order.discountPaise > 0
    ? `<div><span>Discount${order.couponCode ? ` · ${escapeHtml(order.couponCode)}` : ''}</span><strong>−${formatPrice(order.discountPaise)}</strong></div>` : '';
  const paymentBlocked = order.paymentMethod === 'razorpay' && order.paymentStatus !== 'paid';
  const visibleTransitions = paymentBlocked
    ? allowedTransitions.filter((status) => !['confirmed', 'packed', 'shipped', 'delivered'].includes(status))
    : allowedTransitions;
  const actions = visibleTransitions.length
    ? visibleTransitions.map((status) => `<button class="status-action${status === 'cancelled' || status === 'returned' ? ' danger' : ''}" type="button" data-next-status="${status}" data-order-id="${escapeHtml(order.id)}">Mark ${escapeHtml(status)}</button>`).join('')
    : paymentBlocked
      ? '<p class="address">Razorpay payment is pending. This order cannot be fulfilled until payment is successful.</p>'
      : '<p class="address">This order has reached a final status.</p>';

  detailContent.innerHTML = `
    <div class="detail-head"><div><p class="eyebrow">Order details</p><h2 id="detail-title">${escapeHtml(order.orderNumber)}</h2></div><button class="close-button" type="button" data-detail-close aria-label="Close">×</button></div>
    <div class="detail-body">
      <section class="detail-section"><h3>Overview</h3><div class="detail-grid">
        <div><span>Status</span><strong>${statusBadge(order.status)}</strong></div>
        <div><span>Placed</span><strong>${escapeHtml(formatDate(order.createdAt))}</strong></div>
        <div><span>Payment</span><strong>${escapeHtml(titleCase(order.paymentMethod))} · ${escapeHtml(order.paymentStatus)}</strong></div>
        <div><span>Contact</span><strong>${escapeHtml(order.phone)}</strong></div>
        <div><span>Customer</span><strong>${escapeHtml(order.customerName)}</strong></div>
        <div><span>Email</span><strong>${escapeHtml(order.email)}</strong></div>
      </div></section>
      <section class="detail-section"><h3>Delivery</h3><p class="address">${addressLines}</p></section>
      <section class="detail-section"><h3>Items</h3>${order.items.map((item) => `<div class="line-item"><div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.sku)} · Qty ${item.quantity}</span></div><strong>${formatPrice(item.lineTotalPaise)}</strong></div>`).join('')}</section>
      <section class="detail-section totals"><h3>Totals</h3>
        <div><span>Subtotal</span><strong>${formatPrice(order.subtotalPaise)}</strong></div>${discount}
        <div><span>Delivery</span><strong>${order.shippingPaise ? formatPrice(order.shippingPaise) : 'Complimentary'}</strong></div>
        <div class="grand-total"><span>Total</span><strong>${formatPrice(order.totalPaise)}</strong></div>
      </section>
      <section class="detail-section"><h3>Invoice</h3><button class="admin-invoice-button" type="button" data-admin-invoice="${escapeHtml(order.id)}">View / Print invoice</button></section>
      ${order.customerNotes ? `<section class="detail-section"><h3>Customer notes</h3><p class="address">${escapeHtml(order.customerNotes)}</p></section>` : ''}
      <section class="detail-section"><h3>Courier tracking</h3><form class="admin-form" data-tracking-form="${escapeHtml(order.id)}"><label>Courier<input name="courierName" value="${escapeHtml(order.courierName || '')}" required></label><label>Tracking number<input name="trackingNumber" value="${escapeHtml(order.trackingNumber || '')}" required></label><label>HTTPS tracking URL<input name="trackingUrl" type="url" value="${escapeHtml(order.trackingUrl || '')}"></label><button type="submit">Save tracking</button></form></section>
      <section class="detail-section"><h3>Update status</h3><div class="status-actions">${actions}</div></section>
    </div>`;
};

const closeAdminInvoice = () => {
  adminInvoiceShell.hidden = true;
  document.body.classList.remove('admin-invoice-open');
  document.title = 'Buva Admin — Orders';
};

const openAdminInvoice = async (orderId) => {
  const { invoice } = await adminRequest(`/api/admin/orders/${encodeURIComponent(orderId)}/invoice`);
  const label = (value) => String(value || 'not available').replaceAll('_', ' ');
  const invoiceDate = (value) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(value));
  const address = invoice.billingAddress || {};
  const addressMarkup = [address.recipientName, address.line1, address.line2,
    [address.city, address.state, address.postalCode].filter(Boolean).join(', '), address.countryCode]
    .filter(Boolean).map(escapeHtml).join('<br>');
  const paymentReference = invoice.providerPaymentId || invoice.providerOrderId || 'Not applicable';
  const taxRows = Number(invoice.igstPaise) > 0
    ? `<div><span>IGST (18%)</span><strong>${formatInvoicePrice(invoice.igstPaise)}</strong></div>`
    : `<div><span>CGST (9%)</span><strong>${formatInvoicePrice(invoice.cgstPaise)}</strong></div><div><span>SGST (9%)</span><strong>${formatInvoicePrice(invoice.sgstPaise)}</strong></div>`;
  adminInvoiceShell.querySelector('[data-admin-invoice-document]').innerHTML = `
    <header class="invoice-document-head"><div><span class="brand">BU<span>V</span>A</span><p>Modern Indian Perfumery<br>Chennai, Tamil Nadu · India</p></div><div><p class="eyebrow">Tax invoice</p><h1>${escapeHtml(invoice.invoiceNumber)}</h1><p>Issued ${invoiceDate(invoice.issuedAt)}</p></div></header>
    <section class="invoice-parties"><div><h2>Bill to</h2><strong>${escapeHtml(invoice.customerName)}</strong><p>${addressMarkup}</p><p>${escapeHtml(invoice.email)}<br>${escapeHtml(invoice.phone)}</p></div><div><h2>Order & payment</h2><dl><dt>Order</dt><dd>${escapeHtml(invoice.orderNumber)}</dd><dt>Order date</dt><dd>${invoiceDate(invoice.orderCreatedAt)}</dd><dt>Order status</dt><dd>${escapeHtml(label(invoice.orderStatus))}</dd><dt>Payment</dt><dd>${escapeHtml(label(invoice.paymentStatus))} · ${escapeHtml(label(invoice.paymentMethod))}</dd><dt>Reference</dt><dd>${escapeHtml(paymentReference)}</dd></dl></div></section>
    <div class="invoice-lines-wrap"><table class="invoice-lines"><thead><tr><th>Item</th><th>SKU</th><th>Qty</th><th>Unit price</th><th>GST</th><th>Amount</th></tr></thead><tbody>${invoice.items.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.sku)}</td><td>${Number(item.quantity)}</td><td>${formatInvoicePrice(item.unitPricePaise)}</td><td>${Number(item.taxRatePercent)}% incl.</td><td>${formatInvoicePrice(item.lineTotalPaise)}</td></tr>`).join('')}</tbody></table></div>
    <section class="invoice-summary"><p>All prices are GST-inclusive. Place of supply: ${escapeHtml(address.state || 'India')}.</p><div class="invoice-totals"><div><span>Subtotal</span><strong>${formatInvoicePrice(invoice.subtotalPaise)}</strong></div>${Number(invoice.discountPaise) ? `<div><span>Discount</span><strong>−${formatInvoicePrice(invoice.discountPaise)}</strong></div>` : ''}<div><span>Shipping</span><strong>${formatInvoicePrice(invoice.shippingPaise)}</strong></div><div><span>Taxable value</span><strong>${formatInvoicePrice(invoice.taxablePaise)}</strong></div>${taxRows}<div class="invoice-grand-total"><span>Total</span><strong>${formatInvoicePrice(invoice.totalPaise)}</strong></div><div><span>Payment status</span><strong class="payment-label">${escapeHtml(label(invoice.paymentStatus))}</strong></div></div></section>
    <footer class="invoice-document-foot"><p>Thank you for choosing Buva.</p><p>Invoice currency: ${escapeHtml(invoice.currency)}</p></footer>`;
  document.title = `${invoice.invoiceNumber} — Buva Admin`;
  adminInvoiceShell.hidden = false;
  document.body.classList.add('admin-invoice-open');
  adminInvoiceShell.querySelector('[data-admin-invoice-close]').focus();
};

const openCustomer = async (id) => {
  detailContent.innerHTML = '<p class="empty-state">Loading customer…</p>';
  document.body.classList.add('detail-open');
  detailDrawer.setAttribute('aria-hidden', 'false');

  try {
    const { customer, addresses, orders, summary } = await adminRequest(
      `/api/admin/customers/${encodeURIComponent(id)}`
    );

    const addressMarkup = addresses.length
      ? addresses.map((address) => {
          const lines = [
            address.recipientName,
            address.phone,
            address.line1,
            address.line2,
            `${address.city || ''}, ${address.state || ''} ${address.postalCode || ''}`,
            address.countryCode
          ].filter(Boolean).map(escapeHtml).join('<br>');

          return `
            <div class="line-item">
              <div>
                <strong>${escapeHtml(address.label || 'Address')}</strong>
                <span>${address.isDefault ? 'Default address' : ''}</span>
              </div>
              <span>${lines}</span>
            </div>
          `;
        }).join('')
      : '<p class="address">No saved addresses.</p>';

    const orderMarkup = orders.length
      ? orders.map((order) => `
          <div class="line-item">
            <div>
              <strong>${escapeHtml(order.orderNumber)}</strong>
              <span>${escapeHtml(formatDate(order.createdAt))} · ${escapeHtml(titleCase(order.paymentStatus))}</span>
            </div>
            <div>
              <strong>${formatPrice(order.totalPaise)}</strong>
              <span>${statusBadge(order.status)}</span>
            </div>
          </div>
        `).join('')
      : '<p class="address">No orders found.</p>';

    const actionLabel = customer.active ? 'Deactivate customer' : 'Activate customer';
    const actionClass = customer.active ? 'status-action danger' : 'status-action';

    detailContent.innerHTML = `
      <div class="detail-head">
        <div>
          <p class="eyebrow">Customer details</p>
          <h2 id="detail-title">${escapeHtml(customer.fullName)}</h2>
        </div>
        <button class="close-button" type="button" data-detail-close aria-label="Close">×</button>
      </div>

      <div class="detail-body">
        <section class="detail-section">
          <h3>Profile</h3>
          <div class="detail-grid">
            <div>
              <span>Name</span>
              <strong>${escapeHtml(customer.fullName)}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong>${customer.active
                ? '<span class="status status-delivered">Active</span>'
                : '<span class="status status-cancelled">Inactive</span>'}</strong>
            </div>
            <div>
              <span>Email</span>
              <strong>${escapeHtml(customer.email)}</strong>
            </div>
            <div>
              <span>Phone</span>
              <strong>${escapeHtml(customer.phone || '—')}</strong>
            </div>
            <div>
              <span>Registered</span>
              <strong>${escapeHtml(formatDate(customer.createdAt))}</strong>
            </div>
            <div>
              <span>Orders</span>
              <strong>${Number(summary.orderCount || 0)}</strong>
            </div>
          </div>
        </section>

        <section class="detail-section totals">
          <h3>Customer summary</h3>
          <div>
            <span>Total orders</span>
            <strong>${Number(summary.orderCount || 0)}</strong>
          </div>
          <div class="grand-total">
            <span>Total spent</span>
            <strong>${formatPrice(summary.totalSpentPaise || 0)}</strong>
          </div>
        </section>

        <section class="detail-section">
          <h3>Saved addresses</h3>
          ${addressMarkup}
        </section>

        <section class="detail-section">
          <h3>Order history</h3>
          ${orderMarkup}
        </section>

        <section class="detail-section">
          <h3>Account status</h3>
          <button
            class="${actionClass}"
            type="button"
            data-customer-status="${escapeHtml(customer.id)}"
            data-customer-active="${customer.active ? 'true' : 'false'}"
          >
            ${actionLabel}
          </button>
        </section>
      </div>
    `;

    document.querySelector('[data-detail-close]')?.focus();
  } catch (error) {
    showToast(error.message);
    closeDetail();
  }
};

const openOrder = async (id) => {
  detailContent.innerHTML = '<p class="empty-state">Loading order…</p>';
  document.body.classList.add('detail-open');
  detailDrawer.setAttribute('aria-hidden', 'false');
  try {
    const { order, allowedTransitions } = await adminRequest(`/api/admin/orders/${encodeURIComponent(id)}`);
    renderDetail(order, allowedTransitions);
    document.querySelector('[data-detail-close]')?.focus();
  } catch (error) {
    showToast(error.message);
    closeDetail();
  }
};

const closeDetail = () => {
  document.body.classList.remove('detail-open');
  detailDrawer.setAttribute('aria-hidden', 'true');
};

const switchAdminView = async (view) => {
  document.querySelectorAll('[data-admin-view]').forEach((button) => button.classList.toggle('active', button.dataset.adminView === view));
  document.querySelectorAll('[data-view-panel]').forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; });
  closeDetail();
  if (view === 'products') await loadProducts();
  if (view === 'customers') await loadCustomers();
  if (view === 'marketing') await loadMarketing();
  if (view === 'operations') await loadOperations();
};

document.querySelector('[data-login-form]').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = document.querySelector('[data-login-error]');
  error.hidden = true;
  adminKey = new FormData(event.currentTarget).get('key').trim();
  try {
    await loadOrders();
    sessionStorage.setItem(storageKey, adminKey);
    event.currentTarget.reset();
  } catch (requestError) {
    if (!error.hidden) return;
    error.textContent = requestError.message;
    error.hidden = false;
  }
});

document.querySelector('[data-search-form]').addEventListener('submit', async (event) => {
  event.preventDefault();
  activeSearch = new FormData(event.currentTarget).get('search').trim();
  try { await loadOrders(); } catch (error) { showToast(error.message); }
});

document.querySelector('[data-customer-search-form]').addEventListener('submit', async (event) => {
  event.preventDefault();

  const input = event.currentTarget.querySelector('input[name="search"]');
  activeCustomerSearch = input ? input.value.trim() : '';

  try {
    await loadCustomers();
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector('[data-product-search-form]').addEventListener('submit', async (event) => {
  event.preventDefault();
  activeProductSearch = new FormData(event.currentTarget).get('search').trim();
  try { await loadProducts(); } catch (error) { showToast(error.message); }
});

document.addEventListener('submit', async (event) => {
  const trackingForm = event.target.closest('[data-tracking-form]');
  if (!trackingForm) return;
  event.preventDefault();
  try {
    const fields = Object.fromEntries(new FormData(trackingForm));
    const { order, allowedTransitions } = await adminRequest(`/api/admin/orders/${trackingForm.dataset.trackingForm}/tracking`, { method: 'PATCH', body: JSON.stringify(fields) });
    renderDetail(order, allowedTransitions); showToast('Tracking saved');
  } catch (error) { showToast(error.message); }
});

document.addEventListener('submit', async (event) => {
  const bannerForm = event.target.closest('[data-banner-form]');
  const couponForm = event.target.closest('[data-coupon-form]');
  if (!bannerForm && !couponForm) return;
  event.preventDefault();
  const fields = Object.fromEntries(new FormData(event.target));
  try {
    if (bannerForm) {
      const { id, ...bannerFields } = fields;
      const body = { ...bannerFields, displayOrder: Number(fields.displayOrder), active: fields.active === 'on',
        startsAt: fields.startsAt ? new Date(fields.startsAt).toISOString() : null,
        endsAt: fields.endsAt ? new Date(fields.endsAt).toISOString() : null };
      await adminRequest(id ? `/api/admin/banners/${encodeURIComponent(id)}` : '/api/admin/banners', {
        method: id ? 'PATCH' : 'POST', body: JSON.stringify(body)
      });
      bannerForm.querySelector('[data-banner-submit]').textContent = 'Create banner';
      bannerForm.querySelector('[data-banner-cancel]').hidden = true;
    }
    if (couponForm) {
      const { id, ...couponFields } = fields;
      const body = { ...couponFields, discountValue: Number(fields.discountValue), minimumOrderPaise: Number(fields.minimumOrderPaise), usageLimit: fields.usageLimit ? Number(fields.usageLimit) : null, active: fields.active === 'on', startsAt: fields.startsAt ? new Date(fields.startsAt).toISOString() : null, endsAt: fields.endsAt ? new Date(fields.endsAt).toISOString() : null };
      await adminRequest(id ? `/api/admin/coupons/${encodeURIComponent(id)}` : '/api/admin/coupons', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      couponForm.querySelector('[data-coupon-submit]').textContent = 'Create coupon';
      couponForm.querySelector('[data-coupon-cancel]').hidden = true;
    }
    event.target.reset(); await loadMarketing(); showToast(bannerForm ? 'Banner saved' : 'Coupon saved');
  } catch (error) { showToast(error.message); }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-support-reply]');
  if (!form) return;
  event.preventDefault();
  try {
    const fields = Object.fromEntries(new FormData(form));
    const { email } = await adminRequest(`/api/admin/support/${encodeURIComponent(form.dataset.supportReply)}`, { method: 'PATCH', body: JSON.stringify(fields) });
    const message = email?.accepted
      ? 'Reply saved. Email accepted by the mail server for delivery.'
      : email?.reason === 'not_configured'
        ? 'Reply saved, but email is not configured. Please send it by another method.'
        : 'Reply saved, but email was not accepted. Check mail settings and resend.';
    form.querySelector('[data-support-email-status]').textContent = message;
    showToast(message);
    await loadOperations();
    document.querySelectorAll('[data-support-reply]').forEach((replyForm) => {
      if (replyForm.dataset.supportReply === form.dataset.supportReply) {
        replyForm.querySelector('[data-support-email-status]').textContent = message;
      }
    });
  } catch (error) { showToast(error.message); }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-product-form]');
  if (!form) return;
  event.preventDefault();
  const errorRoot = form.querySelector('[data-product-form-error]');
  const submit = form.querySelector('[type="submit"]');
  errorRoot.hidden = true;

  const invalidFields = Array.from(form.elements).filter((field) =>
    typeof field.checkValidity === 'function' && !field.checkValidity()
  );
  if (invalidFields.length) {
    const invalidField = invalidFields[0];
    const fieldName = productFieldLabel(invalidField);
    const message = invalidField.validity.valueMissing
      ? `Please enter ${fieldName}.`
      : `Invalid ${fieldName}: ${invalidField.validationMessage || 'Check this value.'}`;
    showProductFormError(form, message, invalidField);
    console.warn('Invalid product fields:', invalidFields.map((field) => ({
      name: field.name,
      value: field.value,
      validationMessage: field.validationMessage
    })));
    return;
  }

  const fields = new FormData(form);

  const imageFile = fields.get('imageFile');
  if (imageFile && imageFile instanceof File && imageFile.size > 0) {
    try {
      submit.disabled = true;
      submit.textContent = 'Uploading image…';

      const uploadResult = await uploadProductImage(imageFile);

      if (!uploadResult.url) {
        throw new Error('Image upload succeeded but no image URL was returned.');
      }

      form.elements.namedItem('imageUrl').value = uploadResult.url;
      fields.set('imageUrl', uploadResult.url);
    } catch (error) {
      showProductFormError(form, error.message || 'Image upload failed.');
      submit.disabled = false;
      submit.textContent = form.dataset.productId ? 'Save changes' : 'Create product';
      return;
    }
  }

  const price = Number(fields.get('price'));
  const compareAtPriceText = String(fields.get('compareAtPrice') || '').trim();
  const compareAtPrice = compareAtPriceText ? Number(compareAtPriceText) : null;
  if (compareAtPrice !== null && compareAtPrice < price) {
    const compareAtPriceField = form.elements.namedItem('compareAtPrice');
    showProductFormError(form, 'Compare-at price cannot be lower than the selling price.', compareAtPriceField);
    return;
  }

  submit.disabled = true;
  submit.textContent = form.dataset.productId ? 'Saving…' : 'Creating…';
  const payload = {
    name: String(fields.get('name')).trim(),
    slug: String(fields.get('slug')).trim(),
    sku: String(fields.get('sku')).trim(),
    categorySlug: String(fields.get('categorySlug')).trim(),
    scentFamily: String(fields.get('scentFamily')).trim(),
    concentration: String(fields.get('concentration')).trim(),
    sizeMl: Number(fields.get('sizeMl')),
    pricePaise: Math.round(price * 100),
    compareAtPricePaise: compareAtPrice === null ? null : Math.round(compareAtPrice * 100),
    quantity: Number(fields.get('quantity')),
    lowStockThreshold: Number(fields.get('lowStockThreshold')),
    shortDescription: String(fields.get('shortDescription') || '').trim(),
    description: String(fields.get('description') || '').trim(),
    imageUrl: String(fields.get('imageUrl') || '').trim(),
    imageAlt: String(fields.get('imageAlt') || '').trim(),
    active: fields.has('active'),
    featured: fields.has('featured')
  };
  const editing = Boolean(form.dataset.productId);
  try {
    const result = await adminRequest(editing ? `/api/admin/products/${form.dataset.productId}` : '/api/admin/products', {
      method: editing ? 'PATCH' : 'POST',
      body: JSON.stringify(payload)
    });
    if (!editing) clearProductDraft();
    closeDetail();
    await loadProducts();
    showToast(`${result.product.name} ${editing ? 'updated' : 'created'}`);
  } catch (error) {
    showProductFormError(form, error.message || 'The product could not be saved.');
    submit.disabled = false;
    submit.textContent = editing ? 'Save changes' : 'Create product';
  }
});

document.addEventListener('input', (event) => {
  const form = event.target.closest('[data-product-form]');
  if (!form || form.dataset.productId) return;
  if (event.target.name === 'name') {
    const slug = form.elements.namedItem('slug');
    const previousAutoSlug = form.dataset.autoSlug || '';
    if (slug && (!slug.value || slug.value === previousAutoSlug)) {
      slug.value = productSlug(event.target.value);
      form.dataset.autoSlug = slug.value;
    }
  }
  saveProductDraft(form);
});

document.addEventListener('change', (event) => {
  const form = event.target.closest('[data-product-form]');
  if (form && !form.dataset.productId) saveProductDraft(form);
});

document.querySelector('[data-customer-refresh]').addEventListener('click', async () => {
  try {
    await loadCustomers();
    showToast('Customers refreshed');
  } catch (error) {
    showToast(error.message);
  }
});

document.addEventListener('click', async (event) => {
  if (event.target.closest('[data-admin-invoice-close]')) { closeAdminInvoice(); return; }
  if (event.target.closest('[data-admin-invoice-print]')) { window.print(); return; }
  const invoiceButton = event.target.closest('[data-admin-invoice]');
  if (invoiceButton) {
    try { await openAdminInvoice(invoiceButton.dataset.adminInvoice); } catch (error) { showToast(error.message); }
    return;
  }
  if (event.target.closest('[data-logout]')) return showLogin();
  const exportButton = event.target.closest('[data-export-orders]');
  if (exportButton) {
    const format = exportButton.dataset.exportOrders === 'xlsx' ? 'xlsx' : 'csv';
    const response = await fetch(`/api/admin/exports/orders.${format}`, { headers: { 'X-Admin-Key': adminKey } });
    if (!response.ok) { showToast('Order export failed'); return; }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = `buva-orders-${new Date().toISOString().slice(0, 10)}.${format}`; link.click(); URL.revokeObjectURL(url);
    return;
  }
  const bannerToggle = event.target.closest('[data-banner-toggle]');
  if (bannerToggle) {
    const banner = JSON.parse(bannerToggle.dataset.banner); await adminRequest(`/api/admin/banners/${banner.id}`, { method: 'PATCH', body: JSON.stringify({ ...banner, active: !banner.active }) }); await loadMarketing(); return;
  }
  const bannerEdit = event.target.closest('[data-banner-edit]');
  if (bannerEdit) {
    const banner = JSON.parse(bannerEdit.dataset.bannerEdit);
    const form = document.querySelector('[data-banner-form]');
    const localDate = (value) => {
      if (!value) return '';
      const date = new Date(value);
      return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };
    for (const name of ['id', 'title', 'subtitle', 'imageUrl', 'linkUrl', 'placement', 'displayOrder']) form.elements[name].value = banner[name] ?? '';
    form.elements.startsAt.value = localDate(banner.startsAt);
    form.elements.endsAt.value = localDate(banner.endsAt);
    form.elements.active.checked = banner.active;
    form.querySelector('[data-banner-submit]').textContent = 'Save banner';
    form.querySelector('[data-banner-cancel]').hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (event.target.closest('[data-banner-cancel]')) {
    const form = document.querySelector('[data-banner-form]');
    form.reset(); form.elements.id.value = '';
    form.querySelector('[data-banner-submit]').textContent = 'Create banner';
    form.querySelector('[data-banner-cancel]').hidden = true;
    return;
  }
  const couponToggle = event.target.closest('[data-coupon-toggle]');
  if (couponToggle) {
    const coupon = JSON.parse(couponToggle.dataset.coupon); await adminRequest(`/api/admin/coupons/${coupon.id}`, { method: 'PATCH', body: JSON.stringify({ ...coupon, active: !coupon.active }) }); await loadMarketing(); return;
  }
  const couponEdit = event.target.closest('[data-coupon-edit]');
  if (couponEdit) {
    const coupon = JSON.parse(couponEdit.dataset.couponEdit);
    const form = document.querySelector('[data-coupon-form]');
    for (const key of ['id', 'code', 'discountType', 'discountValue', 'minimumOrderPaise', 'usageLimit']) form.elements[key].value = coupon[key] ?? '';
    for (const key of ['startsAt', 'endsAt']) form.elements[key].value = coupon[key] ? new Date(coupon[key]).toISOString().slice(0, 16) : '';
    form.elements.active.checked = coupon.active;
    form.querySelector('[data-coupon-submit]').textContent = 'Save coupon';
    form.querySelector('[data-coupon-cancel]').hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (event.target.closest('[data-coupon-cancel]')) {
    const form = document.querySelector('[data-coupon-form]');
    form.reset(); form.elements.id.value = '';
    form.querySelector('[data-coupon-submit]').textContent = 'Create coupon';
    form.querySelector('[data-coupon-cancel]').hidden = true;
    return;
  }
  const reviewModerate = event.target.closest('[data-review-moderate]');
  if (reviewModerate) { await adminRequest(`/api/admin/reviews/${reviewModerate.dataset.reviewModerate}`, { method: 'PATCH', body: JSON.stringify({ status: reviewModerate.dataset.reviewStatus }) }); await loadOperations(); return; }
  const supportResolve = event.target.closest('[data-support-resolve]');
  if (supportResolve) { await adminRequest(`/api/admin/support/${supportResolve.dataset.supportResolve}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved' }) }); await loadOperations(); return; }
  if (event.target.closest('[data-product-cancel]')) {
    clearProductDraft();
    closeDetail();
    showToast('New product draft discarded');
    return;
  }
  if (event.target.closest('[data-detail-close]')) {
    closeDetail();
    return;
  }

  if (event.target.closest(".detail-drawer") && !event.target.closest("[data-next-status]")) return;
  const viewButton = event.target.closest('[data-admin-view]');
  if (viewButton) {
    try { await switchAdminView(viewButton.dataset.adminView); } catch (error) { showToast(error.message); }
    return;
  }
  if (event.target.closest('[data-product-create]')) {
    await openProductForm();
    return;
  }
  const productState = event.target.closest('[data-product-active]');
  if (productState) {
    document.querySelectorAll('[data-product-active]').forEach((button) => button.classList.remove('active'));
    productState.classList.add('active');
    activeProductState = productState.dataset.productActive;
    try { await loadProducts(); } catch (error) { showToast(error.message); }
    return;
  }
  if (event.target.closest('[data-product-low-stock]')) {
    lowStockOnly = !lowStockOnly;
    event.target.closest('[data-product-low-stock]').classList.toggle('active', lowStockOnly);
    try { await loadProducts(); } catch (error) { showToast(error.message); }
    return;
  }
  if (event.target.closest('[data-refresh]')) {
    try { await loadOrders(); showToast('Orders refreshed'); } catch (error) { showToast(error.message); }
    return;
  }
  const quickSave = event.target.closest('[data-product-quick-save]');
  if (quickSave) {
    const product = productsById.get(quickSave.dataset.productQuickSave);
    const productRow = quickSave.closest('[data-product-id]');
    const price = Number(productRow.querySelector('[data-product-price]').value);
    const quantity = Number(productRow.querySelector('[data-product-quantity]').value);
    if (!Number.isFinite(price) || price < 0 || !Number.isInteger(quantity) || quantity < product.reservedQuantity) {
      showToast(`Enter a valid price and inventory of at least ${product.reservedQuantity}`);
      return;
    }
    quickSave.disabled = true;
    try {
      const result = await adminRequest(`/api/admin/products/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: product.name,
          slug: product.slug,
          sku: product.sku,
          categorySlug: product.categorySlug,
          scentFamily: product.scentFamily,
          concentration: product.concentration,
          sizeMl: product.sizeMl,
          pricePaise: Math.round(price * 100),
          compareAtPricePaise: product.compareAtPricePaise,
          quantity,
          lowStockThreshold: product.lowStockThreshold,
          shortDescription: product.shortDescription || '',
          description: product.description || '',
          imageUrl: product.imageUrl || '/perfume.jpg',
          imageAlt: product.imageAlt || '',
          active: product.active,
          featured: product.featured
        })
      });
      await loadProducts();
      showToast(`${result.product.name} price and inventory saved`);
    } catch (error) {
      quickSave.disabled = false;
      showToast(error.message);
    }
    return;
  }
  const productEdit = event.target.closest('[data-product-edit]');
  if (productEdit) {
    await openProductForm(productsById.get(productEdit.dataset.productEdit));
    return;
  }
  if (event.target.closest('[data-product-price], [data-product-quantity]')) return;
  const filter = event.target.closest('[data-status]');
  if (filter) {
    document.querySelectorAll('[data-status]').forEach((button) => button.classList.remove('active'));
    filter.classList.add('active');
    activeStatus = filter.dataset.status;
    try { await loadOrders(); } catch (error) { showToast(error.message); }
    return;
  }
  const action = event.target.closest('[data-next-status]');
  if (action) {
    action.disabled = true;
    try {
      const { order, allowedTransitions } = await adminRequest(`/api/admin/orders/${encodeURIComponent(action.dataset.orderId)}/status`, {
        method: 'PATCH', body: JSON.stringify({ status: action.dataset.nextStatus })
      });
      renderDetail(order, allowedTransitions);
      await loadOrders();
      showToast(`Order marked ${order.status}`);
    } catch (error) { action.disabled = false; showToast(error.message); }
    return;
  }
  const customerStatus = event.target.closest('[data-customer-status]');
  if (customerStatus) {
    const customerId = customerStatus.dataset.customerStatus;
    const currentActive = customerStatus.dataset.customerActive === 'true';
    const nextActive = !currentActive;

    customerStatus.disabled = true;

    try {
      const result = await adminRequest(
        `/api/admin/customers/${encodeURIComponent(customerId)}/status`,
        {
          method: 'PATCH',
          body: JSON.stringify({ active: nextActive })
        }
      );

      await loadCustomers();
      await openCustomer(result.customer.id);

      showToast(nextActive ? 'Customer activated' : 'Customer deactivated');
    } catch (error) {
      customerStatus.disabled = false;
      showToast(error.message);
    }

    return;
  }

  const customerView = event.target.closest('[data-customer-view]');
  if (customerView) {
    await openCustomer(customerView.dataset.customerView);
    return;
  }

  const row = event.target.closest('[data-order-id]');
  if (row) {
    openOrder(row.dataset.orderId);
    return;
  }
  const productRow = event.target.closest('[data-product-id]');
  if (productRow) openProductForm(productsById.get(productRow.dataset.productId));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.body.classList.contains('admin-invoice-open')) { closeAdminInvoice(); return; }
  if (event.key === 'Escape' && document.body.classList.contains('detail-open')) closeDetail();
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-order-id]')) {
    event.preventDefault();
    openOrder(event.target.dataset.orderId);
  }
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-product-id]')) {
    event.preventDefault();
    openProductForm(productsById.get(event.target.dataset.productId));
  }
});

if (adminKey) loadOrders().catch((error) => showLogin(error.message));

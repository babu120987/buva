const storageKey = 'buvaAdminKey';
const productDraftKey = 'buvaNewProductDraft';
const loginView = document.querySelector('[data-login-view]');
const dashboard = document.querySelector('[data-dashboard]');
const ordersBody = document.querySelector('[data-orders-body]');
const productsBody = document.querySelector('[data-products-body]');
const detailDrawer = document.querySelector('.detail-drawer');
const detailContent = document.querySelector('[data-detail-content]');
const toast = document.querySelector('[data-toast]');
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

const renderSummary = (summary) => {
  Object.entries(summary).forEach(([key, value]) => {
    const root = document.querySelector(`[data-stat="${key}"]`);
    if (!root) return;
    root.textContent = key === 'revenuePaise' ? formatPrice(value) : value;
  });
};

const renderOrders = (orders) => {
  if (!orders.length) {
    ordersBody.innerHTML = '<tr><td colspan="6" class="empty-state">No orders match this view.</td></tr>';
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
    </tr>`).join('');
};

const loadOrders = async () => {
  ordersBody.innerHTML = '<tr><td colspan="6" class="empty-state">Loading orders…</td></tr>';
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

const renderProductSummary = (summary) => {
  Object.entries(summary).forEach(([key, value]) => {
    const root = document.querySelector(`[data-product-stat="${key}"]`);
    if (root) root.textContent = value;
  });
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
  const actions = allowedTransitions.length
    ? allowedTransitions.map((status) => `<button class="status-action${status === 'cancelled' || status === 'returned' ? ' danger' : ''}" type="button" data-next-status="${status}" data-order-id="${escapeHtml(order.id)}">Mark ${escapeHtml(status)}</button>`).join('')
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
      ${order.customerNotes ? `<section class="detail-section"><h3>Customer notes</h3><p class="address">${escapeHtml(order.customerNotes)}</p></section>` : ''}
      <section class="detail-section"><h3>Update status</h3><div class="status-actions">${actions}</div></section>
    </div>`;
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

document.querySelector('[data-product-search-form]').addEventListener('submit', async (event) => {
  event.preventDefault();
  activeProductSearch = new FormData(event.currentTarget).get('search').trim();
  try { await loadProducts(); } catch (error) { showToast(error.message); }
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

document.addEventListener('click', async (event) => {
  if (event.target.closest('[data-logout]')) return showLogin();
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

  if (event.target.closest('.detail-drawer')) return;
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
  const row = event.target.closest('[data-order-id]');
  if (row) {
    openOrder(row.dataset.orderId);
    return;
  }
  const productRow = event.target.closest('[data-product-id]');
  if (productRow) openProductForm(productsById.get(productRow.dataset.productId));
});

document.addEventListener('keydown', (event) => {
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

(() => {
  if (document.body.dataset.invoicePage === 'auto' && !new URLSearchParams(location.search).has('number')) {
    location.replace('index.html#account');
    return;
  }
  const page = document.body.dataset.invoicePage === 'auto'
    ? (new URLSearchParams(location.search).has('number') ? 'detail' : 'list')
    : document.body.dataset.invoicePage;
  if (!page) return;

  const tokenKey = 'buvaCustomerToken';
  const stateRoot = document.querySelector('[data-invoice-state]');
  const formatMoney = (paise) => new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', minimumFractionDigits: 2
  }).format(Number(paise) / 100);
  const formatDate = (value) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(value));
  const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
  const label = (value) => String(value || 'not available').replaceAll('_', ' ');

  const getToken = () => {
    try { return sessionStorage.getItem(tokenKey) || ''; } catch (_error) { return ''; }
  };

  const request = async (path) => {
    const token = getToken();
    if (!token) {
      const error = new Error('Sign in to view your invoices.');
      error.status = 401;
      throw error;
    }
    const response = await fetch(path, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || 'We could not load your invoice.');
      error.status = response.status;
      throw error;
    }
    return payload;
  };

  const renderState = ({ title, message, action = '', loading = false }) => {
    stateRoot.hidden = false;
    stateRoot.setAttribute('aria-busy', String(loading));
    stateRoot.innerHTML = `${loading ? '<span class="invoice-loader" aria-hidden="true"></span>' : ''}
      ${title ? `<h2>${escapeHtml(title)}</h2>` : ''}<p>${escapeHtml(message)}</p>${action}`;
  };

  const renderError = (error) => {
    if (error.status === 401) {
      renderState({
        title: 'Your invoices are private',
        message: 'Sign in with the account used at checkout to continue.',
        action: '<a class="button account-link" href="#account">Sign in</a>'
      });
      return;
    }
    renderState({
      title: error.status === 404 ? 'Invoice not found' : 'Unable to load invoices',
      message: error.status === 404 ? 'This invoice does not exist or does not belong to your account.' : error.message,
      action: '<button class="button ghost" type="button" data-invoice-retry>Try again</button>'
    });
  };

  const paymentStatus = (invoice) => `<span class="invoice-status status-${escapeHtml(invoice.paymentStatus)}">${escapeHtml(label(invoice.paymentStatus))}</span><small>${escapeHtml(label(invoice.paymentMethod))}</small>`;

  const loadList = async () => {
    const list = document.querySelector('[data-invoice-list]');
    document.querySelector('[data-invoice-heading]')?.removeAttribute('hidden');
    document.querySelector('[data-invoice-detail-actions]')?.setAttribute('hidden', '');
    document.querySelector('main')?.classList.replace('invoice-detail-page', 'invoice-page');
    document.title = 'Your Invoices — Buva Chennai';
    list.hidden = true;
    renderState({ message: 'Loading your invoices…', loading: true });
    try {
      const { invoices } = await request('/api/invoices');
      if (!invoices.length) {
        renderState({ title: 'No invoices yet', message: 'Invoices from purchases made while signed in will appear here.', action: '<a class="button" href="service.html">Shop fragrances</a>' });
        return;
      }
      document.querySelector('[data-invoice-rows]').innerHTML = invoices.map((invoice) => {
        const href = `invoice.html?number=${encodeURIComponent(invoice.invoiceNumber)}`;
        return `<tr><td><a class="invoice-number" href="${href}">${escapeHtml(invoice.invoiceNumber)}</a></td><td>${formatDate(invoice.issuedAt)}</td><td class="invoice-amount">${formatMoney(invoice.totalPaise)}</td><td class="invoice-payment">${paymentStatus(invoice)}</td><td><span>${escapeHtml(invoice.orderNumber)}</span><small>${escapeHtml(label(invoice.orderStatus))}</small></td><td><div class="invoice-actions"><a href="${href}">View</a><a href="${href}&print=1">Print / PDF</a></div></td></tr>`;
      }).join('');
      stateRoot.hidden = true;
      stateRoot.setAttribute('aria-busy', 'false');
      list.hidden = false;
    } catch (error) { renderError(error); }
  };

  const addressMarkup = (address = {}) => [address.recipientName, address.line1, address.line2, [address.city, address.state, address.postalCode].filter(Boolean).join(', '), address.countryCode].filter(Boolean).map((part) => escapeHtml(part)).join('<br>');

  const renderDocument = (invoice) => {
    const documentRoot = document.querySelector('[data-invoice-document]');
    const paymentReference = invoice.providerPaymentId || invoice.providerOrderId || 'Not applicable';
    const taxRows = invoice.igstPaise > 0
      ? `<div><span>IGST (18%)</span><strong>${formatMoney(invoice.igstPaise)}</strong></div>`
      : `<div><span>CGST (9%)</span><strong>${formatMoney(invoice.cgstPaise)}</strong></div><div><span>SGST (9%)</span><strong>${formatMoney(invoice.sgstPaise)}</strong></div>`;
    documentRoot.innerHTML = `
      <header class="invoice-document-head"><div><a class="brand" href="index.html">BU<span>V</span>A</a><p>Modern Indian Perfumery<br>Chennai, Tamil Nadu · India</p></div><div><p class="eyebrow">Tax invoice</p><h1>${escapeHtml(invoice.invoiceNumber)}</h1><p>Issued ${formatDate(invoice.issuedAt)}</p></div></header>
      <section class="invoice-parties"><div><h2>Bill to</h2><strong>${escapeHtml(invoice.customerName)}</strong><p>${addressMarkup(invoice.billingAddress)}</p><p>${escapeHtml(invoice.email)}<br>${escapeHtml(invoice.phone)}</p></div><div><h2>Order & payment</h2><dl><dt>Order</dt><dd>${escapeHtml(invoice.orderNumber)}</dd><dt>Order date</dt><dd>${formatDate(invoice.orderCreatedAt)}</dd><dt>Order status</dt><dd>${escapeHtml(label(invoice.orderStatus))}</dd><dt>Payment</dt><dd>${escapeHtml(label(invoice.paymentStatus))} · ${escapeHtml(label(invoice.paymentMethod))}</dd><dt>Reference</dt><dd>${escapeHtml(paymentReference)}</dd></dl></div></section>
      <div class="invoice-lines-wrap"><table class="invoice-lines"><thead><tr><th>Item</th><th>SKU</th><th>Qty</th><th>Unit price</th><th>GST</th><th>Amount</th></tr></thead><tbody>${invoice.items.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.sku)}</td><td>${item.quantity}</td><td>${formatMoney(item.unitPricePaise)}</td><td>${item.taxRatePercent}% incl.</td><td>${formatMoney(item.lineTotalPaise)}</td></tr>`).join('')}</tbody></table></div>
      <section class="invoice-summary"><p>All prices are GST-inclusive. Place of supply: ${escapeHtml(invoice.billingAddress?.state || 'India')}.</p><div class="invoice-totals"><div><span>Subtotal</span><strong>${formatMoney(invoice.subtotalPaise)}</strong></div>${invoice.discountPaise ? `<div><span>Discount</span><strong>−${formatMoney(invoice.discountPaise)}</strong></div>` : ''}<div><span>Shipping</span><strong>${formatMoney(invoice.shippingPaise)}</strong></div><div><span>Taxable value</span><strong>${formatMoney(invoice.taxablePaise)}</strong></div>${taxRows}<div class="invoice-grand-total"><span>Total</span><strong>${formatMoney(invoice.totalPaise)}</strong></div><div><span>Payment status</span><strong class="payment-label">${escapeHtml(label(invoice.paymentStatus))}</strong></div></div></section>
      <footer class="invoice-document-foot"><p>Thank you for choosing Buva.</p><p>Invoice currency: ${escapeHtml(invoice.currency)}</p></footer>`;
    document.title = `${invoice.invoiceNumber} — Buva Chennai`;
    stateRoot.hidden = true;
    stateRoot.setAttribute('aria-busy', 'false');
    documentRoot.hidden = false;
    const printButton = document.querySelector('[data-print-invoice]');
    printButton.hidden = false;
  };

  const loadDetail = async () => {
    const params = new URLSearchParams(location.search);
    document.querySelector('[data-invoice-heading]')?.setAttribute('hidden', '');
    document.querySelector('[data-invoice-detail-actions]')?.removeAttribute('hidden');
    document.querySelector('[data-invoice-list]')?.setAttribute('hidden', '');
    document.querySelector('main')?.classList.replace('invoice-page', 'invoice-detail-page');
    const invoiceNumber = (params.get('number') || '').trim().toUpperCase();
    document.querySelector('[data-invoice-document]').hidden = true;
    document.querySelector('[data-print-invoice]').hidden = true;
    if (!/^INV-[A-Z0-9-]{8,59}$/.test(invoiceNumber)) {
      renderError(Object.assign(new Error('Choose an invoice from your invoice list.'), { status: 404 }));
      return;
    }
    renderState({ message: 'Loading invoice…', loading: true });
    try {
      const { invoice } = await request(`/api/invoices/${encodeURIComponent(invoiceNumber)}`);
      renderDocument(invoice);
      if (params.get('print') === '1') window.setTimeout(() => window.print(), 150);
    } catch (error) { renderError(error); }
  };

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-print-invoice]')) window.print();
    if (event.target.closest('[data-invoice-retry]')) (page === 'list' ? loadList() : loadDetail());
  });

  window.addEventListener('buva:account-changed', () => (page === 'list' ? loadList() : loadDetail()));

  if (page === 'list') loadList();
  else loadDetail();
})();

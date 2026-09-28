(() => {
  const root = document.querySelector('[data-product-page]');
  const slug = new URLSearchParams(location.search).get('slug');
  const escape = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const money = (paise) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100);
  const setMeta = (selector, attributes, content) => {
    let element = document.head.querySelector(selector);
    if (!element) {
      element = document.createElement('meta');
      Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
      document.head.appendChild(element);
    }
    element.setAttribute('content', content);
  };
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    setMeta('meta[name="robots"]', { name: 'robots' }, 'noindex');
    root.textContent = 'Choose a product from the collection.';
    return;
  }
  fetch(`/api/products/${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } })
    .then(async (response) => {
      if (response.status === 404) setMeta('meta[name="robots"]', { name: 'robots' }, 'noindex');
      if (!response.ok) throw new Error('Product unavailable.');
      return response.json();
    })
    .then(({ product, reviews }) => {
      const productUrl = `https://buva.shop/product.html?slug=${encodeURIComponent(product.slug)}`;
      const imageUrl = new URL(product.imageUrl || 'perfume.jpg', 'https://buva.shop/').href;
      const productDescription = product.shortDescription || product.description || `${product.name} ${product.concentration} by BUVA Chennai.`;
      const productType = product.concentration;
      const metaDescription = `Explore ${product.name} ${productType} by BUVA Chennai. ${productDescription}`.slice(0, 160);
      document.title = `${product.name} ${productType} | BUVA Chennai`;
      setMeta('meta[name="description"]', { name: 'description' }, metaDescription);
      setMeta('meta[property="og:type"]', { property: 'og:type' }, 'product');
      setMeta('meta[property="og:title"]', { property: 'og:title' }, document.title);
      setMeta('meta[property="og:description"]', { property: 'og:description' }, metaDescription);
      setMeta('meta[property="og:url"]', { property: 'og:url' }, productUrl);
      setMeta('meta[property="og:image"]', { property: 'og:image' }, imageUrl);
      setMeta('meta[name="twitter:card"]', { name: 'twitter:card' }, 'summary_large_image');
      setMeta('meta[name="twitter:title"]', { name: 'twitter:title' }, document.title);
      setMeta('meta[name="twitter:description"]', { name: 'twitter:description' }, metaDescription);
      let canonical = document.head.querySelector('link[rel="canonical"]');
      if (!canonical) {
        canonical = document.createElement('link');
        canonical.rel = 'canonical';
        document.head.appendChild(canonical);
      }
      canonical.href = productUrl;
      const schema = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: product.name,
        description: productDescription,
        image: imageUrl,
        url: productUrl,
        brand: { '@type': 'Brand', name: 'BUVA' },
        ...(product.sku ? { sku: product.sku } : {}),
        offers: {
          '@type': 'Offer',
          url: productUrl,
          priceCurrency: 'INR',
          price: (product.pricePaise / 100).toFixed(2),
          availability: product.availableQuantity > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'
        },
        ...(product.reviewCount > 0 && product.averageRating > 0 ? { aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: product.averageRating,
          reviewCount: product.reviewCount
        } } : {})
      };
      const structuredData = document.createElement('script');
      structuredData.type = 'application/ld+json';
      structuredData.textContent = JSON.stringify(schema);
      document.head.appendChild(structuredData);
      const summary = product.shortDescription ? `<p><strong>At a glance</strong><br>${escape(product.shortDescription)}</p>` : '';
      const description = product.description ? `<p>${escape(product.description)}</p>` : '';
      root.removeAttribute('role');
      root.innerHTML = `<div class="buva-product-page"><img src="${escape(product.imageUrl || 'perfume.jpg')}" alt="${escape(product.imageAlt || `${product.name} ${product.concentration} by BUVA Chennai`)}"><div><p class="eyebrow">${escape(product.categoryName || product.scentFamily)}</p><h1>${escape(product.name)} ${escape(product.concentration)}</h1>${summary}${description}<dl class="product-detail-facts"><div><dt>Concentration / type</dt><dd>${escape(product.concentration)}</dd></div><div><dt>Size</dt><dd>${Number(product.sizeMl)} ml</dd></div><div><dt>Availability</dt><dd>${product.availableQuantity > 0 ? `${Number(product.availableQuantity)} available` : 'Sold out'}</dd></div></dl><p class="price">${money(product.pricePaise)}${product.compareAtPricePaise ? ` <s>${money(product.compareAtPricePaise)}</s>` : ''}</p><button class="button quick-add" style="position:static;opacity:1;transform:none" type="button" data-product-id="${escape(product.id)}" data-product="${escape(product.name)}" ${product.availableQuantity > 0 ? '' : 'disabled'}>Add to bag</button><p><a href="service.html">Shop all BUVA fragrances</a></p></div></div><section class="buva-product-reviews"><h2>Customer reviews</h2><p>${Number(product.averageRating || 0)} ★ · ${Number(product.reviewCount || 0)} reviews</p>${reviews.length ? reviews.map((review) => `<article class="public-review"><strong>${Number(review.rating)} ★ · ${escape(review.reviewerName)}</strong><p>${escape(review.reviewText || '')}</p></article>`).join('') : '<p>No approved reviews yet.</p>'}</section>`;
    }).catch((error) => { root.textContent = error.message; });
})();

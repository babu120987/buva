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

document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
document.querySelectorAll('[data-year]').forEach((element) => { element.textContent = new Date().getFullYear(); });

document.querySelector('.contact-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.textContent = 'Thank you — we will be in touch';
  button.disabled = true;
});

let cartCount = 0;
const cartBadges = document.querySelectorAll('.cart-count');
const toast = document.createElement('div');
toast.className = 'toast';
toast.setAttribute('role', 'status');
document.body.appendChild(toast);

document.querySelectorAll('.quick-add').forEach((button) => {
  button.addEventListener('click', () => {
    cartCount += 1;
    cartBadges.forEach((badge) => { badge.textContent = cartCount; });
    toast.textContent = `${button.dataset.product || 'Fragrance'} added to your Buva bag`;
    toast.classList.add('show');
    window.setTimeout(() => toast.classList.remove('show'), 2200);
  });
});

document.querySelectorAll('.filter-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach((item) => item.classList.remove('active'));
    chip.classList.add('active');
    const filter = chip.dataset.filter;
    document.querySelectorAll('.product-card[data-family]').forEach((card) => {
      card.hidden = filter !== 'all' && card.dataset.family !== filter;
    });
  });
});

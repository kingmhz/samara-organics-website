const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = Boolean(navigator.connection?.saveData);
const loader = document.querySelector('.loader');
const loaderStartedAt = performance.now();
const alignHashTarget = (smooth = false) => {
  if (!location.hash) return;
  const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (!target) return;
  const headerOffset = (document.querySelector('header')?.getBoundingClientRect().height || 72) + 14;
  const top = Math.max(0, target.getBoundingClientRect().top + scrollY - headerOffset);
  scrollTo({ top, behavior: smooth && !reduce ? 'smooth' : 'instant' });
};
const dismiss = () => {
  loader?.classList.add('done');
  loader?.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('loading');
  requestAnimationFrame(() => requestAnimationFrame(() => alignHashTarget(false)));
};
addEventListener('load', () => setTimeout(dismiss, Math.max(0, (reduce || saveData ? 80 : 650) - (performance.now() - loaderStartedAt))), { once: true });
setTimeout(dismiss, 3000);
addEventListener('hashchange', () => alignHashTarget(true));

if ('IntersectionObserver' in window && !reduce) {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
  }), { threshold: .1 });
  document.querySelectorAll('.reveal').forEach(element => observer.observe(element));
} else document.querySelectorAll('.reveal').forEach(element => element.classList.add('visible'));

const menu = document.querySelector('.menu'), header = document.querySelector('header');
const primaryNavigation = header?.querySelector('nav');
const closeMenu = (restoreFocus = false) => {
  const wasOpen = header?.classList.contains('open');
  header?.classList.remove('open');
  document.documentElement.classList.remove('nav-open');
  menu?.classList.remove('open');
  menu?.setAttribute('aria-expanded', 'false');
  menu?.setAttribute('aria-label', 'Open navigation');
  if (wasOpen && restoreFocus) menu?.focus({ preventScroll: true });
};
menu?.addEventListener('click', () => {
  const open = !header.classList.contains('open');
  header.classList.toggle('open', open);
  document.documentElement.classList.toggle('nav-open', open);
  menu?.classList.toggle('open', open);
  menu?.setAttribute('aria-expanded', String(open));
  menu?.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  if (open) requestAnimationFrame(() => primaryNavigation?.querySelector('a')?.focus({ preventScroll: true }));
});
primaryNavigation?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => closeMenu(false)));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && header?.classList.contains('open')) {
    event.preventDefault();
    closeMenu(true);
  }
});
document.addEventListener('pointerdown', event => {
  if (header?.classList.contains('open') && !header.contains(event.target)) closeMenu(false);
}, { passive: true });
addEventListener('resize', () => { if (innerWidth > 1100) closeMenu(false); }, { passive: true });

// Story and Promise now live on this single page. Announce which section is
// current without rewriting the hash while a visitor simply scrolls.
const localSectionNavigation = [...(primaryNavigation?.querySelectorAll('a[href*="#"]') || [])]
  .map(link => {
    const url = new URL(link.href, location.href);
    if (url.pathname !== location.pathname || !url.hash) return null;
    return { link, section: document.getElementById(decodeURIComponent(url.hash.slice(1))) };
  })
  .filter(item => item?.section);
let activeLocalSectionLink = null;
const updateLocalSectionNavigation = () => {
  if (!localSectionNavigation.length) return;
  const activationLine = (header?.getBoundingClientRect().height || 72) + Math.min(220, innerHeight * .28);
  let nextActive = null;
  for (const item of localSectionNavigation) {
    const bounds = item.section.getBoundingClientRect();
    if (bounds.top <= activationLine && bounds.bottom > activationLine) nextActive = item.link;
  }
  if (nextActive === activeLocalSectionLink) return;
  for (const { link } of localSectionNavigation) {
    if (link === nextActive) link.setAttribute('aria-current', 'location');
    else if (link.getAttribute('aria-current') === 'location') link.removeAttribute('aria-current');
  }
  activeLocalSectionLink = nextActive;
};

// Catalogue utilities: keep the shared cart count visible and add a subtle reading-progress line.
const cartCount = document.querySelector('.catalogue-header .cart-count');
if (cartCount) {
  try {
    const cart = JSON.parse(localStorage.getItem('samara-cart') || '{}');
    cartCount.textContent = String(Object.values(cart).reduce((total, item) => total + Math.max(0, Number(typeof item === 'number' ? item : item?.qty ?? item?.quantity) || 0), 0));
  } catch { cartCount.textContent = '0'; }
}

// Full product pages use the same live catalogue as checkout, so customers see
// current pricing and ordering status before leaving the detail page.
const productDetailSections = [...document.querySelectorAll('.product-detail[data-product]')];
if (productDetailSections.length) {
  const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  for (const section of productDetailSections) {
    section.querySelector('.detail-cart-cta')?.addEventListener('click', event => {
      if (event.currentTarget.getAttribute('aria-disabled') === 'true') event.preventDefault();
    });
  }
  fetch('/api/catalog', { cache: 'no-store', headers: { Accept: 'application/json' } })
    .then(async response => {
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.products)) throw new Error('Catalogue unavailable');
      const catalogue = new Map(data.products.map(product => [product.name, product]));
      for (const section of productDetailSections) {
        const product = catalogue.get(section.dataset.product);
        const panel = section.querySelector('.detail-commerce');
        const price = panel?.querySelector('[data-live-price]');
        const status = panel?.querySelector('[data-live-stock]');
        const cartAction = section.querySelector('.detail-cart-cta');
        if (!panel || !price || !status || !cartAction || !product) continue;
        price.textContent = `${currency.format(Number(product.price))} / ${product.unit}`;
        panel.dataset.catalogState = product.active ? 'available' : 'unavailable';
        status.innerHTML = product.active ? '<i></i> AVAILABLE TO ORDER' : '<i></i> CURRENTLY UNAVAILABLE';
        cartAction.setAttribute('aria-disabled', String(!product.active));
        if (!product.active) cartAction.innerHTML = 'CURRENTLY UNAVAILABLE <span aria-hidden="true">—</span>';
      }
    })
    .catch(() => {
      for (const section of productDetailSections) {
        const panel = section.querySelector('.detail-commerce');
        panel?.setAttribute('data-catalog-state', 'fallback');
        const price = panel?.querySelector('[data-live-price]');
        const status = panel?.querySelector('[data-live-stock]');
        if (price) price.textContent = 'Confirmed in basket';
        if (status) status.innerHTML = '<i></i> LIVE CHECK AT CHECKOUT';
      }
    });
}
let catalogueProgressFrame = 0;
const updateCatalogueProgress = () => {
  catalogueProgressFrame = 0;
  if (header?.classList.contains('catalogue-header')) {
    const available = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    header.style.setProperty('--catalogue-progress', String(Math.min(1, Math.max(0, scrollY / available))));
  }
  updateLocalSectionNavigation();
};
addEventListener('scroll', () => {
  if (!catalogueProgressFrame) catalogueProgressFrame = requestAnimationFrame(updateCatalogueProgress);
}, { passive: true });
addEventListener('resize', updateCatalogueProgress, { passive: true });
updateCatalogueProgress();

const canTilt = matchMedia('(hover:hover) and (pointer:fine)').matches && !reduce && !saveData;

if (canTilt) document.querySelectorAll('[data-tilt], .detail-art').forEach(element => {
  element.addEventListener('pointermove', event => {
    const box = element.getBoundingClientRect(), x=(event.clientX-box.left)/box.width-.5, y=(event.clientY-box.top)/box.height-.5;
    element.style.transform = `perspective(1000px) rotateY(${x*7}deg) rotateX(${-y*7}deg)`;
  });
  element.addEventListener('pointerleave', () => element.style.transform = '');
});

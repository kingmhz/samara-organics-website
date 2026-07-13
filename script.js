const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = Boolean(navigator.connection?.saveData);
if (saveData) document.body.classList.add('save-data');
const safeStore = {
  get(scope, key, fallback = null) { try { return scope.getItem(key) ?? fallback; } catch { return fallback; } },
  set(scope, key, value) { try { scope.setItem(key, value); } catch { /* Private browsing can deny storage. */ } }
};

// Branded loader: short on first visit, nearly instant on repeat visits.
const loader = document.querySelector('#loader');
const loaderStartedAt = performance.now();
const visited = safeStore.get(sessionStorage, 'samara-loaded');
const dismissLoader = () => {
  loader?.classList.add('done');
  document.body.classList.remove('loading');
  loader?.setAttribute('aria-hidden', 'true');
  safeStore.set(sessionStorage, 'samara-loaded', '1');
};
addEventListener('load', () => {
  const minimum = reduceMotion || visited || saveData ? 80 : 950;
  setTimeout(dismissLoader, Math.max(0, minimum - (performance.now() - loaderStartedAt)));
}, { once: true });
setTimeout(dismissLoader, 3500);

// Premium pointer depth is enabled only on precise pointing devices.
const canHover = matchMedia('(hover: hover) and (pointer: fine)').matches;
const glow = document.querySelector('.cursor-glow');
if (!reduceMotion && !saveData && canHover) {
  let pointerFrame = 0;
  let latestPointer;
  addEventListener('pointermove', event => {
    latestPointer = event;
    if (pointerFrame) return;
    pointerFrame = requestAnimationFrame(() => {
      const current = latestPointer;
      pointerFrame = 0;
    if (glow) {
        glow.style.left = `${current.clientX}px`;
        glow.style.top = `${current.clientY}px`;
    }
      document.querySelectorAll('.hero [data-depth]').forEach(element => {
      const depth = Number(element.dataset.depth);
        element.style.setProperty('--depth-x', `${(current.clientX - innerWidth / 2) * depth}px`);
        element.style.setProperty('--depth-y', `${(current.clientY - innerHeight / 2) * depth}px`);
    });
    });
  }, { passive: true });
} else if (!reduceMotion && !saveData) {
  addEventListener('pointermove', event => {
    if (glow) {
      glow.style.left = `${event.clientX}px`;
      glow.style.top = `${event.clientY}px`;
    }
  }, { passive: true });
}

if (canHover && !reduceMotion) {
  document.querySelectorAll('.product').forEach(card => {
    card.addEventListener('pointermove', event => {
      const box = card.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width - .5;
      const y = (event.clientY - box.top) / box.height - .5;
      card.style.setProperty('--light-x', `${(x + .5) * 100}%`);
      card.style.setProperty('--light-y', `${(y + .5) * 100}%`);
      card.style.transform = `rotateY(${x * 9}deg) rotateX(${-y * 9}deg) translateY(-6px)`;
    });
    card.addEventListener('pointerleave', () => { card.style.transform = ''; card.style.removeProperty('--light-x'); card.style.removeProperty('--light-y'); });
  });

  document.querySelectorAll('.btn, .nav-cta, .text-button').forEach(button => {
    button.addEventListener('pointermove', event => {
      const box = button.getBoundingClientRect();
      const x = (event.clientX - box.left - box.width / 2) * .12;
      const y = (event.clientY - box.top - box.height / 2) * .18;
      button.style.transform = `translate3d(${x}px,${y}px,0)`;
    });
    button.addEventListener('pointerleave', () => button.style.transform = '');
  });
}

// Progressive reveal; content remains visible when IntersectionObserver is unavailable.
if ('IntersectionObserver' in window && !reduceMotion) {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  }), { threshold: .1, rootMargin: '0px 0px -35px' });
  document.querySelectorAll('.reveal').forEach(element => observer.observe(element));
} else {
  document.querySelectorAll('.reveal').forEach(element => element.classList.add('visible'));
}

// Navigation.
const menu = document.querySelector('.menu');
const header = document.querySelector('header');
const closeMenu = () => {
  header?.classList.remove('open');
  menu?.classList.remove('open');
  menu?.setAttribute('aria-expanded', 'false');
};
menu?.addEventListener('click', () => {
  const open = header.classList.toggle('open');
  menu?.classList.toggle('open', open);
  menu?.setAttribute('aria-expanded', String(open));
});
document.querySelectorAll('nav a').forEach(link => link.addEventListener('click', closeMenu));
let scrollTicking = false;
const heroImage = document.querySelector('.hero-image');
const backToTop = document.getElementById('backToTop');
addEventListener('scroll', () => {
  if (scrollTicking) return;
  scrollTicking = true;
  requestAnimationFrame(() => {
    const sy = scrollY;
    header.classList.toggle('scrolled', sy > 40);
    // Parallax: hero image shifts slower than scroll
    if (heroImage && sy < 1200) heroImage.style.setProperty('--hero-scroll', `${sy * .18}px`);
    // Back-to-top visibility
    if (backToTop) backToTop.classList.toggle('visible', sy > 600);
    scrollTicking = false;
  });
}, { passive: true });
// Back-to-top click handler
backToTop?.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));


// Premium Shopping Cart & Multi-step Checkout Logic
const PRODUCTS_INFO = {
  "Organic A2 Milk": { price: 110, unit: "1 L", img: "assets/samara-milk-bottle.webp", active: true },
  "Bilona Desi Ghee": { price: 749, unit: "500 ML", img: "assets/samara-ghee-jar.webp", active: true },
  "Traditional Dahi": { price: 89, unit: "500 ML", img: "assets/samara-dahi-bowl.webp", active: true }
};
let catalogPromise;
const loadCatalog = () => catalogPromise ||= fetch('/api/catalog').then(async response => {
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.message || 'Catalog unavailable.');
  for (const product of data.products) if (PRODUCTS_INFO[product.name]) Object.assign(PRODUCTS_INFO[product.name], { price: product.price, unit: product.unit, active: product.active });
  document.querySelectorAll('.product[data-product]').forEach(card => {
    const product = PRODUCTS_INFO[card.dataset.product];
    card.querySelectorAll('.product-action,.product-buy-now').forEach(button => { button.disabled = !product?.active; if (!product?.active) button.textContent = 'UNAVAILABLE'; });
  });
  document.querySelectorAll('#sub-product option').forEach(option => {
    const product = PRODUCTS_INFO[option.value];
    if (!product) return;
    option.disabled = !product.active;
    option.textContent = `${option.value === 'Organic A2 Milk' ? 'Farm Fresh Milk' : option.value} (₹${product.price} / ${product.unit})`;
  });
  const subscriptionProduct = document.querySelector('#sub-product');
  if (subscriptionProduct?.selectedOptions[0]?.disabled) subscriptionProduct.value = [...subscriptionProduct.options].find(option => !option.disabled)?.value || '';
  return data;
}).catch(error => { catalogPromise = null; throw error; });

const createIdempotencyKey = prefix => `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
let commercePromise;
let commerceReady = false;
const loadCommerce = () => commercePromise ||= Promise.all([import('__COMMERCE_MODULE__'), loadCatalog()]).then(([module]) => {
  module.initCommerce({ safeStore, PRODUCTS_INFO, createIdempotencyKey });
  commerceReady = true;
}).catch(error => { commercePromise = null; throw error; });
const commerceSelector = '.product-action,.product-buy-now,.add-to-cart-btn,.enquiry-fab,.nav-cart-btn,.checkout-btn,.checkout-back-btn,.checkout-submit-btn,.checkout-direct-btn,.success-close-btn,.drawer-close,.cart-clear-btn';
document.addEventListener('pointerenter', event => { if (event.target.closest?.(commerceSelector)) void loadCommerce().catch(() => {}); }, { capture: true, passive: true });
document.addEventListener('focusin', event => { if (event.target.closest?.(commerceSelector)) void loadCommerce().catch(() => {}); });
document.addEventListener('click', async event => {
  const target = event.target.closest?.(commerceSelector);
  if (!target || commerceReady) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  try { await loadCommerce(); target.click(); }
  catch { alert('The live product catalog is temporarily unavailable. Please try again shortly.'); }
}, true);

// Launch-list handoff: validate and open a pre-filled WhatsApp conversation.
const waitlist = document.querySelector('#waitlist');
waitlist?.addEventListener('submit', event => {
  event.preventDefault();
  const input = waitlist.querySelector('input');
  const digits = input.value.replace(/\D/g, '');
  if (digits.length !== 10) {
    input.setCustomValidity('Please enter a valid 10-digit mobile number.');
    input.reportValidity();
    return;
  }
  input.setCustomValidity('');
  safeStore.set(localStorage, 'samara-mobile', digits);
  waitlist.style.display = 'none';
  const success = document.querySelector('.success');
  success.classList.add('show');
  success.innerHTML = `Welcome to Samara. <a href="https://wa.me/918077366897?text=${encodeURIComponent(`Hello Samara Organics, please add +91 ${digits} to the first delivery list.`)}" target="_blank" rel="noopener"><strong>Confirm on WhatsApp →</strong></a>`;
});

// Story Explainer tabs switching logic
const explainerTabs = document.querySelectorAll('.explainer-tab');
const explainerContents = document.querySelectorAll('.explainer-content');

explainerTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    
    explainerTabs.forEach(t => t.classList.remove('active'));
    explainerContents.forEach(c => c.classList.remove('active'));
    
    tab.classList.add('active');
    document.getElementById(`tab-${target}`)?.classList.add('active');
  });
});

// Batch Traceability Checker logic
const batchVerifyBtn = document.querySelector('#batch-verify-btn');
const batchCodeInput = document.querySelector('#batch-code-input');
const batchVerifyResult = document.querySelector('#batch-verify-result');

batchVerifyBtn?.addEventListener('click', () => {
  const code = batchCodeInput.value.trim().toUpperCase();
  if (!code) {
    batchVerifyResult.innerHTML = '<div class="pin-result error">Please enter a valid batch code.</div>';
    return;
  }
  
  batchVerifyResult.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted)">Checking certificate... <span class="spinner-icon" style="border-top-color:var(--gold)"></span></div>';
  
  fetch(`/api/batches/${code}`)
    .then(res => {
      if (!res.ok) {
        throw new Error('Batch code not found.');
      }
      return res.json();
    })
    .then(data => {
      const batch = data.batch;
      
      const antibioticsText = batch.antibiotics === 0 ? 'Negative (Not Detected)' : 'Warning: Detected';
      const scoreColor = batch.quality_score >= 95 ? 'var(--olive)' : 'var(--gold)';
      
      batchVerifyResult.innerHTML = `
        <div class="batch-result-details">
          <div class="batch-result-header">
            <h4>Quality Assurance Certificate</h4>
            <span>PASSED</span>
          </div>
          <div class="batch-result-grid">
            <div class="batch-result-item">
              <label>BATCH ID</label>
              <span>${batch.id}</span>
            </div>
            <div class="batch-result-item">
              <label>PRODUCT TYPE</label>
              <span>${batch.product_name}</span>
            </div>
            <div class="batch-result-item">
              <label>HARVEST DATE</label>
              <span>${batch.date}</span>
            </div>
            <div class="batch-result-item">
              <label>BUTTERFAT LEVEL</label>
              <span>${batch.fat}%</span>
            </div>
            <div class="batch-result-item">
              <label>SNF CONTENT</label>
              <span>${batch.snf}%</span>
            </div>
            <div class="batch-result-item">
              <label>ANTIBIOTIC RESIDUES</label>
              <span style="color: ${batch.antibiotics === 0 ? 'var(--olive)' : '#9a513b'}">${antibioticsText}</span>
            </div>
            <div class="batch-result-score">
              <b>PURITY SCORE</b>
              <span style="color:${scoreColor}">${batch.quality_score}%</span>
            </div>
          </div>
        </div>
      `;
    })
    .catch(err => {
      batchVerifyResult.innerHTML = `<div class="pin-result error" style="color:#9a513b;margin-top:15px">Certificate verification failed: ${err.message}</div>`;
    });
});

if ('serviceWorker' in navigator) {
  if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      for (const registration of registrations) {
        registration.unregister();
        console.log('Unregistered service worker for local development');
      }
    });
    caches.keys().then(names => {
      for (const name of names) {
        caches.delete(name);
        console.log('Cleared cache:', name);
      }
    });
  } else if (location.protocol.startsWith('http')) {
    addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch(() => {}), { once: true });
  }
}

// Load subscription booking only when the visitor shows intent.
const subscriptionButton = document.querySelector('#subscribe-header-btn');
let subscriptionBookingPromise;
const loadSubscriptionBooking = () => subscriptionBookingPromise ||= Promise.all([import('__SUBSCRIPTION_MODULE__'), loadCatalog()]).then(([module]) => module.initSubscriptionBooking({ safeStore, PRODUCTS_INFO, createIdempotencyKey })).catch(error => { subscriptionBookingPromise = null; throw error; });
subscriptionButton?.addEventListener('pointerenter', () => void loadSubscriptionBooking().catch(() => {}), { once: true });
subscriptionButton?.addEventListener('focus', () => void loadSubscriptionBooking().catch(() => {}), { once: true });
subscriptionButton?.addEventListener('click', async () => { try { (await loadSubscriptionBooking()).open(); } catch { alert('Subscriptions are temporarily unavailable. Please try again shortly.'); } });
  // Load farm-tour booking only when the visitor shows intent.
  const tourButton = document.querySelector('#tour-header-btn');
  let farmTourPromise;
  const loadFarmTour = () => farmTourPromise ||= import('__FARM_TOUR_MODULE__').then(module => module.initFarmTour({ safeStore }));
  tourButton?.addEventListener('pointerenter', loadFarmTour, { once: true });
  tourButton?.addEventListener('focus', loadFarmTour, { once: true });
  tourButton?.addEventListener('click', async () => (await loadFarmTour()).open());

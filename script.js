const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = Boolean(navigator.connection?.saveData);
const navigationEntry = performance.getEntriesByType?.('navigation')?.[0];
const isPageReload = navigationEntry?.type === 'reload' || document.documentElement.dataset.reloadFromTop === 'true';

// A deliberate refresh should reopen the homepage from the beginning instead of
// restoring an old #contact hash or the browser's previous bottom-of-page offset.
if (isPageReload) {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (location.hash) history.replaceState(null, '', `${location.pathname}${location.search}`);
  scrollTo({ top: 0, left: 0, behavior: 'auto' });
  requestAnimationFrame(() => scrollTo({ top: 0, left: 0, behavior: 'auto' }));
}
if (saveData) document.body.classList.add('save-data');
const safeStore = {
  get(scope, key, fallback = null) { try { return scope.getItem(key) ?? fallback; } catch { return fallback; } },
  set(scope, key, value) { try { scope.setItem(key, value); } catch { /* Private browsing can deny storage. */ } }
};
const siteNotice = document.querySelector('#site-notice');
let siteNoticeTimer;
const notifySite = (message, tone = 'error') => {
  if (!siteNotice) return;
  clearTimeout(siteNoticeTimer);
  siteNotice.textContent = message;
  siteNotice.classList.toggle('error', tone === 'error');
  siteNotice.classList.add('show');
  siteNoticeTimer = setTimeout(() => siteNotice.classList.remove('show'), 5200);
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

// Keep in-page navigation accurate even when deferred sections change height as
// they enter the viewport. This also leaves every destination below the fixed header.
const alignHomepageSection = (hash, smooth = true) => {
  if (!hash || hash === '#') return false;
  const target = document.getElementById(decodeURIComponent(hash.slice(1)));
  if (!target) return false;

  // Materialise preceding sections before measuring the destination. Without this,
  // content-visibility placeholders can move a deep link back into the product grid.
  for (const section of document.querySelectorAll('main > section')) {
    section.style.contentVisibility = 'visible';
    if (section === target) break;
  }

  const positionTarget = behavior => {
    const headerOffset = (header?.getBoundingClientRect().height || 76) + 12;
    const top = Math.max(0, target.getBoundingClientRect().top + scrollY - headerOffset);
    scrollTo({ top, behavior });
  };
  positionTarget(smooth && !reduceMotion ? 'smooth' : 'auto');

  // Re-measure after deferred sections, responsive images and web fonts settle.
  // This prevents #promise from stopping on the three product cards when their
  // content-visibility placeholder is replaced by the real product-grid height.
  const settleDelays = smooth && !reduceMotion ? [560, 1050] : [80, 260, 760];
  settleDelays.forEach(delay => setTimeout(() => positionTarget('auto'), delay));
  document.fonts?.ready.then(() => positionTarget('auto')).catch(() => {});
  return true;
};

document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (!link) return;
  const hash = link.getAttribute('href');
  if (!hash || !document.getElementById(decodeURIComponent(hash.slice(1)))) return;
  event.preventDefault();
  history.pushState(null, '', hash);
  alignHomepageSection(hash, false);
  closeMenu();
});

addEventListener('load', () => {
  if (isPageReload) {
    scrollTo({ top: 0, left: 0, behavior: 'auto' });
    // Chrome can apply its saved scroll position after the load event. Keep
    // restoration manual for this document and correct the position as deferred
    // images and fonts settle behind the loader.
    [120, 420, 900].forEach(delay => setTimeout(() => {
      scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }, delay));
  } else if (location.hash) {
    requestAnimationFrame(() => requestAnimationFrame(() => alignHomepageSection(location.hash, false)));
  }
}, { once: true });
addEventListener('pageshow', () => {
  if (!isPageReload) return;
  scrollTo({ top: 0, left: 0, behavior: 'auto' });
  requestAnimationFrame(() => scrollTo({ top: 0, left: 0, behavior: 'auto' }));
});
addEventListener('hashchange', () => alignHomepageSection(location.hash, false));

// Keep the long-form homepage navigation oriented without rewriting the URL as
// the visitor scrolls. aria-current="location" gives the same state to keyboard
// and screen-reader users while leaving every link destination untouched.
const sectionNavigation = [...(primaryNavigation?.querySelectorAll('a[href^="#"]') || [])]
  .map(link => ({ link, section: document.getElementById(decodeURIComponent(link.hash.slice(1))) }))
  .filter(item => item.section);
let activeSectionLink = null;
const updateSectionNavigation = () => {
  if (!sectionNavigation.length) return;
  const activationLine = (header?.getBoundingClientRect().height || 76) + Math.min(220, innerHeight * .28);
  let nextActive = null;
  for (const item of sectionNavigation) {
    const bounds = item.section.getBoundingClientRect();
    if (bounds.top <= activationLine && bounds.bottom > activationLine) nextActive = item.link;
  }
  if (scrollY + innerHeight >= document.documentElement.scrollHeight - 3) {
    nextActive = sectionNavigation.find(item => item.section.id === 'contact')?.link || nextActive;
  }
  if (nextActive === activeSectionLink) return;
  for (const { link } of sectionNavigation) {
    if (link === nextActive) link.setAttribute('aria-current', 'location');
    else if (link.getAttribute('aria-current') === 'location') link.removeAttribute('aria-current');
  }
  activeSectionLink = nextActive;
};
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
    updateSectionNavigation();
    scrollTicking = false;
  });
}, { passive: true });
addEventListener('resize', updateSectionNavigation, { passive: true });
updateSectionNavigation();
// Back-to-top click handler
backToTop?.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));


// Premium Shopping Cart & Multi-step Checkout Logic
const PRODUCTS_INFO = {
  "Organic A2 Milk": { price: 110, unit: "1 L", img: "assets/samara-heritage-milk.jpg", active: true },
  "Bilona Desi Ghee": { price: 749, unit: "500 ML", img: "assets/samara-heritage-ghee.jpg", active: true },
  "Traditional Dahi": { price: 89, unit: "500 G", img: "assets/samara-heritage-dahi.jpg", active: true }
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
  catch { notifySite('The live product catalogue is temporarily unavailable. Please try again shortly.'); }
}, true);

// Launch-list handoff: validate and open a pre-filled WhatsApp conversation.
const waitlist = document.querySelector('#waitlist');
waitlist?.querySelector('input')?.addEventListener('input', event => {
  event.target.value = event.target.value.replace(/\D/g, '').slice(0, 10);
  event.target.setCustomValidity('');
});
waitlist?.addEventListener('submit', event => {
  event.preventDefault();
  const input = waitlist.querySelector('input');
  const digits = input.value.replace(/\D/g, '');
  if (!/^[6-9]\d{9}$/.test(digits)) {
    input.setCustomValidity('Please enter a valid 10-digit Indian mobile number.');
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
const batchCheckerForm = document.querySelector('#batch-checker-form');
const batchCodeInput = document.querySelector('#batch-code-input');
const batchVerifyResult = document.querySelector('#batch-verify-result');
batchCodeInput?.addEventListener('input', () => batchCodeInput.setCustomValidity(''));

batchCheckerForm?.addEventListener('submit', event => {
  event.preventDefault();
  const code = batchCodeInput.value.trim().toUpperCase();
  if (!/^[A-Z0-9-]{5,32}$/.test(code)) {
    batchCodeInput.setCustomValidity('Use 5 to 32 letters, numbers or hyphens.');
    batchCodeInput.reportValidity();
    return;
  }
  batchCodeInput.setCustomValidity('');
  batchCheckerForm.setAttribute('aria-busy', 'true');
  batchVerifyBtn.disabled = true;
  batchVerifyResult.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted)">Checking batch record... <span class="spinner-icon" style="border-top-color:var(--gold)"></span></div>';

  fetch(`/api/batches/${encodeURIComponent(code)}`, { cache: 'no-store' })
    .then(async response => {
      let data;
      try { data = await response.json(); }
      catch { throw new Error('The batch service returned an unreadable response. Please try again.'); }
      if (!response.ok || !data.success) throw new Error(data.message || 'Batch quality record not found.');
      return data;
    })
    .then(data => {
      const batch = data.batch;
      
      const antibioticsText = batch.antibiotics === 0 ? 'Not detected in recorded check' : 'Detected — review required';
      const scoreColor = batch.quality_score >= 95 ? 'var(--olive)' : 'var(--gold)';
      const productLabel = batch.product_name === 'Organic A2 Milk' ? 'Farm Fresh Milk' : batch.product_name;
      const recordState = batch.antibiotics === 0 ? 'RECORDED RESULT' : 'REVIEW REQUIRED';
      
      batchVerifyResult.innerHTML = `
        <div class="batch-result-details">
          <div class="batch-result-header">
            <h4>Batch Quality Record</h4>
            <span>${recordState}</span>
          </div>
          <div class="batch-result-grid">
            <div class="batch-result-item">
              <label>BATCH ID</label>
              <span>${batch.id}</span>
            </div>
            <div class="batch-result-item">
              <label>PRODUCT TYPE</label>
              <span>${productLabel}</span>
            </div>
            <div class="batch-result-item">
              <label>PRODUCTION DATE</label>
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
              <b>RECORDED QUALITY SCORE</b>
              <span style="color:${scoreColor}">${batch.quality_score}%</span>
            </div>
          </div>
          <p class="batch-record-note">This record reports only the checks listed for this identified batch. It is not an organic certification or an A2 laboratory certificate.</p>
        </div>
      `;
    })
    .catch(err => {
      const errorMessage = document.createElement('div');
      errorMessage.className = 'pin-result error';
      errorMessage.style.cssText = 'color:#9a513b;margin-top:15px';
      errorMessage.textContent = `Batch record lookup failed: ${err.message}`;
      batchVerifyResult.replaceChildren(errorMessage);
    })
    .finally(() => {
      batchCheckerForm.removeAttribute('aria-busy');
      batchVerifyBtn.disabled = false;
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
subscriptionButton?.addEventListener('click', async () => { try { (await loadSubscriptionBooking()).open(); } catch { notifySite('Subscriptions are temporarily unavailable. Please try again shortly.'); } });
  // Load farm-tour booking only when the visitor shows intent.
const tourButton = document.querySelector('#tour-header-btn');
let farmTourPromise;
const loadFarmTour = () => farmTourPromise ||= import('__FARM_TOUR_MODULE__')
  .then(module => module.initFarmTour({ safeStore }))
  .catch(error => { farmTourPromise = null; throw error; });
tourButton?.addEventListener('pointerenter', () => { loadFarmTour().catch(() => {}); }, { once: true });
tourButton?.addEventListener('focus', () => { loadFarmTour().catch(() => {}); }, { once: true });
tourButton?.addEventListener('click', async () => {
  try { (await loadFarmTour()).open(); }
  catch { notifySite('Farm-tour booking is temporarily unavailable. Please try again shortly.'); }
});

// Allow secondary pages to hand visitors back to the matching homepage utility.
const requestedPanel = new URLSearchParams(location.search).get('open');
const requestedPanelSelector = {
  subscribe: '#subscribe-header-btn',
  tour: '#tour-header-btn',
  cart: '.nav-cart-btn'
}[requestedPanel];
if (requestedPanelSelector) addEventListener('load', () => {
  const openWhenReady = () => {
    if (document.body.classList.contains('loading')) { setTimeout(openWhenReady, 80); return; }
    history.replaceState(null, '', `${location.pathname}${location.hash}`);
    document.querySelector(requestedPanelSelector)?.click();
  };
  openWhenReady();
}, { once: true });

// Product detail pages hand off to the live catalogue before adding anything.
// This keeps price, availability and cart behaviour in one authoritative flow.
const requestedProduct = new URLSearchParams(location.search).get('add');
if (requestedProduct) addEventListener('load', () => {
  const addWhenReady = async () => {
    if (document.body.classList.contains('loading')) { setTimeout(addWhenReady, 80); return; }
    history.replaceState(null, '', `${location.pathname}${location.hash}`);
    if (!Object.prototype.hasOwnProperty.call(PRODUCTS_INFO, requestedProduct)) return;
    try {
      await loadCommerce();
      const productCard = [...document.querySelectorAll('.product[data-product]')].find(card => card.dataset.product === requestedProduct);
      const addButton = productCard?.querySelector('.product-action');
      if (!addButton || addButton.disabled) {
        notifySite('This product is currently unavailable for ordering. Please check again soon.');
        return;
      }
      addButton.click();
    } catch {
      notifySite('The live product catalogue is temporarily unavailable. Please try again shortly.');
    }
  };
  addWhenReady();
}, { once: true });

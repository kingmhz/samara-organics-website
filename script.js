const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = Boolean(navigator.connection?.saveData);
if (saveData) document.body.classList.add('save-data');
const safeStore = {
  get(scope, key, fallback = null) { try { return scope.getItem(key) ?? fallback; } catch { return fallback; } },
  set(scope, key, value) { try { scope.setItem(key, value); } catch { /* Private browsing can deny storage. */ } }
};

// Branded loader: short on first visit, nearly instant on repeat visits.
const loader = document.querySelector('#loader');
const visited = safeStore.get(sessionStorage, 'samara-loaded');
const dismissLoader = () => {
  loader?.classList.add('done');
  document.body.classList.remove('loading');
  safeStore.set(sessionStorage, 'samara-loaded', '1');
};
addEventListener('load', () => setTimeout(dismissLoader, reduceMotion || visited || saveData ? 120 : 2050), { once: true });
setTimeout(dismissLoader, 3500);

// Premium pointer depth is enabled only on precise pointing devices.
const canHover = matchMedia('(hover: hover) and (pointer: fine)').matches;
const glow = document.querySelector('.cursor-glow');
if (!reduceMotion && !saveData && canHover) {
  addEventListener('pointermove', event => {
    if (glow) {
      glow.style.left = `${event.clientX}px`;
      glow.style.top = `${event.clientY}px`;
    }
    document.querySelectorAll('[data-depth]').forEach(element => {
      const depth = Number(element.dataset.depth);
      const x = (event.clientX - innerWidth / 2) * depth;
      const y = (event.clientY - innerHeight / 2) * depth;
      element.style.transform = `translate3d(${x}px,${y}px,0)`;
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
      card.style.transform = `rotateY(${x * 9}deg) rotateX(${-y * 9}deg) translateY(-6px)`;
    });
    card.addEventListener('pointerleave', () => card.style.transform = '');
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
    if (heroImage && sy < 1200) heroImage.style.transform = `translateY(${sy * 0.35}px) scale(1.03)`;
    // Back-to-top visibility
    if (backToTop) backToTop.classList.toggle('visible', sy > 600);
    scrollTicking = false;
  });
}, { passive: true });
// Back-to-top click handler
backToTop?.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));


// Premium Shopping Cart & Multi-step Checkout Logic
const PRODUCTS_INFO = {
  "Organic A2 Milk": { price: 110, unit: "1 L", img: "assets/samara-milk-bottle.webp" },
  "Bilona Desi Ghee": { price: 749, unit: "500 ML", img: "assets/samara-ghee-jar.webp" },
  "Traditional Dahi": { price: 89, unit: "500 ML", img: "assets/samara-dahi-bowl.webp" }
};

let cart = {};
try {
  const raw = JSON.parse(safeStore.get(localStorage, 'samara-cart', '{}'));
  for (const key in raw) {
    if (typeof raw[key] === 'number') {
      cart[key] = { qty: raw[key], delivery: key === 'Organic A2 Milk' ? 'daily' : 'one-time' };
    } else {
      cart[key] = raw[key];
    }
  }
} catch {
  cart = {};
}

const drawer = document.querySelector('.drawer');
const backdrop = document.querySelector('.drawer-backdrop');
const fab = document.querySelector('.enquiry-fab');
const headerCartBtn = document.querySelector('.nav-cart-btn');
const drawerItems = document.querySelector('.drawer-items');
const drawerEmpty = document.querySelector('.drawer-empty');
const cartView = document.querySelector('.drawer-cart-view');
const checkoutView = document.querySelector('.drawer-checkout-view');
const successView = document.querySelector('.drawer-success-view');

const checkoutBtn = document.querySelector('.checkout-btn');
const checkoutBackBtn = document.querySelector('.checkout-back-btn');
const checkoutForm = document.querySelector('#checkout-form');
const successCloseBtn = document.querySelector('.success-close-btn');
const cartClearBtn = document.querySelector('.cart-clear-btn');

let drawerReturnFocus = null;

cartClearBtn?.addEventListener('click', () => {
  cart = {};
  renderCart();
});

function showView(view) {
  if (cartView) cartView.style.display = view === 'cart' ? 'flex' : 'none';
  if (checkoutView) checkoutView.style.display = view === 'checkout' ? 'flex' : 'none';
  if (successView) successView.style.display = view === 'success' ? 'flex' : 'none';
  
  // Premium optimization: reset drawer scroll top
  if (drawer) drawer.scrollTop = 0;
  
  const title = document.querySelector('#drawer-title');
  if (title) {
    if (view === 'cart') title.textContent = 'Shopping Cart';
    else if (view === 'checkout') title.textContent = 'Delivery Details';
    else if (view === 'success') title.textContent = 'Success';
  }
}

function openDrawer() {
  drawerReturnFocus = document.activeElement;
  if (drawer) drawer.classList.add('open');
  if (backdrop) backdrop.classList.add('show');
  if (drawer) drawer.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  showView('cart');
  const closeBtn = document.querySelector('.drawer-close');
  if (closeBtn) closeBtn.focus();
}

function closeDrawer() {
  if (drawer) drawer.classList.remove('open');
  if (backdrop) backdrop.classList.remove('show');
  if (drawer) drawer.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (drawerReturnFocus instanceof HTMLElement) drawerReturnFocus.focus();
}

function updateCartCount() {
  let totalCount = 0;
  for (const item in cart) {
    totalCount += cart[item].qty;
  }
  
  const counts = document.querySelectorAll('.cart-count, .enquiry-fab span');
  counts.forEach(el => el.textContent = totalCount);
  
  if (fab) {
    fab.style.display = totalCount > 0 ? 'flex' : 'none';
  }
}

function updateUPILink(amount) {
  const upiPayBtn = document.querySelector('.upi-mobile-pay-btn');
  if (upiPayBtn) {
    const pa = '8077366897@okbizaxis';
    const pn = 'Samara Organics';
    const message = 'Samara Organics Order';
    const url = `upi://pay?pa=${pa}&pn=${encodeURIComponent(pn)}&am=${amount}&cu=INR&tn=${encodeURIComponent(message)}`;
    upiPayBtn.href = url;
  }
}

function renderCart() {
  safeStore.set(localStorage, 'samara-cart', JSON.stringify(cart));
  updateCartCount();
  
  const items = Object.keys(cart);
  const foot = document.querySelector('.drawer-foot');
  
  if (cartClearBtn) {
    cartClearBtn.style.display = items.length > 0 ? 'block' : 'none';
  }
  
  if (items.length === 0) {
    if (drawerItems) drawerItems.innerHTML = '';
    if (drawerEmpty) drawerEmpty.style.display = 'block';
    if (foot) foot.style.display = 'none';
    return;
  }
  
  if (drawerEmpty) drawerEmpty.style.display = 'none';
  if (foot) foot.style.display = 'block';
  
  let subtotal = 0;
  
  if (drawerItems) {
    drawerItems.innerHTML = items.map(name => {
      const qty = cart[name].qty;
      const delivery = cart[name].delivery || 'one-time';
      const info = PRODUCTS_INFO[name] || { price: 0, unit: "", img: "" };
      const itemTotal = info.price * qty;
      subtotal += itemTotal;
      
      const deliverySelectHtml = name === 'Organic A2 Milk' ? `
        <div class="drawer-item-delivery-type">
          <select class="item-delivery-select" data-name="${name}">
            <option value="one-time" ${delivery === 'one-time' ? 'selected' : ''}>One-Time Delivery</option>
            <option value="daily" ${delivery === 'daily' ? 'selected' : ''}>Daily Subscription (₹${info.price}/day)</option>
            <option value="alternate" ${delivery === 'alternate' ? 'selected' : ''}>Alternate Days (₹${info.price}/day)</option>
            <option value="weekend" ${delivery === 'weekend' ? 'selected' : ''}>Weekends Only (₹${info.price}/day)</option>
          </select>
        </div>
      ` : '';
      
      return `
        <div class="drawer-item" data-name="${name}">
          <img src="${info.img}" alt="${name}" class="drawer-item-img">
          <div class="drawer-item-details">
            <h4 class="drawer-item-name">${name}</h4>
            <span class="drawer-item-price">₹${info.price} / ${info.unit}</span>
          </div>
          <div class="drawer-item-qty-control">
            <button type="button" class="drawer-item-qty-btn qty-minus" aria-label="Decrease quantity">−</button>
            <span class="drawer-item-qty-val">${qty}</span>
            <button type="button" class="drawer-item-qty-btn qty-plus" aria-label="Increase quantity">+</button>
          </div>
          <span class="drawer-item-total">₹${itemTotal}</span>
          <button type="button" class="drawer-item-remove" aria-label="Remove item">×</button>
          ${deliverySelectHtml}
        </div>
      `;
    }).join('');
  }
  
  const subtotalVal = document.querySelector('.subtotal-val');
  const totalVal = document.querySelector('.total-val');
  if (subtotalVal) subtotalVal.textContent = `₹${subtotal}`;
  if (totalVal) totalVal.textContent = `₹${subtotal}`;
  
  updateUPILink(subtotal);
}

function addToCart(name) {
  if (!cart[name]) {
    cart[name] = { qty: 1, delivery: name === 'Organic A2 Milk' ? 'daily' : 'one-time' };
  } else {
    cart[name].qty++;
  }
  renderCart();
  openDrawer();
}

document.querySelectorAll('.product-action').forEach(button => {
  button.addEventListener('click', event => {
    event.stopPropagation();
    const product = button.closest('.product').dataset.product;
    addToCart(product);
  });
});

function buyNow(name) {
  if (!cart[name]) {
    cart[name] = { qty: 1, delivery: name === 'Organic A2 Milk' ? 'daily' : 'one-time' };
  }
  renderCart();
  openDrawer();
  
  showView('checkout');
  
  const nameInput = document.querySelector('#checkout-name');
  const phoneInput = document.querySelector('#checkout-phone');
  const pinInput = document.querySelector('#checkout-pincode');
  
  if (nameInput) nameInput.value = safeStore.get(localStorage, 'samara-name', '');
  if (phoneInput) phoneInput.value = safeStore.get(localStorage, 'samara-mobile', '');
  if (pinInput) pinInput.value = safeStore.get(localStorage, 'samara-pincode', '');
  
  setTimeout(() => {
    if (nameInput) nameInput.focus();
  }, 120);
}

document.querySelectorAll('.product-buy-now').forEach(button => {
  button.addEventListener('click', event => {
    event.stopPropagation();
    const product = button.closest('.product').dataset.product;
    buyNow(product);
  });
});

headerCartBtn?.addEventListener('click', openDrawer);
fab?.addEventListener('click', openDrawer);
document.querySelector('.drawer-close')?.addEventListener('click', closeDrawer);
backdrop?.addEventListener('click', closeDrawer);

drawerItems?.addEventListener('click', event => {
  const itemEl = event.target.closest('.drawer-item');
  if (!itemEl) return;
  
  const name = itemEl.dataset.name;
  
  if (event.target.classList.contains('qty-minus')) {
    if (cart[name].qty > 1) {
      cart[name].qty--;
    } else {
      delete cart[name];
    }
    renderCart();
  } else if (event.target.classList.contains('qty-plus')) {
    cart[name].qty++;
    renderCart();
  } else if (event.target.classList.contains('drawer-item-remove')) {
    delete cart[name];
    renderCart();
  }
});

drawerItems?.addEventListener('change', event => {
  if (event.target.classList.contains('item-delivery-select')) {
    const name = event.target.dataset.name;
    if (cart[name]) {
      cart[name].delivery = event.target.value;
      renderCart();
    }
  }
});

checkoutBtn?.addEventListener('click', () => {
  showView('checkout');
  
  const nameInput = document.querySelector('#checkout-name');
  const phoneInput = document.querySelector('#checkout-phone');
  const pinInput = document.querySelector('#checkout-pincode');
  
  if (nameInput) nameInput.value = safeStore.get(localStorage, 'samara-name', '');
  if (phoneInput) phoneInput.value = safeStore.get(localStorage, 'samara-mobile', '');
  if (pinInput) pinInput.value = safeStore.get(localStorage, 'samara-pincode', '');
  
  // Premium optimization: autofocus name input field and filter phone inputs
  setTimeout(() => {
    if (nameInput) nameInput.focus();
  }, 120);
});

checkoutBackBtn?.addEventListener('click', () => {
  showView('cart');
});

// Filter phone inputs in real-time
document.querySelector('#checkout-phone')?.addEventListener('input', e => {
  e.target.value = e.target.value.replace(/\D/g, '');
});

// Manage Payment Option Changes in Checkout Form
const paymentOptions = document.querySelectorAll('input[name="checkout-payment"]');
const upiBox = document.querySelector('.upi-sandbox-box');
const utrInput = document.querySelector('#checkout-utr');

paymentOptions.forEach(radio => {
  radio.addEventListener('change', () => {
    paymentOptions.forEach(r => r.closest('.payment-method-option').classList.remove('active'));
    radio.closest('.payment-method-option').classList.add('active');
    
    if (radio.value === 'UPI') {
      if (upiBox) upiBox.style.display = 'block';
      if (utrInput) utrInput.required = true;
    } else {
      if (upiBox) upiBox.style.display = 'none';
      if (utrInput) {
        utrInput.required = false;
        utrInput.value = '';
      }
    }
  });
});

function submitOrder(withWhatsApp) {
  const paymentMethod = document.querySelector('input[name="checkout-payment"]:checked').value;
  const utrVal = document.querySelector('#checkout-utr').value.trim();
  
  if (paymentMethod === 'UPI' && utrVal.length !== 12) {
    alert('Please enter a valid 12-digit UPI Transaction ID (UTR).');
    return;
  }
  
  const submitBtn = checkoutForm.querySelector('.checkout-submit-btn');
  const directBtn = checkoutForm.querySelector('.checkout-direct-btn');
  
  if (submitBtn) submitBtn.disabled = true;
  if (directBtn) {
    directBtn.disabled = true;
    if (!withWhatsApp) {
      directBtn.innerHTML = `PROCESSING... <span class="spinner-icon"></span>`;
    }
  }
  if (withWhatsApp && submitBtn) {
    submitBtn.innerHTML = `PROCESSING... <span class="spinner-icon"></span>`;
  }
  
  const name = document.querySelector('#checkout-name').value.trim();
  const phone = document.querySelector('#checkout-phone').value.trim();
  const pin = document.querySelector('#checkout-pincode').value.trim();
  const address = document.querySelector('#checkout-address').value.trim();
  const slot = document.querySelector('#checkout-slot').value;
  
  safeStore.set(localStorage, 'samara-name', name);
  safeStore.set(localStorage, 'samara-mobile', phone);
  safeStore.set(localStorage, 'samara-pincode', pin);
  
  fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      phone,
      pincode: pin,
      address,
      slot,
      items: cart,
      payment_method: paymentMethod,
      utr: paymentMethod === 'UPI' ? utrVal : null
    })
  })
  .then(res => res.json())
  .then(data => {
    if (!data.success) {
      throw new Error(data.message || 'Server error.');
    }
    
    const successTitle = document.querySelector('.success-title');
    const successMsg = document.querySelector('.success-msg');
    
    if (withWhatsApp) {
      let orderItemsText = "";
      for (const name in cart) {
        const qty = cart[name].qty;
        const delivery = cart[name].delivery || 'one-time';
        const info = PRODUCTS_INFO[name] || { price: 0, unit: "" };
        const itemTotal = info.price * qty;
        
        let deliveryLabel = "";
        if (delivery === 'daily') deliveryLabel = " [Daily Sub]";
        else if (delivery === 'alternate') deliveryLabel = " [Alternate Days Sub]";
        else if (delivery === 'weekend') deliveryLabel = " [Weekends Sub]";
        
        orderItemsText += `• ${qty} x ${name} (${info.unit})${deliveryLabel} - ₹${itemTotal}\n`;
      }
      
      let paymentDetailsText = `• Method: ${paymentMethod}`;
      if (paymentMethod === 'UPI') {
        paymentDetailsText += `\n• UTR/Transaction ID: ${utrVal}`;
      }
      
      const message = `*SAMARA ORGANICS ORDER CONFIRMATION*
----------------------------------
*Order Registry ID:* #${data.orderId}
*Customer Details:*
• Name: ${name}
• Phone: +91 ${phone}
• PIN Code: ${pin}
• Address: ${address}
• Preferred Slot: ${slot}

*Order Summary:*
${orderItemsText}
*Payment Details:*
${paymentDetailsText}

*Total Amount:* ₹${data.total}
*(Free Launch Delivery)*
----------------------------------
Thank you for choosing Samara Organics! 🌿`;

      const url = `https://wa.me/918077366897?text=${encodeURIComponent(message)}`;
      
      setTimeout(() => {
        window.open(url, '_blank', 'noopener');
        if (successTitle) successTitle.textContent = "Order Logged!";
        if (successMsg) successMsg.textContent = "Please send the pre-filled message in the WhatsApp window that has opened to confirm your order details with us.";
        finalizeOrder();
      }, 950);
    } else {
      setTimeout(() => {
        if (successTitle) successTitle.textContent = "Order Placed!";
        if (successMsg) successMsg.textContent = `Your order #${data.orderId} has been successfully recorded. Dr. Mohammad Abdullah Raza or the team will call you shortly on +91 ${phone} to confirm delivery schedule.`;
        finalizeOrder();
      }, 950);
    }
    
    function finalizeOrder() {
      cart = {};
      safeStore.set(localStorage, 'samara-cart', '{}');
      renderCart();
      
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `PLACE ORDER VIA WHATSAPP <span>→</span>`;
      }
      if (directBtn) {
        directBtn.disabled = false;
        directBtn.innerHTML = `DIRECT WEBSITE ORDER <span>✓</span>`;
      }
      
      if (upiBox) upiBox.style.display = 'none';
      document.querySelectorAll('input[name="checkout-payment"]').forEach(r => {
        r.checked = r.value === 'COD';
        r.closest('.payment-method-option').classList.toggle('active', r.value === 'COD');
      });
      if (utrInput) {
        utrInput.value = '';
        utrInput.required = false;
      }
      
      showView('success');
    }
  })
  .catch(err => {
    console.error('Error submitting order:', err);
    alert('Failed to place order: ' + err.message);
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `PLACE ORDER VIA WHATSAPP <span>→</span>`;
    }
    if (directBtn) {
      directBtn.disabled = false;
      directBtn.innerHTML = `DIRECT WEBSITE ORDER <span>✓</span>`;
    }
  });
}

checkoutForm?.addEventListener('submit', event => {
  event.preventDefault();
  submitOrder(true);
});

const directOrderBtn = document.querySelector('.checkout-direct-btn');
directOrderBtn?.addEventListener('click', () => {
  if (checkoutForm.reportValidity()) {
    submitOrder(false);
  }
});

successCloseBtn?.addEventListener('click', closeDrawer);

addEventListener('keydown', event => {
  if (event.key === 'Escape' && drawer && drawer.classList.contains('open')) closeDrawer();
  if (event.key !== 'Tab' || !drawer || !drawer.classList.contains('open')) return;
  const focusable = [...drawer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(element => element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

renderCart();

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

// Daily Subscription Modal with Calendar Feature
(() => {
  const subModal = document.querySelector('#subscribe-modal');
  const subHeaderBtn = document.querySelector('#subscribe-header-btn');
  const subModalClose = document.querySelector('#subscribe-modal-close');
  const subForm = document.querySelector('#subscribe-modal-form');
  const subCalendarGrid = document.querySelector('#sub-calendar-grid');
  
  const subProduct = document.querySelector('#sub-product');
  const subQty = document.querySelector('#sub-qty');
  const subSlot = document.querySelector('#sub-slot');
  const subSchedule = document.querySelector('#sub-schedule');
  
  const prevMonthBtn = document.querySelector('.prev-month');
  const nextMonthBtn = document.querySelector('.next-month');
  const monthYearLabel = document.querySelector('.calendar-month-year');
  const daysCountLabel = document.querySelector('#sub-days-count');
  const totalCostLabel = document.querySelector('#sub-total-cost');
  
  const subName = document.querySelector('#sub-name');
  const subPhone = document.querySelector('#sub-phone');
  const subPincode = document.querySelector('#sub-pincode');
  const subAddress = document.querySelector('#sub-address');
  
  const subDirectBtn = document.querySelector('#sub-direct-btn');
  const subWhatsappBtn = document.querySelector('#sub-whatsapp-btn');
  
  const subSuccessCloseBtn = document.querySelector('#sub-success-close-btn');
  const subSuccessView = document.querySelector('.sub-success-view');
  const subFormContainer = document.querySelector('#sub-form-container');

  let currentYear, currentMonth;
  let selectedDates = new Set();
  
  // Set default calendar to today
  const today = new Date();
  currentYear = today.getFullYear();
  currentMonth = today.getMonth();

  // Define booking bounds: Next 60 days maximum
  const bookingStart = new Date();
  bookingStart.setHours(0,0,0,0);
  const bookingEnd = new Date();
  bookingEnd.setDate(bookingStart.getDate() + 60);
  bookingEnd.setHours(23,59,59,999);

  let currentDuration = 30; // default duration

  const btnSelect30 = document.querySelector('#btn-select-30');
  const btnSelect60 = document.querySelector('#btn-select-60');

  btnSelect30?.addEventListener('click', () => {
    currentDuration = 30;
    btnSelect30.classList.add('active');
    btnSelect60?.classList.remove('active');
    applySchedule(subSchedule.value);
  });

  btnSelect60?.addEventListener('click', () => {
    currentDuration = 60;
    btnSelect60.classList.add('active');
    btnSelect30?.classList.remove('active');
    applySchedule(subSchedule.value);
  });

  // Helper to open modal
  subHeaderBtn?.addEventListener('click', () => {
    subModal?.classList.add('open');
    subModal?.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    
    // Auto-fill customer details from safeStore
    if (subName) subName.value = safeStore.get(localStorage, 'samara-name') || '';
    if (subPhone) subPhone.value = safeStore.get(localStorage, 'samara-mobile') || '';
    if (subPincode) subPincode.value = safeStore.get(localStorage, 'samara-pincode') || '';
    if (subAddress) subAddress.value = safeStore.get(localStorage, 'samara-address') || '';

    // Default to "daily" schedule and select all active days (first 30 days)
    currentDuration = 30;
    if (btnSelect30) btnSelect30.classList.add('active');
    if (btnSelect60) btnSelect60.classList.remove('active');
    if (subSchedule) subSchedule.value = 'daily';
    applySchedule('daily');
  });

  // Helper to close modal
  function closeSubModal() {
    subModal?.classList.remove('open');
    subModal?.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    
    // Reset views
    if (subFormContainer) subFormContainer.style.display = 'block';
    if (subSuccessView) subSuccessView.style.display = 'none';
  }

  subModalClose?.addEventListener('click', closeSubModal);
  subModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeSubModal);
  subSuccessCloseBtn?.addEventListener('click', closeSubModal);

  // Render Calendar Grid
  function renderCalendar(year, month) {
    if (!subCalendarGrid) return;
    subCalendarGrid.innerHTML = '';
    
    // Update header label
    const tempDate = new Date(year, month, 1);
    if (monthYearLabel) {
      monthYearLabel.textContent = tempDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    
    // Allow month navigation up to the next 2 months
    const minMonthDate = new Date(today.getFullYear(), today.getMonth(), 1);
    const maxMonthDate = new Date(today.getFullYear(), today.getMonth() + 2, 1);
    const currentMonthDate = new Date(year, month, 1);
    
    if (prevMonthBtn) prevMonthBtn.disabled = (currentMonthDate <= minMonthDate);
    if (nextMonthBtn) nextMonthBtn.disabled = (currentMonthDate >= maxMonthDate);
    
    let startDay = new Date(year, month, 1).getDay();
    startDay = startDay === 0 ? 6 : startDay - 1;
    
    const totalDays = new Date(year, month + 1, 0).getDate();
    
    for (let i = 0; i < startDay; i++) {
      const blank = document.createElement('span');
      blank.className = 'day-empty';
      subCalendarGrid.appendChild(blank);
    }
    
    for (let day = 1; day <= totalDays; day++) {
      const cellDate = new Date(year, month, day);
      cellDate.setHours(0,0,0,0);
      
      const cell = document.createElement('span');
      cell.textContent = day;
      
      const dateString = cellDate.toDateString();
      const isWeekend = cellDate.getDay() === 0 || cellDate.getDay() === 6;
      
      if (isWeekend) {
        cell.classList.add('day-weekend');
      }
      
      if (cellDate < bookingStart || cellDate > bookingEnd) {
        cell.className = 'day-disabled';
      } else {
        cell.className = 'day-active';
        
        if (selectedDates.has(dateString)) {
          cell.classList.add('day-selected');
        }
        
        cell.addEventListener('click', () => {
          if (subSchedule && subSchedule.value !== 'custom') {
            subSchedule.value = 'custom';
          }
          toggleDate(dateString);
        });
      }
      
      subCalendarGrid.appendChild(cell);
    }
    
    updateSummary();
  }

  function toggleDate(dateStr) {
    if (selectedDates.has(dateStr)) {
      selectedDates.delete(dateStr);
    } else {
      selectedDates.add(dateStr);
    }
    renderCalendar(currentYear, currentMonth);
  }

  prevMonthBtn?.addEventListener('click', () => {
    const minMonthDate = new Date(today.getFullYear(), today.getMonth(), 1);
    const currentMonthDate = new Date(currentYear, currentMonth, 1);
    
    if (currentMonthDate > minMonthDate) {
      currentMonth--;
      if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
      }
      renderCalendar(currentYear, currentMonth);
    }
  });

  nextMonthBtn?.addEventListener('click', () => {
    const maxMonthDate = new Date(today.getFullYear(), today.getMonth() + 2, 1);
    const currentMonthDate = new Date(currentYear, currentMonth, 1);
    
    if (currentMonthDate < maxMonthDate) {
      currentMonth++;
      if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
      }
      renderCalendar(currentYear, currentMonth);
    }
  });

  function updateSummary() {
    const qty = parseInt(subQty.value) || 1;
    const count = selectedDates.size;
    const prodName = subProduct.value;
    const info = PRODUCTS_INFO[prodName] || { price: 0 };
    
    const cost = qty * info.price * count;
    
    if (daysCountLabel) daysCountLabel.textContent = count;
    if (totalCostLabel) totalCostLabel.textContent = `₹${cost}`;
  }

  function applySchedule(preset) {
    selectedDates.clear();
    
    const durationLimitDate = new Date(bookingStart);
    durationLimitDate.setDate(bookingStart.getDate() + currentDuration);
    durationLimitDate.setHours(23,59,59,999);
    
    const cursor = new Date(bookingStart);
    while (cursor <= bookingEnd && cursor <= durationLimitDate) {
      const dateString = cursor.toDateString();
      const dayOfWeek = cursor.getDay();
      
      if (preset === 'daily') {
        selectedDates.add(dateString);
      } else if (preset === 'alternate') {
        const diffTime = Math.abs(cursor - bookingStart);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays % 2 === 0) {
          selectedDates.add(dateString);
        }
      } else if (preset === 'weekend') {
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          selectedDates.add(dateString);
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    
    renderCalendar(currentYear, currentMonth);
  }

  subSchedule?.addEventListener('change', (e) => {
    applySchedule(e.target.value);
  });
  
  subProduct?.addEventListener('change', updateSummary);
  subQty?.addEventListener('input', updateSummary);

  function submitSubscription(withWhatsApp) {
    if (selectedDates.size === 0) {
      alert('Please select at least 1 delivery date in the calendar.');
      return;
    }
    
    const directBtn = document.querySelector('#sub-direct-btn');
    const whatsappBtn = document.querySelector('#sub-whatsapp-btn');
    
    if (directBtn) directBtn.disabled = true;
    if (whatsappBtn) whatsappBtn.disabled = true;
    
    if (withWhatsApp && whatsappBtn) {
      whatsappBtn.innerHTML = `PROCESSING... <span class="spinner-icon"></span>`;
    } else if (directBtn) {
      directBtn.innerHTML = `PROCESSING... <span class="spinner-icon"></span>`;
    }
    
    const name = subName.value.trim();
    const phone = subPhone.value.trim();
    const pincode = subPincode.value.trim();
    const address = subAddress.value.trim();
    
    const product = subProduct.value;
    const qty = parseInt(subQty.value) || 1;
    const slot = subSlot.value;
    const schedule = subSchedule.value;
    
    const sortedDates = [...selectedDates].map(d => new Date(d)).sort((a,b) => a - b);
    const startDateFormatted = sortedDates[0]?.toLocaleDateString('en-IN') || '—';
    const datesList = sortedDates.map(d => d.toLocaleDateString('en-IN'));

    safeStore.set(localStorage, 'samara-name', name);
    safeStore.set(localStorage, 'samara-mobile', phone);
    safeStore.set(localStorage, 'samara-pincode', pincode);
    safeStore.set(localStorage, 'samara-address', address);

    fetch('/api/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        phone,
        pincode,
        address,
        product_name: product,
        qty,
        schedule,
        delivery_slot: slot,
        start_date: startDateFormatted,
        custom_dates: datesList
      })
    })
    .then(res => res.json())
    .then(data => {
      if (!data.success) throw new Error(data.message || 'Server error.');
      
      const successTitle = document.querySelector('.sub-success-title');
      const successMsg = document.querySelector('.sub-success-msg');
      
      const info = PRODUCTS_INFO[product] || { price: 0 };
      const totalCost = qty * info.price * sortedDates.length;

      if (withWhatsApp) {
        const message = `*SAMARA ORGANICS SUBSCRIPTION REGISTRY*
----------------------------------
*Subscription ID:* #${data.subscriptionId}
*Customer Details:*
• Name: ${name}
• Phone: +91 ${phone}
• Address: ${address} (${pincode})
• Delivery Slot: ${slot}

*Subscription Details:*
• Product: ${product}
• Quantity per day: ${qty}
• Preset Schedule: ${schedule.toUpperCase()}
• Starting Date: ${startDateFormatted}
• Total Deliveries: ${sortedDates.length} days

*Estimated Cycle Cost:* ₹${totalCost}
----------------------------------
Thank you for choosing Samara Organics! 🌿`;

        const url = `https://wa.me/918077366897?text=${encodeURIComponent(message)}`;
        
        setTimeout(() => {
          window.open(url, '_blank', 'noopener');
          if (successTitle) successTitle.textContent = "Subscription Logged!";
          if (successMsg) successMsg.textContent = "Please send the pre-filled message in the WhatsApp window that has opened to confirm your subscription details with us.";
          finalizeSub();
        }, 950);
      } else {
        setTimeout(() => {
          if (successTitle) successTitle.textContent = "Subscription Booked!";
          if (successMsg) successMsg.textContent = `Your subscription #${data.subscriptionId} starting on ${startDateFormatted} has been logged directly. The farm crew will call you on +91 ${phone} to coordinate routing.`;
          finalizeSub();
        }, 950);
      }
      
      function finalizeSub() {
        if (directBtn) {
          directBtn.disabled = false;
          directBtn.innerHTML = `CONFIRM SUBSCRIPTION DIRECTLY <span>✓</span>`;
        }
        if (whatsappBtn) {
          whatsappBtn.disabled = false;
          whatsappBtn.innerHTML = `SUBSCRIBE VIA WHATSAPP <span>→</span>`;
        }
        
        if (subFormContainer) subFormContainer.style.display = 'none';
        if (subSuccessView) subSuccessView.style.display = 'block';
      }
    })
    .catch(err => {
      console.error(err);
      alert('Subscription failed: ' + err.message);
      if (directBtn) {
        directBtn.disabled = false;
        directBtn.innerHTML = `CONFIRM SUBSCRIPTION DIRECTLY <span>✓</span>`;
      }
      if (whatsappBtn) {
        whatsappBtn.disabled = false;
        whatsappBtn.innerHTML = `SUBSCRIBE VIA WHATSAPP <span>→</span>`;
      }
    });
  }

  subForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    submitSubscription(true);
  });

  subDirectBtn?.addEventListener('click', () => {
    if (subForm && subForm.reportValidity()) {
      submitSubscription(false);
    }
  });

  // Farm Tour Modal Controllers & WhatsApp Form Booking
  (() => {
    const tourModal = document.querySelector('#tour-modal');
    const tourHeaderBtn = document.querySelector('#tour-header-btn');
    const tourModalClose = document.querySelector('#tour-modal-close');
    const tourForm = document.querySelector('#tour-modal-form');
    const tourDateInput = document.querySelector('#tour-date');
    const tourGuestsSelect = document.querySelector('#tour-guests');
    const tourTotalCostLabel = document.querySelector('#tour-total-cost');
    
    if (tourDateInput) {
      const todayVal = new Date();
      const todayStr = todayVal.toISOString().split('T')[0];
      
      const maxDateVal = new Date();
      maxDateVal.setDate(maxDateVal.getDate() + 30);
      const maxStr = maxDateVal.toISOString().split('T')[0];
      
      tourDateInput.min = todayStr;
      tourDateInput.max = maxStr;
      
      // Auto popout browser calendar immediately on click or focus
      ['click', 'focus'].forEach(evt => {
        tourDateInput.addEventListener(evt, () => {
          try {
            tourDateInput.showPicker();
          } catch (e) {
            console.error("showPicker not supported", e);
          }
        });
      });
    }

    // Dynamic cost calculator based on number of guests
    function updateTourTotalCost() {
      const guests = parseInt(tourGuestsSelect?.value) || 1;
      const cost = guests * 99;
      if (tourTotalCostLabel) {
        tourTotalCostLabel.textContent = `₹${cost}`;
      }
    }
    tourGuestsSelect?.addEventListener('change', updateTourTotalCost);

    tourHeaderBtn?.addEventListener('click', () => {
      tourModal?.classList.add('open');
      tourModal?.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      
      const nameIn = document.querySelector('#tour-name');
      const phoneIn = document.querySelector('#tour-phone');
      if (nameIn) nameIn.value = safeStore.get(localStorage, 'samara-name') || '';
      if (phoneIn) phoneIn.value = safeStore.get(localStorage, 'samara-mobile') || '';
      
      // Reset defaults
      if (tourGuestsSelect) tourGuestsSelect.value = "1";
      updateTourTotalCost();
    });

    function closeTourModal() {
      tourModal?.classList.remove('open');
      tourModal?.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }

    tourModalClose?.addEventListener('click', closeTourModal);
    tourModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeTourModal);

    tourForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const name = document.querySelector('#tour-name')?.value.trim();
      const phone = document.querySelector('#tour-phone')?.value.trim();
      const guests = parseInt(tourGuestsSelect?.value) || 1;
      const dateVal = tourDateInput?.value;
      const slot = document.querySelector('#tour-slot')?.value;
      
      safeStore.set(localStorage, 'samara-name', name);
      safeStore.set(localStorage, 'samara-mobile', phone);
      
      const formattedDate = dateVal ? new Date(dateVal).toLocaleDateString('en-IN') : '';
      const totalCost = guests * 99;
      
      const message = `*SAMARA ORGANICS FARM TOUR BOOKING*
----------------------------------
*Customer Details:*
• Name: ${name}
• Phone: +91 ${phone}
• Number of Guests: ${guests}
• Selected Date: ${formattedDate}
• Timing Slot: ${slot}

*Booking Ticket Cost:* ₹${totalCost}
----------------------------------
We would love to visit your farm! 🌿`;

      const url = `https://wa.me/918077366897?text=${encodeURIComponent(message)}`;
      
      window.open(url, '_blank', 'noopener');
      closeTourModal();
    });
  })();

})();

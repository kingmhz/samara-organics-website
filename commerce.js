let initialized = false;
export function initCommerce({ safeStore, PRODUCTS_INFO, createIdempotencyKey }) {
  if (initialized) return;
  initialized = true;
let cart = {};
try {
  const raw = JSON.parse(safeStore.get(localStorage, 'samara-cart', '{}'));
  for (const key in raw) {
    if (!PRODUCTS_INFO[key]?.active) continue;
    if (typeof raw[key] === 'number') {
      cart[key] = { qty: raw[key], delivery: 'one-time' };
    } else {
      cart[key] = { ...raw[key], delivery: 'one-time' };
    }
  }
} catch {
  cart = {};
}
let activeOrderIdempotencyKey = null;
let lastCartFingerprint = JSON.stringify(cart);

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
const checkoutDate = document.querySelector('#checkout-date');
const checkoutPincode = document.querySelector('#checkout-pincode');
const checkoutSlot = document.querySelector('#checkout-slot');
const checkoutRouteStatus = document.querySelector('#checkout-route-status');
const successCloseBtn = document.querySelector('.success-close-btn');
const cartClearBtn = document.querySelector('.cart-clear-btn');

let drawerReturnFocus = null;

if (checkoutDate) {
  const localDate = offset => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  checkoutDate.min = localDate(0);
  checkoutDate.max = localDate(30);
  checkoutDate.value ||= localDate(1);
}

async function refreshDeliveryAvailability() {
  const pincode = checkoutPincode?.value.trim() || '';
  const date = checkoutDate?.value || '';
  if (!/^\d{6}$/.test(pincode) || !date) return true;
  if (!checkoutRouteStatus || !checkoutSlot) return false;
  checkoutRouteStatus.textContent = 'Checking live route capacity…';
  try {
    const response = await fetch(`/api/serviceability/${encodeURIComponent(pincode)}?date=${encodeURIComponent(date)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || 'Unable to check delivery capacity.');
    for (const option of checkoutSlot.options) option.disabled = !data.slots.some(slot => slot.deliverySlot === option.value && slot.available);
    if (checkoutSlot.selectedOptions[0]?.disabled) checkoutSlot.value = [...checkoutSlot.options].find(option => !option.disabled)?.value || '';
    checkoutRouteStatus.textContent = !data.serviceable ? 'This PIN code is not on an active route yet.' : !data.acceptingOrders ? 'All delivery slots are full for this date.' : 'Live delivery capacity confirmed.';
    checkoutRouteStatus.style.color = data.acceptingOrders ? 'var(--olive)' : '#9a513b';
    return data.acceptingOrders;
  } catch (error) {
    checkoutRouteStatus.textContent = error.message;
    checkoutRouteStatus.style.color = '#9a513b';
    return false;
  }
}
checkoutDate?.addEventListener('change', refreshDeliveryAvailability);
checkoutPincode?.addEventListener('blur', refreshDeliveryAvailability);

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

function openDrawer(opener = document.activeElement) {
  drawerReturnFocus = opener?.isConnected && typeof opener.focus === 'function' ? opener : document.activeElement;
  if (drawer) drawer.classList.add('open');
  if (backdrop) backdrop.classList.add('show');
  if (drawer) {
    drawer.removeAttribute('inert');
    drawer.setAttribute('aria-hidden', 'false');
  }
  window.SamaraModal?.isolateBackground(drawer, [drawer, backdrop]);
  document.body.style.overflow = 'hidden';
  showView('cart');
  const closeBtn = document.querySelector('.drawer-close');
  if (closeBtn) closeBtn.focus();
}

function closeDrawer() {
  if (drawer?.contains(document.activeElement)) document.activeElement.blur();
  if (drawer) drawer.classList.remove('open');
  if (backdrop) backdrop.classList.remove('show');
  if (drawer) {
    drawer.setAttribute('aria-hidden', 'true');
    drawer.setAttribute('inert', '');
  }
  window.SamaraModal?.restoreBackground(drawer);
  document.body.style.overflow = '';
  if (drawerReturnFocus?.isConnected && typeof drawerReturnFocus.focus === 'function') {
    const target = drawerReturnFocus;
    let restored = false;
    const restoreFocus = () => {
      if (restored || !target.isConnected) return;
      restored = true;
      target.getBoundingClientRect();
      target.focus({ preventScroll: true });
    };
    drawer?.addEventListener('transitionend', restoreFocus, { once: true });
    setTimeout(restoreFocus, matchMedia('(prefers-reduced-motion: reduce)').matches ? 20 : 650);
  }
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
  const cartFingerprint = JSON.stringify(cart);
  if (cartFingerprint !== lastCartFingerprint) {
    activeOrderIdempotencyKey = null;
    lastCartFingerprint = cartFingerprint;
  }
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
      const info = PRODUCTS_INFO[name] || { price: 0, unit: "", img: "" };
      const itemTotal = info.price * qty;
      subtotal += itemTotal;
      
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
  if (!PRODUCTS_INFO[name]?.active) return;
  if (!cart[name]) {
    cart[name] = { qty: 1, delivery: 'one-time' };
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
  if (!PRODUCTS_INFO[name]?.active) return;
  if (!cart[name]) {
    cart[name] = { qty: 1, delivery: 'one-time' };
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

headerCartBtn?.addEventListener('click', event => openDrawer(event.currentTarget));
fab?.addEventListener('click', event => openDrawer(event.currentTarget));
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

async function submitOrder(withWhatsApp) {
  if (!(await refreshDeliveryAvailability())) return;
  const paymentMethod = document.querySelector('input[name="checkout-payment"]:checked').value;
  const utrVal = document.querySelector('#checkout-utr')?.value.trim() || '';
  
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
  const deliveryDate = checkoutDate.value;
  
  safeStore.set(localStorage, 'samara-name', name);
  safeStore.set(localStorage, 'samara-mobile', phone);
  safeStore.set(localStorage, 'samara-pincode', pin);
  
  activeOrderIdempotencyKey ||= createIdempotencyKey('order');
  fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': activeOrderIdempotencyKey },
    body: JSON.stringify({
      name,
      phone,
      pincode: pin,
      address,
      slot,
      delivery_date: deliveryDate,
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
    activeOrderIdempotencyKey = null;
    
    const successTitle = document.querySelector('.success-title');
    const successMsg = document.querySelector('.success-msg');
    const trackingUrl = new URL(`track.html?token=${encodeURIComponent(data.trackingToken)}`, location.href).href;
    
    if (withWhatsApp) {
      let orderItemsText = "";
      for (const name in cart) {
        const qty = cart[name].qty;
        const info = PRODUCTS_INFO[name] || { price: 0, unit: "" };
        const itemTotal = info.price * qty;

        orderItemsText += `• ${qty} x ${name} (${info.unit}) - ₹${itemTotal}\n`;
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
• Delivery Date: ${deliveryDate}
• Preferred Slot: ${slot}

*Order Summary:*
${orderItemsText}
*Payment Details:*
${paymentDetailsText}

*Total Amount:* ₹${data.total}
*(Free Launch Delivery)*
*Track Order:* ${trackingUrl}
----------------------------------
Thank you for choosing Samara Organics! 🌿`;

      const url = `https://wa.me/918077366897?text=${encodeURIComponent(message)}`;
      
      setTimeout(() => {
        window.open(url, '_blank', 'noopener');
        if (successTitle) successTitle.textContent = "Order Logged!";
        if (successMsg) successMsg.innerHTML = `Please send the pre-filled WhatsApp message to confirm your order. <a href="${trackingUrl}" style="display:block;margin-top:10px;color:var(--olive);font-weight:700">TRACK ORDER #${data.orderId} →</a>`;
        finalizeOrder();
      }, 950);
    } else {
      setTimeout(() => {
        if (successTitle) successTitle.textContent = "Order Placed!";
        if (successMsg) successMsg.innerHTML = `Your order #${data.orderId} has been recorded. Our team will call +91 ${phone} to confirm delivery. <a href="${trackingUrl}" style="display:block;margin-top:10px;color:var(--olive);font-weight:700">TRACK YOUR ORDER →</a>`;
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
  if (event.key === 'Escape' && drawer && drawer.classList.contains('open')) {
    event.preventDefault();
    event.stopPropagation();
    closeDrawer();
  }
  if (event.key !== 'Tab' || !drawer || !drawer.classList.contains('open')) return;
  const focusable = [...drawer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(element => element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

renderCart();


}

export const calendarDateKey = date => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
export const indiaCalendarToday = (now = new Date()) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(part => [part.type, part.value]));
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
};
export const planDateKeys = (startDate, duration, preset) => {
  const dates = [];
  const cursor = new Date(startDate);
  for (let offset = 0; offset < duration; offset += 1) {
    const dayOfWeek = cursor.getUTCDay();
    if (preset === 'daily' || (preset === 'alternate' && offset % 2 === 0) || (preset === 'weekend' && (dayOfWeek === 0 || dayOfWeek === 6))) dates.push(calendarDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};

export function initSubscriptionBooking({ safeStore, PRODUCTS_INFO, createIdempotencyKey }) {
  let activeSubscriptionIdempotencyKey = null;
  const subModal = document.querySelector('#subscribe-modal');
  const subHeaderBtn = document.querySelector('#subscribe-header-btn');
  const subModalClose = document.querySelector('#subscribe-modal-close');
  const subForm = document.querySelector('#subscribe-modal-form');
  subForm?.addEventListener('input', () => { activeSubscriptionIdempotencyKey = null; setSubFeedback(''); });
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
  const subFeedback = document.querySelector('#sub-feedback');
  
  const subSuccessCloseBtn = document.querySelector('#sub-success-close-btn');
  const subSuccessView = document.querySelector('.sub-success-view');
  const subFormContainer = document.querySelector('#sub-form-container');
  const modalManager = window.SamaraModal;

  const setSubFeedback = (message = '') => {
    if (!subFeedback) return;
    subFeedback.textContent = message;
    subFeedback.classList.toggle('show', Boolean(message));
  };

  let currentYear, currentMonth;
  let selectedDates = new Set();
  
  // Set default calendar to today
  const today = indiaCalendarToday();
  currentYear = today.getUTCFullYear();
  currentMonth = today.getUTCMonth();
  let focusedDateKey = calendarDateKey(today);

  // Define booking bounds: Next 60 days maximum
  const bookingStart = new Date(today);
  const bookingEnd = new Date(today);
  bookingEnd.setUTCDate(bookingStart.getUTCDate() + 59);

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
  const open = () => {
    setSubFeedback('');
    if (modalManager) modalManager.open(subModal, document.activeElement, subModalClose);
    else {
      subModal?.removeAttribute('inert');
      subModal?.classList.add('open');
      subModal?.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      subModalClose?.focus();
    }
    
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
    subModalClose?.focus();
  };

  // Helper to close modal
  function closeSubModal() {
    if (modalManager) modalManager.close(subModal);
    else {
      subModal?.classList.remove('open');
      subModal?.setAttribute('aria-hidden', 'true');
      subModal?.setAttribute('inert', '');
      document.body.style.overflow = '';
    }
  }
  function resetSubModal() {
    if (subFormContainer) subFormContainer.style.display = 'block';
    if (subSuccessView) subSuccessView.style.display = 'none';
  }

  if (!modalManager) {
    subModalClose?.addEventListener('click', closeSubModal);
    subModal?.querySelector('.modal-backdrop')?.addEventListener('click', closeSubModal);
  }
  subModal?.addEventListener('samara:modal-closed', resetSubModal);
  subSuccessCloseBtn?.addEventListener('click', closeSubModal);

  // Render Calendar Grid
  function renderCalendar(year, month) {
    if (!subCalendarGrid) return;
    subCalendarGrid.innerHTML = '';
    
    // Update header label
    const tempDate = new Date(Date.UTC(year, month, 1));
    if (monthYearLabel) {
      monthYearLabel.textContent = tempDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    }
    
    // Allow month navigation up to the next 2 months
    const minMonthDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const maxMonthDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 2, 1));
    const currentMonthDate = new Date(Date.UTC(year, month, 1));
    
    if (prevMonthBtn) prevMonthBtn.disabled = (currentMonthDate <= minMonthDate);
    if (nextMonthBtn) nextMonthBtn.disabled = (currentMonthDate >= maxMonthDate);
    
    let startDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
    startDay = startDay === 0 ? 6 : startDay - 1;
    
    const totalDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    
    for (let i = 0; i < startDay; i++) {
      const blank = document.createElement('span');
      blank.className = 'day-empty';
      blank.setAttribute('aria-hidden', 'true');
      subCalendarGrid.appendChild(blank);
    }
    
    for (let day = 1; day <= totalDays; day++) {
      const cellDate = new Date(Date.UTC(year, month, day));
      
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.textContent = day;
      
      const dateString = calendarDateKey(cellDate);
      const isWeekend = cellDate.getUTCDay() === 0 || cellDate.getUTCDay() === 6;
      
      if (cellDate < bookingStart || cellDate > bookingEnd) {
        cell.className = 'day-disabled';
        cell.disabled = true;
        cell.tabIndex = -1;
        cell.setAttribute('aria-label', `${cellDate.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}, unavailable`);
      } else {
        cell.className = 'day-active';
        cell.dataset.date = dateString;
        cell.tabIndex = dateString === focusedDateKey ? 0 : -1;
        
        if (selectedDates.has(dateString)) {
          cell.classList.add('day-selected');
        }
        const selected = selectedDates.has(dateString);
        cell.setAttribute('aria-pressed', String(selected));
        cell.setAttribute('aria-label', `${cellDate.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}, ${selected ? 'selected' : 'not selected'}`);
        
        cell.addEventListener('click', () => {
          if (subSchedule && subSchedule.value !== 'custom') {
            subSchedule.value = 'custom';
          }
          focusedDateKey = dateString;
          toggleDate(dateString, true);
        });
        cell.addEventListener('keydown', event => {
          const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' ? 7 : event.key === 'ArrowUp' ? -7 : 0;
          if (!offset) return;
          event.preventDefault();
          moveCalendarFocus(dateString, offset);
        });
      }
      if (isWeekend) cell.classList.add('day-weekend');
      
      subCalendarGrid.appendChild(cell);
    }
    
    const activeCells = [...subCalendarGrid.querySelectorAll('button.day-active')];
    if (activeCells.length && !activeCells.some(cell => cell.tabIndex === 0)) {
      activeCells[0].tabIndex = 0;
      focusedDateKey = activeCells[0].dataset.date;
    }
    updateSummary();
  }

  function focusRenderedDate(dateString) {
    const target = subCalendarGrid?.querySelector(`[data-date="${dateString}"]`);
    if (target) target.focus({ preventScroll: true });
    else requestAnimationFrame(() => subCalendarGrid?.querySelector(`[data-date="${dateString}"]`)?.focus({ preventScroll: true }));
  }

  function moveCalendarFocus(dateString, offset) {
    const target = new Date(`${dateString}T00:00:00Z`);
    target.setUTCDate(target.getUTCDate() + offset);
    if (target < bookingStart || target > bookingEnd) return;
    focusedDateKey = calendarDateKey(target);
    currentYear = target.getUTCFullYear();
    currentMonth = target.getUTCMonth();
    renderCalendar(currentYear, currentMonth);
    focusRenderedDate(focusedDateKey);
  }

  function toggleDate(dateStr, restoreFocus = false) {
    if (selectedDates.has(dateStr)) {
      selectedDates.delete(dateStr);
    } else {
      selectedDates.add(dateStr);
    }
    renderCalendar(currentYear, currentMonth);
    if (restoreFocus) focusRenderedDate(dateStr);
  }

  prevMonthBtn?.addEventListener('click', () => {
    const minMonthDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const currentMonthDate = new Date(Date.UTC(currentYear, currentMonth, 1));
    
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
    const maxMonthDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 2, 1));
    const currentMonthDate = new Date(Date.UTC(currentYear, currentMonth, 1));
    
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
    for (const dateString of planDateKeys(bookingStart, currentDuration, preset)) selectedDates.add(dateString);
    
    renderCalendar(currentYear, currentMonth);
  }

  subSchedule?.addEventListener('change', (e) => {
    applySchedule(e.target.value);
  });
  
  subProduct?.addEventListener('change', updateSummary);
  subQty?.addEventListener('input', updateSummary);
  subPhone?.addEventListener('input', () => {
    subPhone.value = subPhone.value.replace(/\D/g, '').slice(0, 10);
  });

  function submitSubscription(withWhatsApp) {
    if (subForm?.hasAttribute('aria-busy')) return;
    setSubFeedback('');
    if (selectedDates.size === 0) {
      setSubFeedback('Please select at least one delivery date in the calendar.');
      subFeedback?.focus({ preventScroll: false });
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
    subForm?.setAttribute('aria-busy', 'true');
    
    const name = subName.value.trim();
    const phone = subPhone.value.trim();
    const pincode = subPincode.value.trim();
    const address = subAddress.value.trim();
    
    const product = subProduct.value;
    const qty = parseInt(subQty.value) || 1;
    const slot = subSlot.value;
    const schedule = subSchedule.value;
    
    const isoDates = [...selectedDates].sort();
    const sortedDates = isoDates.map(date => new Date(`${date}T12:00:00Z`));
    const startDateFormatted = sortedDates[0]?.toLocaleDateString('en-IN', { timeZone: 'UTC' }) || '—';

    safeStore.set(localStorage, 'samara-name', name);
    safeStore.set(localStorage, 'samara-mobile', phone);
    safeStore.set(localStorage, 'samara-pincode', pincode);
    safeStore.set(localStorage, 'samara-address', address);

    activeSubscriptionIdempotencyKey ||= createIdempotencyKey('subscription');
    fetch('/api/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': activeSubscriptionIdempotencyKey },
      body: JSON.stringify({
        name,
        phone,
        pincode,
        address,
        product_name: product,
        qty,
        schedule,
        delivery_slot: slot,
        start_date: isoDates[0] || null,
        end_date: isoDates.at(-1) || null,
        custom_dates: isoDates
      })
    })
    .then(async res => {
      let data;
      try { data = await res.json(); }
      catch { throw new Error('The subscription service returned an unreadable response. Please try again.'); }
      if (!res.ok || !data.success) throw new Error(data.message || 'Unable to start the subscription.');
      return data;
    })
    .then(data => {
      activeSubscriptionIdempotencyKey = null;
      
      const successTitle = document.querySelector('.sub-success-title');
      const successMsg = document.querySelector('.sub-success-msg');
      
      const info = PRODUCTS_INFO[product] || { price: 0 };
      const totalCost = qty * info.price * sortedDates.length;
      const managementUrl = new URL(data.managementUrl, location.origin).href;

      if (withWhatsApp) {
        const message = `*SAMARA ORGANICS SUBSCRIPTION REGISTRY*
----------------------------------
*Subscription ID:* #${data.subscriptionId}
*Private management link:* ${managementUrl}
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
        
        window.open(url, '_blank', 'noopener');
        if (successTitle) successTitle.textContent = "Subscription Logged!";
        if (successMsg) successMsg.innerHTML = `Your plan is safely recorded. <a href="${url}" target="_blank" rel="noopener" class="success-primary-link">OPEN WHATSAPP TO CONFIRM →</a><a href="${managementUrl}" class="success-secondary-link">SAVE YOUR PRIVATE MANAGEMENT LINK →</a>`;
        finalizeSub();
      } else {
        if (successTitle) successTitle.textContent = "Subscription Booked!";
        if (successMsg) successMsg.innerHTML = `Subscription #${data.subscriptionId} has been logged. <a href="${managementUrl}" class="success-primary-link">SAVE YOUR PRIVATE MANAGEMENT LINK →</a>`;
        finalizeSub();
      }
      
      function finalizeSub() {
        subForm?.removeAttribute('aria-busy');
        if (directBtn) {
          directBtn.disabled = false;
          directBtn.innerHTML = `START SUBSCRIPTION <span>✓</span>`;
        }
        if (whatsappBtn) {
          whatsappBtn.disabled = false;
          whatsappBtn.innerHTML = `START &amp; CONFIRM ON WHATSAPP <span>→</span>`;
        }
        
        if (subFormContainer) subFormContainer.style.display = 'none';
        if (subSuccessView) subSuccessView.style.display = 'block';
      }
    })
    .catch(err => {
      console.error(err);
      subForm?.removeAttribute('aria-busy');
      setSubFeedback(`We could not start the subscription: ${err.message}`);
      subFeedback?.focus({ preventScroll: false });
      if (directBtn) {
        directBtn.disabled = false;
        directBtn.innerHTML = `START SUBSCRIPTION <span>✓</span>`;
      }
      if (whatsappBtn) {
        whatsappBtn.disabled = false;
        whatsappBtn.innerHTML = `START &amp; CONFIRM ON WHATSAPP <span>→</span>`;
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


  return { open };
}

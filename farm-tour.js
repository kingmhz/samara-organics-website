let initialized = false;
let openModal = () => {};

export function initFarmTour({ safeStore }) {
  if (initialized) return { open: openModal };
  initialized = true;
  const modal = document.querySelector('#tour-modal');
  const closeButton = document.querySelector('#tour-modal-close');
  const form = document.querySelector('#tour-modal-form');
  const dateInput = document.querySelector('#tour-date');
  const guestsSelect = document.querySelector('#tour-guests');
  const totalCost = document.querySelector('#tour-total-cost');
  const feedback = document.querySelector('#tour-feedback');
  const submitButton = form?.querySelector('[type="submit"]');
  const opener = document.querySelector('#tour-header-btn');
  const phoneInput = document.querySelector('#tour-phone');
  let returnFocus = opener;
  const modalManager = window.SamaraModal;

  if (dateInput) {
    const indiaDate = offsetDays => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offsetDays * 86400000));
    dateInput.min = indiaDate(0);
    dateInput.max = indiaDate(30);
  }

  const updateCost = () => {
    if (totalCost) totalCost.textContent = `₹${(Number(guestsSelect?.value) || 1) * 99}`;
  };
  const close = () => {
    if (modalManager) modalManager.close(modal);
    else {
      modal?.classList.remove('open');
      modal?.setAttribute('aria-hidden', 'true');
      modal?.setAttribute('inert', '');
      document.body.style.overflow = '';
      returnFocus?.focus();
    }
  };
  openModal = () => {
    returnFocus = document.activeElement;
    const name = document.querySelector('#tour-name');
    if (name) name.value = safeStore.get(localStorage, 'samara-name') || '';
    if (phoneInput) phoneInput.value = safeStore.get(localStorage, 'samara-mobile') || '';
    if (guestsSelect) guestsSelect.value = '1';
    if (feedback) {
      feedback.textContent = '';
      feedback.classList.remove('show');
    }
    if (submitButton) submitButton.innerHTML = 'BOOK VIA WHATSAPP <span>→</span>';
    updateCost();
    if (modalManager) {
      modalManager.open(modal, returnFocus, closeButton);
    }
    else {
      modal?.removeAttribute('inert');
      modal?.classList.add('open');
      modal?.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      name?.focus();
    }
  };

  guestsSelect?.addEventListener('change', updateCost);
  phoneInput?.addEventListener('input', () => {
    phoneInput.value = phoneInput.value.replace(/\D/g, '').slice(0, 10);
  });
  if (!modalManager) {
    closeButton?.addEventListener('click', close);
    modal?.querySelector('.modal-backdrop')?.addEventListener('click', close);
  }
  form?.addEventListener('submit', event => {
    event.preventDefault();
    const name = document.querySelector('#tour-name')?.value.trim();
    const phone = document.querySelector('#tour-phone')?.value.trim();
    const guests = Number(guestsSelect?.value) || 1;
    const selectedDate = dateInput?.value;
    const slot = document.querySelector('#tour-slot')?.value;
    safeStore.set(localStorage, 'samara-name', name);
    safeStore.set(localStorage, 'samara-mobile', phone);
    const message = `*SAMARA ORGANICS FARM TOUR BOOKING*\n----------------------------------\n*Customer Details:*\n• Name: ${name}\n• Phone: +91 ${phone}\n• Number of Guests: ${guests}\n• Selected Date: ${selectedDate ? new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en-IN') : ''}\n• Timing Slot: ${slot}\n\n*Standard Booking Ticket Cost:* ₹${guests * 99}\n*Founding Subscriber Offer:* Please confirm whether this booking qualifies for the complimentary farm tour for the first 14 confirmed subscribers.\n----------------------------------\nWe would love to welcome you to our farm! 🌿`;
    const url = `https://wa.me/918077366897?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank', 'noopener');
    if (feedback) {
      feedback.innerHTML = `Your booking message is ready. Send it in WhatsApp to request confirmation. <a href="${url}" target="_blank" rel="noopener">OPEN WHATSAPP →</a>`;
      feedback.classList.add('show');
      feedback.focus({ preventScroll: false });
    }
    if (submitButton) submitButton.innerHTML = 'OPEN WHATSAPP AGAIN <span>→</span>';
  });
  return { open: openModal };
}

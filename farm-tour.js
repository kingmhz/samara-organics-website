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
  const opener = document.querySelector('#tour-header-btn');
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
    const phone = document.querySelector('#tour-phone');
    if (name) name.value = safeStore.get(localStorage, 'samara-name') || '';
    if (phone) phone.value = safeStore.get(localStorage, 'samara-mobile') || '';
    if (guestsSelect) guestsSelect.value = '1';
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
    const message = `*SAMARA ORGANICS FARM TOUR BOOKING*\n----------------------------------\n*Customer Details:*\n• Name: ${name}\n• Phone: +91 ${phone}\n• Number of Guests: ${guests}\n• Selected Date: ${selectedDate ? new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en-IN') : ''}\n• Timing Slot: ${slot}\n\n*Booking Ticket Cost:* ₹${guests * 99}\n----------------------------------\nWe would love to visit your farm! 🌿`;
    window.open(`https://wa.me/918077366897?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
    close();
  });
  return { open: openModal };
}

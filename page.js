const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = Boolean(navigator.connection?.saveData);
const loader = document.querySelector('.loader');
const dismiss = () => { loader?.classList.add('done'); document.body.classList.remove('loading'); };
addEventListener('load', () => setTimeout(dismiss, reduce || saveData ? 100 : 750), { once: true });
setTimeout(dismiss, 3000);

if ('IntersectionObserver' in window && !reduce) {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
  }), { threshold: .1 });
  document.querySelectorAll('.reveal').forEach(element => observer.observe(element));
} else document.querySelectorAll('.reveal').forEach(element => element.classList.add('visible'));

const menu = document.querySelector('.menu'), header = document.querySelector('header');
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

const canTilt = matchMedia('(hover:hover) and (pointer:fine)').matches && !reduce && !saveData;

if (canTilt) document.querySelectorAll('[data-tilt], .detail-art, .standard-orbit, .manager-mark').forEach(element => {
  element.addEventListener('pointermove', event => {
    const box = element.getBoundingClientRect(), x=(event.clientX-box.left)/box.width-.5, y=(event.clientY-box.top)/box.height-.5;
    element.style.transform = `perspective(1000px) rotateY(${x*7}deg) rotateX(${-y*7}deg)`;
  });
  element.addEventListener('pointerleave', () => element.style.transform = '');
});

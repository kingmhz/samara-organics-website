import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';

const root = process.cwd();
const htmlFiles = (await readdir(root)).filter(name => extname(name) === '.html');
const failures = [];
const exists = async path => { try { return (await stat(path)).isFile(); } catch { return false; } };
const localTarget = (from, target) => {
  const clean = target.split(/[?#]/, 1)[0];
  if (!clean || clean === '/' || /^(?:https?:|mailto:|tel:|data:|javascript:|#|%23)/i.test(target)) return clean === '/' ? join(root, 'index.html') : null;
  const decoded = decodeURIComponent(clean);
  const path = decoded.startsWith('/') ? resolve(root, `.${decoded}`) : resolve(dirname(from), decoded);
  return path.startsWith(root) ? normalize(path) : null;
};

for (const name of htmlFiles) {
  const path = join(root, name);
  const html = await readFile(path, 'utf8');
  if (!/^<!doctype html>/i.test(html)) failures.push(`${name}: document must begin with a valid HTML doctype`);
  if (/fonts\.(?:googleapis|gstatic)\.com/i.test(html)) failures.push(`${name}: third-party font request must be self-hosted`);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length) failures.push(`${name}: duplicate IDs: ${duplicates.join(', ')}`);

  for (const match of html.matchAll(/<(?:a|link|script|img|source)\b[^>]*?\b(?:href|src)="([^"]+)"[^>]*>/gi)) {
    const target = localTarget(path, match[1]);
    if (target && !(await exists(target))) failures.push(`${name}: missing local reference ${match[1]}`);
  }
  for (const style of html.matchAll(/\bstyle="([^"]*)"/gi)) for (const match of style[1].matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
    const target = localTarget(path, match[1]);
    if (target && !(await exists(target))) failures.push(`${name}: missing inline image ${match[1]}`);
  }
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\balt="[^"]*"/i.test(match[0])) failures.push(`${name}: image missing alt text`);
    if (!/\bwidth="\d+"/i.test(match[0]) || !/\bheight="\d+"/i.test(match[0])) failures.push(`${name}: image missing intrinsic width or height`);
  }
  for (const match of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/gi)) if (!/\brel="[^"]*noopener[^"]*"/i.test(match[0])) failures.push(`${name}: target=_blank link missing rel=noopener`);
  for (const match of html.matchAll(/<button\b[^>]*>/gi)) if (!/\btype="(?:button|submit|reset)"/i.test(match[0])) failures.push(`${name}: button must declare an explicit type`);
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc=/i.test(match[1]) || /type="application\/ld\+json"/i.test(match[1]) || !match[2].trim()) continue;
    try { new Function(match[2]); } catch (error) { failures.push(`${name}: invalid inline script: ${error.message}`); }
  }
  for (const match of html.matchAll(/<(?:aside|div)\b[^>]*aria-hidden="true"[^>]*>/gi)) {
    if (/\bclass="[^"]*drawer[^"]*"/i.test(match[0]) && !/\binert(?:\s|>|=)/i.test(match[0])) failures.push(`${name}: closed drawer must be inert`);
    if (/\bclass="[^"]*page-modal[^"]*"/i.test(match[0]) && !/\binert(?:\s|>|=)/i.test(match[0])) failures.push(`${name}: closed modal must be inert`);
  }

  if (name !== 'admin.html') {
    for (const match of html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/gi)) {
      if (!/^assets\/build\/styles\.[a-f0-9]{10}\.min\.css$/.test(match[1]) && !/^https:\/\/fonts\.googleapis\.com\//.test(match[1])) failures.push(`${name}: non-fingerprinted stylesheet ${match[1]}`);
    }
    for (const match of html.matchAll(/<script\b[^>]*src="([^"]+)"/gi)) if (!/^assets\/build\/[a-z-]+\.[a-f0-9]{10}\.min\.js$/.test(match[1])) failures.push(`${name}: non-fingerprinted script ${match[1]}`);
  }
}

const homeHtml = await readFile(join(root, 'index.html'), 'utf8');
for (const [page, canonical] of [
  ['index.html', 'https://samaraorganics.in/'],
  ['products.html', 'https://samaraorganics.in/products.html'],
  ['about.html', 'https://samaraorganics.in/about.html']
]) {
  const publicHtml = await readFile(join(root, page), 'utf8');
  assert.match(publicHtml, new RegExp(`<link rel="canonical" href="${canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), `${page} must declare its production canonical URL.`);
  assert.match(publicHtml, /<meta property="og:image" content="https:\/\/samaraorganics\.in\/assets\/[^" ]+"/, `${page} must expose an absolute Open Graph image.`);
  assert.match(publicHtml, /<meta name="twitter:card" content="summary_large_image"/, `${page} must expose a large Twitter preview.`);
}
const structuredMatch = homeHtml.match(/<script\b[^>]*id="site-structured-data"[^>]*>([\s\S]*?)<\/script>/i);
assert.ok(structuredMatch, 'Homepage must contain the structured-data marker used by the live renderer.');
const structuredFallback = JSON.parse(structuredMatch[1]);
const fallbackProducts = structuredFallback['@graph'].filter(entry => entry['@type'] === 'Product');
assert.equal(fallbackProducts.length, 3, 'Homepage structured data must describe all three launch products.');
assert.ok(fallbackProducts.every(product => /^https:\/\/samaraorganics\.in\/assets\/samara-heritage-(?:milk|ghee|dahi)\.jpg$/.test(product.image)), 'Product structured data must use current heritage packaging artwork.');
assert.doesNotMatch(structuredMatch[1], /samara-(?:milk-bottle|ghee-jar|dahi-bowl|buffalo-logo)\.webp/, 'Structured data must not restore legacy packaging artwork.');
assert.match(homeHtml, /class="concept-packaging-note reveal"[^>]*>Packaging artwork shown is a pre-launch concept\./, 'Homepage product artwork must be clearly identified as a pre-launch concept.');
assert.match(homeHtml, /<form class="batch-checker-form" id="batch-checker-form">[\s\S]*for="batch-code-input">Batch code[\s\S]*maxlength="32" pattern="\[A-Za-z0-9-\]\{5,32\}"[\s\S]*type="submit" id="batch-verify-btn">View Batch Record/, 'Batch lookup must support keyboard submission and match the API code format.');
assert.doesNotMatch(homeHtml, /Verify Purity/, 'Batch lookup controls must not imply an unconditional purity certification.');
assert.ok([...homeHtml.matchAll(/pattern="\[6-9\]\[0-9\]\{9\}"/g)].length >= 5, 'All homepage phone forms must require a valid Indian mobile number.');
assert.match(homeHtml, /id="modal-waitlist"[\s\S]*class="modal-waitlist-field"[\s\S]*type="submit">JOIN THE LIST/, 'Modal waitlist must use the responsive named field layout and an explicit submit control.');
assert.match(homeHtml, /class="launch-offer reveal"[^>]*aria-labelledby="launch-offer-title"[\s\S]*First 14[\s\S]*subscribers receive our[\s\S]*Luxury Farm Tour—free\.[\s\S]*first 14 confirmed Samara subscribers[\s\S]*index\.html\?open=subscribe[\s\S]*Become a subscriber/, 'Homepage must present the complimentary first-14-subscriber farm-tour offer with clear eligibility and a subscription action.');
assert.match(homeHtml, /id="tour-feedback" class="checkout-feedback" role="status" aria-live="polite" tabindex="-1"/, 'Farm-tour booking must retain an announced fallback when WhatsApp opening is blocked.');
assert.match(homeHtml, /class="farm-tour-offer"[\s\S]*tour fee is waived for the first 14 confirmed Samara subscribers/, 'Farm-tour booking must explain how the first-14-subscriber waiver relates to the standard ticket cost.');
assert.doesNotMatch(homeHtml, /batch-traceable|traceable by batch|every drop is traceable|BATCH TRACEABLE|Organic Milking|pure A2 dairy|Test every batch|Batch records for core/i, 'Pre-launch homepage content must not present planned quality or certification claims as completed facts.');
assert.match(homeHtml, /window\.SamaraModal\s*=\s*modalFocus/, 'Home page must expose the shared accessible modal lifecycle to lazy dialogs.');
assert.match(homeHtml, /event\.key\s*===\s*'Escape'/, 'Modal lifecycle must support Escape-to-close.');
assert.match(homeHtml, /isolateBackground/, 'Open dialogs must isolate background content from keyboard and assistive technology.');
const adminHtml = await readFile(join(root, 'admin.html'), 'utf8');
assert.doesNotMatch(adminHtml, /class="operation-row[^"]*"[^>]*style="[^"]*grid-template-columns/i, 'Admin operational rows must not restore rigid inline grid layouts.');
assert.match(adminHtml, /\.operation-row\.inventory-row\s*\{\s*grid-template-columns:/, 'Admin inventory rows must have a named responsive layout.');
assert.match(adminHtml, /@media\(max-width:600px\)[\s\S]*?\.operation-row\.catalog-row,[\s\S]*?grid-template-columns:1fr/, 'Admin operational forms must collapse to one column on phones.');
assert.match(adminHtml, /class="admin-notice"[^>]*role="status"[^>]*aria-live="polite"/, 'Admin updates must have a persistent accessible feedback region.');
assert.match(adminHtml, /class="tabs" role="tablist"[\s\S]*?role="tab" aria-selected="true"/, 'Admin sections must expose accessible tab semantics.');
assert.match(adminHtml, /event\.key === 'ArrowRight'[\s\S]*?event\.key === 'ArrowLeft'/, 'Admin tabs must support left and right arrow navigation.');
assert.match(adminHtml, /RECORDED QUALITY SCORE \(%\)[\s\S]*SAVE BATCH QUALITY RECORD/, 'Admin batch entry must describe a record rather than issuing a certificate or purity claim.');
assert.doesNotMatch(adminHtml, /LOG QUALITY CERTIFICATE|OVERALL PURITY SCORE/, 'Admin batch entry must not imply that an internal record is a certificate.');
assert.match(adminHtml, /submitter\.textContent = 'SAVING…'[\s\S]*?notify\(data\.message/, 'Admin operational updates must expose pending and saved feedback without blocking alerts.');
assert.doesNotMatch(adminHtml, /\balert\s*\(/, 'Admin workflows must use the accessible notice region instead of blocking browser alerts.');
assert.match(adminHtml, /const readAdminJson = async[\s\S]*response\.json\(\)[\s\S]*!response\.ok \|\| !data\.success/, 'Admin API calls must normalize non-JSON and unsuccessful responses.');
assert.match(adminHtml, /select\.disabled = true;[\s\S]*select\.value = previousStatus;[\s\S]*notify\(error\.message, 'error'\)/, 'Failed order-status changes must restore the saved state and prevent duplicate updates.');
assert.match(adminHtml, /create-batch-form'[\s\S]*submitter\.disabled = true; submitter\.textContent = 'SAVING…'[\s\S]*webhook-form'[\s\S]*submitter\.disabled = true; submitter\.textContent = 'PROCESSING…'/, 'Admin batch and payment forms must enforce and expose their in-flight states.');
assert.match(adminHtml, /colspan="9"[^>]*>Failed to load subscriptions: \$\{escapeHtml\(err\.message\)\}/, 'Subscription loading errors must safely span the complete nine-column table.');
assert.match(adminHtml, /const reportManifestError[\s\S]*currentManifest = null[\s\S]*getElementById\('export-manifest'\)\.disabled = true[\s\S]*loadManifest\(\)\.catch\(reportManifestError\)/, 'Manifest failures must clear stale export state and replace the loading row.');
assert.match(adminHtml, /aria-label="Status for support request \$\{escapeHtml\(ticket\.public_reference\)\}"[\s\S]*aria-label="Customer-visible response for support request \$\{escapeHtml\(ticket\.public_reference\)\}"/, 'Generated support controls must identify the record they update.');
assert.match(adminHtml, /aria-label="Status for order \$\{escapeHtml\(order\.id\)\}"/, 'Generated order status controls must identify their order.');
assert.doesNotMatch(homeHtml, /Traditional Dahi[^<\n]{0,80}500 ML|500 ML[^<\n]{0,80}Traditional Dahi/, 'Dahi must use a weight unit consistently in customer-facing content.');
const productsHtml = await readFile(join(root, 'products.html'), 'utf8');
const aboutHtml = await readFile(join(root, 'about.html'), 'utf8');
const privacyHtml = await readFile(join(root, 'privacy.html'), 'utf8');
assert.match(aboutHtml, /<section class="about-hero" id="story">[\s\S]*<section class="build-standard" id="promise">/, 'The combined page must contain both Story and Promise destinations in reading order.');
assert.match(privacyHtml, /typefaces are served from the Samara Organics website rather than requested from a third-party font provider/, 'Privacy disclosures must accurately describe the self-hosted font implementation.');
assert.doesNotMatch(privacyHtml, /loads typefaces from Google Fonts/, 'Privacy disclosures must not claim that removed third-party font requests still occur.');
assert.equal([...productsHtml.matchAll(/class="collection-pack pack-(?:milk|ghee|dahi)"/g)].length, 3, 'The collection hero must present three complete interactive product portraits.');
assert.match(productsHtml, /class="collection-aura"[\s\S]*class="collection-orbit orbit-outer"[\s\S]*class="collection-podium"/, 'The collection hero must retain its layered premium podium composition.');
assert.equal([...productsHtml.matchAll(/class="detail-cta detail-cart-cta"/g)].length, 3, 'Every full product section must include a primary basket action.');
assert.equal([...productsHtml.matchAll(/class="detail-enquire"/g)].length, 3, 'Every full product section must retain a separate question route.');
assert.equal([...productsHtml.matchAll(/class="detail-commerce"[^>]*data-catalog-state="loading"[^>]*aria-live="polite"/g)].length, 3, 'Every full product section must expose a live, announced price and availability panel.');
assert.match(productsHtml, /class="concept-packaging-note light-note"[^>]*>Packaging shown is pre-launch concept artwork\./, 'Product collection must identify its packaging as pre-launch concept artwork.');
assert.doesNotMatch(productsHtml, /alt="Samara A2 Murrah (?:farm-fresh milk bottle|Bilona Desi Ghee jar|Traditional Dahi jar)"/, 'Concept product images must not expose unverified claims as product alt text.');
for (const product of ['Organic%20A2%20Milk', 'Bilona%20Desi%20Ghee', 'Traditional%20Dahi']) {
  assert.match(productsHtml, new RegExp(`index\\.html\\?add=${product}`), `Missing product-to-basket handoff for ${decodeURIComponent(product)}.`);
}
const commerceSource = await readFile(join(root, 'commerce.js'), 'utf8');
assert.match(commerceSource, /drawerReturnFocus/, 'Cart drawer must retain its opening control for focus restoration.');
assert.match(commerceSource, /transitionend[\s\S]*restoreFocus/, 'Cart drawer must restore opener focus after its closing transition.');
assert.doesNotMatch(commerceSource, /\balert\s*\(/, 'Checkout failures must use accessible inline feedback instead of blocking alerts.');
assert.match(homeHtml, /id="checkout-feedback"[^>]*role="alert"[^>]*aria-live="assertive"/, 'Checkout must contain an assertive inline feedback region.');
assert.match(commerceSource, /setCheckoutFeedback\(`We could not place the order:[\s\S]*checkoutFeedback\?\.focus/, 'Order failures must be announced and focused for recovery.');
assert.match(commerceSource, /checkoutForm\?\.setAttribute\('aria-busy', 'true'\)[\s\S]*checkoutForm\?\.removeAttribute\('aria-busy'\)/, 'Checkout must announce its processing state.');
assert.match(commerceSource, /const indiaDate = offset => new Intl\.DateTimeFormat\('en-CA', \{ timeZone: 'Asia\/Kolkata'[\s\S]*checkoutDate\.min = indiaDate\(0\)[\s\S]*checkoutDate\.max = indiaDate\(30\)/, 'Checkout delivery bounds must use the India calendar day rather than the visitor device timezone.');
assert.match(commerceSource, /if \(orderSubmissionInProgress\) return;[\s\S]*orderSubmissionInProgress = true;[\s\S]*await refreshDeliveryAvailability\(\)[\s\S]*orderSubmissionInProgress = false/, 'Checkout must guard the asynchronous capacity check against duplicate submissions.');
assert.match(commerceSource, /async function readApiJson[\s\S]*response\.json\(\)[\s\S]*order service returned an unreadable response/, 'Checkout must replace non-JSON gateway responses with useful customer feedback.');
assert.match(commerceSource, /OPEN WHATSAPP TO CONFIRM[\s\S]*success-primary-link/, 'WhatsApp orders must retain a visible confirmation link when popup opening is blocked.');
assert.doesNotMatch(commerceSource, /setTimeout\(\(\) => \{\s*window\.open\(/, 'WhatsApp confirmation must not rely on a delayed popup that browsers can block.');
const homeSource = await readFile(join(root, 'script.js'), 'utf8');
assert.match(homeSource, /new URLSearchParams\(location\.search\)\.get\('add'\)/, 'Homepage must consume product detail basket handoffs.');
assert.match(homeSource, /await loadCommerce\(\)[\s\S]*addButton\.click\(\)/, 'Product detail handoffs must pass through the live catalogue and cart flow.');
assert.match(homeSource, /navigationEntry\?\.type === 'reload'[\s\S]*history\.scrollRestoration = 'manual'[\s\S]*scrollTo\(\{ top: 0/, 'A deliberate homepage refresh must clear stale anchor and scroll restoration.');
assert.match(homeSource, /sectionNavigation[\s\S]*aria-current', 'location'[\s\S]*updateSectionNavigation\(\);/, 'Homepage navigation must expose the currently viewed section without changing link destinations.');
assert.match(homeSource, /RECORDED RESULT[\s\S]*REVIEW REQUIRED[\s\S]*Batch Quality Record[\s\S]*RECORDED QUALITY SCORE/, 'Batch verification must clearly distinguish recorded results from results requiring review.');
assert.doesNotMatch(homeSource, /Quality Assurance Certificate|<span>PASSED<\/span>|PURITY SCORE/, 'Batch verification must not convert an internal record into an unconditional certificate or pass claim.');
assert.doesNotMatch(homeSource, /Checking certificate|Certificate verification failed/, 'Batch loading and error states must use record-accurate language.');
assert.match(homeSource, /batchCheckerForm\?\.addEventListener\('submit'[\s\S]*\^\[A-Z0-9-\]\{5,32\}\$[\s\S]*batchCheckerForm\.setAttribute\('aria-busy'[\s\S]*encodeURIComponent\(code\)[\s\S]*cache: 'no-store'[\s\S]*\.finally/, 'Batch lookup must validate, encode, avoid caching and expose its processing state.');
assert.match(homeSource, /errorMessage\.textContent = `Batch record lookup failed:/, 'Batch lookup errors must be rendered as text instead of injected markup.');
assert.match(homeSource, /waitlist\?\.querySelector\('input'\)\?\.addEventListener\('input'[\s\S]*\^\[6-9\]\\d\{9\}\$/, 'Homepage waitlist must sanitize input and reject invalid ten-digit numbers.');
assert.match(homeSource, /const loadFarmTour[\s\S]*farmTourPromise = null; throw error[\s\S]*pointerenter'[\s\S]*\.catch\(\(\) => \{\}\)[\s\S]*Farm-tour booking is temporarily unavailable/, 'Farm-tour lazy loading must be retryable and expose a calm failure notice without unhandled rejections.');
assert.match(homeSource, /It is not an organic certification or an A2 laboratory certificate\./, 'Batch verification must state the limits of the displayed record.');
const databaseSource = await readFile(join(root, 'database.js'), 'utf8');
assert.match(databaseSource, /DELETE FROM batches WHERE id IN \('B2026-0712', 'B2026-0711', 'G2026-0701'\)/, 'Database initialization must remove public design-demo batch records.');
assert.doesNotMatch(databaseSource, /INSERT[^;]*B2026-(?:0711|0712)|INSERT[^;]*G2026-0701/is, 'Database initialization must never republish design-demo batch records.');
const serverSource = await readFile(join(root, 'server.js'), 'utf8');
assert.match(serverSource, /app\.get\('\/api\/batches\/:id'[\s\S]*Cache-Control', 'no-store'[\s\S]*Batch quality record not found\./, 'Public batch lookups must be uncached and use record-accurate language.');
assert.match(serverSource, /app\.use\('\/api', \(_request, response\) => \{[\s\S]*Cache-Control', 'no-store'[\s\S]*status\(404\)\.json\(\{ success: false, message: 'API endpoint not found\.'/, 'Unknown API routes must return uncached JSON instead of an HTML error document.');
assert.match(serverSource, /const listenerWatchdog = setInterval\([\s\S]*server\.listening[\s\S]*shutdown\('listener-watchdog', 1\)[\s\S]*clearInterval\(listenerWatchdog\)/, 'The HTTP listener must remain referenced and report silent listener loss.');
const sourceStyles = await readFile(join(root, 'styles.css'), 'utf8');
assert.match(sourceStyles, /\.launch-offer\s*\{[\s\S]*grid-template-columns:[\s\S]*background:[\s\S]*\.products \.concept-packaging-note\s*\{[\s\S]*color:\s*#405148/, 'Launch offer and packaging disclosure must use a premium, readable high-contrast treatment.');
assert.match(sourceStyles, /\.modal-waitlist-field\s*\{[\s\S]*grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto[\s\S]*@media \(max-width: 520px\)[\s\S]*\.modal-waitlist-field button\s*\{\s*grid-column:\s*1 \/ -1/, 'Modal waitlist controls must reflow instead of overlapping on narrow phones.');
assert.match(sourceStyles, /@media \(max-width: 760px\)[\s\S]*?\.launch-offer\s*\{\s*grid-template-columns:\s*1fr/, 'The launch offer must collapse to one column on narrow screens.');
assert.match(sourceStyles, /\.track-ring\.tr1\s*\{\s*width:\s*min\(100%,\s*460px\)[\s\S]*?\.track-core\s*\{\s*width:\s*min\(180px,\s*46vw\)/, 'Tracking artwork must size from its container instead of retaining desktop-only widths on phones.');
assert.match(sourceStyles, /\.tracking-items\s*>\s*div\s*\{\s*gap:\s*14px[\s\S]*?\.tracking-items b\s*\{[^}]*overflow-wrap:\s*anywhere[\s\S]*?@media \(max-width: 420px\)[\s\S]*?\.tracking-items\s*>\s*div\s*\{\s*flex-direction:\s*column/, 'Long tracked product names and quantities must stack instead of colliding on narrow phones.');
assert.match(sourceStyles, /@media \(max-width: 420px\)[\s\S]*?\.legal-hero h1\s*\{\s*font-size:\s*clamp\(50px,\s*17vw,\s*67px\);\s*overflow-wrap:\s*anywhere/, 'Long portal headings must remain inside very narrow viewports.');
assert.match(sourceStyles, /\.whatsapp-fab\s*\{[\s\S]*?bottom:\s*max\(112px,[\s\S]*?\.back-to-top\s*\{[\s\S]*?bottom:\s*max\(184px,/, 'Floating WhatsApp, cart and back-to-top controls must occupy separate rail positions.');
assert.match(sourceStyles, /@media \(max-width: 520px\)[\s\S]*?\.drawer-item\s*\{[\s\S]*?grid-template-columns:\s*46px minmax\(0, 1fr\) auto/, 'Compact basket rows must use a collision-safe grid at phone widths.');
assert.match(sourceStyles, /\.form-field input,[\s\S]*?\.form-field select\s*\{\s*font-size:\s*16px;/, 'Transactional controls must remain at least 16px to prevent mobile browser zoom.');
assert.match(sourceStyles, /Readability floor for functional labels[\s\S]*?\.tracking-intro label,[\s\S]*?font-size:\s*11px;[\s\S]*?\.tracking-meta small\s*\{\s*font-size:\s*10px;[\s\S]*?\.tracking-meta b\s*\{\s*font-size:\s*12px;/, 'Functional labels and order status details must not render at legacy 6–8px sizes.');
assert.match(sourceStyles, /\.logo-seal,[\s\S]*?\.track-core,[\s\S]*?background-image:\s*url\("assets\/samara-heritage-logo\.jpg"\)/, 'Secondary brand marks must use the current heritage logo.');
assert.match(sourceStyles, /Current Samara wordmark[\s\S]*?\.logo-img\s*\{[\s\S]*?object-fit:\s*contain;[\s\S]*?\.loader-logo-img\s*\{[\s\S]*?object-fit:\s*contain;[\s\S]*?\.logo-seal,[\s\S]*?background-size:\s*contain;/, 'The current full wordmark must render uncropped in primary and secondary logo placements.');
assert.match(sourceStyles, /@media \(max-width: 700px\)[\s\S]*?header\.open > nav[\s\S]*?max-height:\s*calc\(100dvh - 76px\)[\s\S]*?overflow-y:\s*auto/, 'Expanded mobile navigation must remain scrollable in short and zoomed viewports.');
assert.match(sourceStyles, /@media \(max-width: 700px\)[\s\S]*?input,[\s\S]*?textarea\s*\{\s*font-size:\s*16px;/, 'Phone-sized form controls must prevent browser zoom and control overlap.');
assert.match(sourceStyles, /@media\(prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{[\s\S]*?animation-duration:\.01ms!important;[\s\S]*?transition-duration:\.01ms!important;/, 'Every animation and transition must respect reduced-motion preferences.');
for (const page of ['index.html', 'products.html', 'about.html']) {
  const html = await readFile(join(root, page), 'utf8');
  assert.doesNotMatch(html, /samara-mark\.svg|A2 Murrah buffalo logo|Murrah buffalo logo/, `${page} must not reference the superseded logo or old logo alt text.`);
  assert.match(html, /<nav id="primary-navigation">/, `${page} must identify the controlled primary navigation.`);
  assert.match(html, /class="menu"[^>]*aria-expanded="false"[^>]*aria-controls="primary-navigation"/, `${page} menu must expose its controlled navigation.`);
  assert.match(html, /href="about\.html#story">Our story<\/a>[\s\S]*href="about\.html#promise">Our promise<\/a>/, `${page} must keep Story and Promise on the combined page.`);
}
for (const sourceName of ['script.js', 'page.js']) {
  const source = await readFile(join(root, sourceName), 'utf8');
  assert.match(source, /event\.key === 'Escape'[\s\S]*closeMenu\(true\)/, `${sourceName} must close mobile navigation with Escape and restore focus.`);
  assert.match(source, /documentElement\.classList\.toggle\('nav-open', open\)/, `${sourceName} must lock background scrolling while navigation is open.`);
}
const cataloguePageSource = await readFile(join(root, 'page.js'), 'utf8');
assert.match(cataloguePageSource, /localSectionNavigation[\s\S]*url\.pathname !== location\.pathname[\s\S]*aria-current', 'location'/, 'The combined Story and Promise page must announce its current section.');
assert.match(cataloguePageSource, /fetch\('\/api\/catalog',[\s\S]*cache: 'no-store'/, 'Full product pages must request the live catalogue without relying on stale browser cache.');
assert.match(cataloguePageSource, /AVAILABLE TO ORDER[\s\S]*CURRENTLY UNAVAILABLE/, 'Full product pages must render both active and unavailable catalogue states.');
assert.match(cataloguePageSource, /setAttribute\('aria-disabled', String\(!product\.active\)\)/, 'Unavailable product actions must expose their disabled state accessibly.');
const subscriptionSource = await readFile(join(root, 'subscription-booking.js'), 'utf8');
assert.match(subscriptionSource, /document\.createElement\('button'\)[\s\S]*?cell\.type = 'button'/, 'Subscription dates must render as native buttons.');
assert.match(subscriptionSource, /setAttribute\('aria-pressed', String\(selected\)\)/, 'Subscription dates must announce their selected state.');
assert.match(subscriptionSource, /event\.key === 'ArrowRight'[\s\S]*?event\.key === 'ArrowUp'/, 'Subscription calendar must support four-way arrow navigation.');
assert.match(subscriptionSource, /if \(isWeekend\) cell\.classList\.add\('day-weekend'\)/, 'Weekend styling must be applied after the primary date state.');
assert.doesNotMatch(subscriptionSource, /document\.createElement\('span'\);\s*cell\.textContent/, 'Interactive subscription dates must not regress to generic spans.');
assert.match(homeHtml, /id="sub-feedback"[^>]*role="alert"[^>]*aria-live="assertive"/, 'Subscription booking must contain an assertive inline feedback region.');
for (const phoneId of ['checkout-phone', 'sub-phone', 'tour-phone']) assert.match(homeHtml, new RegExp(`id="${phoneId}"[^>]*inputmode="numeric"[^>]*autocomplete="tel"[^>]*pattern="\\[6-9\\]\\[0-9\\]\\{9\\}"`), `${phoneId} must reject impossible Indian mobile numbers before submission.`);
assert.match(sourceStyles, /\.phone-input-wrapper input\s*\{[\s\S]*?flex:\s*1;[\s\S]*?min-width:\s*0;/, 'Phone number controls must not overflow their prefix wrapper on narrow screens.');
assert.match(sourceStyles, /@media \(max-width: 700px\)[\s\S]*?\.page-modal \.modal-scroll-content\s*\{\s*padding-top:\s*64px;[\s\S]*?\.page-modal \.modal-head\s*\{\s*padding-right:\s*58px;[\s\S]*?\.page-modal \.modal-close/, 'Mobile modal headings must reserve room for the close button.');
assert.match(subscriptionSource, /OPEN WHATSAPP TO CONFIRM[\s\S]*SAVE YOUR PRIVATE MANAGEMENT LINK/, 'WhatsApp subscriptions must retain visible confirmation and management links.');
assert.match(subscriptionSource, /subPhone\?\.addEventListener\('input'[\s\S]*?replace\(\/\\D\/g, ''\)\.slice\(0, 10\)/, 'Subscription phone entry must sanitize pasted non-digits.');
assert.match(subscriptionSource, /if \(subForm\?\.hasAttribute\('aria-busy'\)\) return;[\s\S]*subscription service returned an unreadable response/, 'Subscription booking must prevent repeat submissions and explain non-JSON service failures.');
assert.doesNotMatch(subscriptionSource, /setTimeout\(\(\) => \{\s*window\.open\(/, 'Subscription confirmation must not rely on a delayed popup that browsers can block.');
assert.match(homeHtml, /id="site-notice"[^>]*role="status"[^>]*aria-live="polite"/, 'Storefront must expose a calm accessible notice region.');
for (const sourceName of ['script.js', 'commerce.js', 'subscription-booking.js', 'farm-tour.js', 'page.js']) {
  const source = await readFile(join(root, sourceName), 'utf8');
  assert.doesNotMatch(source, /\balert\s*\(/, `${sourceName} must not use blocking browser alerts.`);
}
const farmTourSource = await readFile(join(root, 'farm-tour.js'), 'utf8');
assert.match(farmTourSource, /const url = `https:\/\/wa\.me[\s\S]*feedback\.innerHTML = `[\s\S]*OPEN WHATSAPP[\s\S]*OPEN WHATSAPP AGAIN/, 'Farm-tour booking must keep a visible WhatsApp fallback link after attempting to open the app.');
assert.doesNotMatch(farmTourSource, /window\.open\([^;]+;\s*close\(\)/, 'Farm-tour booking must not discard its form immediately after a potentially blocked popup.');
assert.match(farmTourSource, /phoneInput\?\.addEventListener\('input'[\s\S]*?replace\(\/\\D\/g, ''\)\.slice\(0, 10\)/, 'Farm-tour phone entry must sanitize pasted non-digits.');
assert.match(farmTourSource, /We would love to welcome you to our farm!/, 'Farm-tour confirmation language must describe the customer visiting Samara, not the reverse.');
assert.match(farmTourSource, /Standard Booking Ticket Cost:[\s\S]*Founding Subscriber Offer:[\s\S]*complimentary farm tour for the first 14 confirmed subscribers/, 'Farm-tour WhatsApp request must ask the team to verify the first-14-subscriber waiver.');
const trackingSource = await readFile(join(root, 'tracking.js'), 'utf8');
assert.doesNotMatch(trackingSource, /\bconfirm\s*\(/, 'Order cancellation must not use a blocking browser confirmation.');
assert.match(trackingSource, /dataset\.confirming[\s\S]*CONFIRM ORDER CANCELLATION[\s\S]*setTimeout/, 'Order cancellation must use a time-limited two-step confirmation.');
assert.match(trackingSource, /form\.setAttribute\('aria-busy', 'true'\)[\s\S]*form\.removeAttribute\('aria-busy'\)/, 'Order tracking must announce its loading state.');
assert.match(trackingSource, /presentStatus\(statusHeading, order\.status\)[\s\S]*result\.focus\(\{ preventScroll: true \}\)/, 'Tracked order state must receive premium status styling and focus its refreshed result.');
assert.match(trackingSource, /const isPrivateToken = value =>[\s\S]*if \(isPrivateToken\(normalizedToken\)\) track\(normalizedToken\)/, 'Order tracking must reject malformed private links before making a request.');
assert.match(trackingSource, /async function readApiJson[\s\S]*order service returned an unreadable response[\s\S]*cancellation service returned an unreadable response/, 'Order tracking and cancellation must replace malformed gateway responses with useful customer feedback.');
assert.match(trackingSource, /const customerError[\s\S]*order service is temporarily unavailable[\s\S]*Order cancellation is temporarily unavailable/, 'Order tracking must replace browser network errors with calm recovery guidance.');
const managerSource = await readFile(join(root, 'manage-subscription.js'), 'utf8');
assert.doesNotMatch(managerSource, /\bconfirm\s*\(/, 'Subscription cancellation must not use a blocking browser confirmation.');
assert.match(managerSource, /pauseButton\.hidden = item\.status !== 'Active'[\s\S]*resumeButton\.hidden = item\.status !== 'Paused'[\s\S]*cancelButton\.hidden = cancelled/, 'Subscription controls must reflect the current lifecycle state.');
assert.match(managerSource, /await load\(\{ clearStatus: false \}\); statusBox\.textContent = 'Saved successfully\.'/, 'Successful subscription updates must retain their confirmation message.');
assert.match(managerSource, /setBusy\(true\)[\s\S]*finally \{ setBusy\(false\); \}/, 'Subscription updates must prevent duplicate actions while saving.');
assert.match(managerSource, /presentStatus\(subscriptionState, item\.status\)/, 'Subscription lifecycle must expose a styled live state.');
assert.match(managerSource, /if \(isPrivateToken\(token\)\)[\s\S]*complete private management link/, 'Subscription management must explain malformed or missing private links without requesting an invalid route.');
assert.match(managerSource, /get\('token'\)[\s\S]*trim\(\)\.toLowerCase\(\)/, 'Subscription management must normalize private UUID casing before requesting the API.');
assert.match(managerSource, /async function readApiJson[\s\S]*subscription service returned an unreadable response/, 'Subscription management must replace malformed gateway responses with useful customer feedback.');
assert.match(managerSource, /const \{ subscription: item \} = await request\(\)[\s\S]*await load\(\{ clearStatus: false \}\); statusBox\.textContent = 'Saved successfully\.'[\s\S]*catch \(error\)/, 'Subscription management must only report success after the refreshed subscription state loads successfully.');
const supportSource = await readFile(join(root, 'support.js'), 'utf8');
assert.match(supportSource, /form\.setAttribute\('aria-busy', 'true'\)[\s\S]*form\.removeAttribute\('aria-busy'\)/, 'Support submission must announce its processing state.');
assert.match(supportSource, /loadStatus\(data\.statusToken, \{ focus: true \}\)/, 'New support requests must move focus to their status record.');
assert.match(supportSource, /presentStatus\(ticketState, ticket\.status\)/, 'Support lifecycle must expose a styled live state.');
assert.match(supportSource, /if \(isPrivateToken\(privateToken\)\) loadStatus\(privateToken\)[\s\S]*support link is incomplete/, 'Support status must reject malformed private links with a clear recovery message.');
assert.match(supportSource, /async function readApiJson[\s\S]*support service returned an unreadable response/, 'Support status and submission must replace malformed gateway responses with useful customer feedback.');
assert.match(supportSource, /const customerError[\s\S]*Support status is temporarily unavailable[\s\S]*Support requests are temporarily unavailable/, 'Support pages must replace browser network errors with calm recovery guidance.');
const manageHtml = await readFile(join(root, 'manage-subscription.html'), 'utf8');
assert.match(manageHtml, /class="legal-document subscription-manager" id="subscription-manager"/, 'Subscription manager must expose its busy container.');
assert.match(manageHtml, /id="subscription-state" class="portal-state"/, 'Subscription manager must provide a dedicated lifecycle badge.');
const supportHtml = await readFile(join(root, 'support.html'), 'utf8');
assert.match(supportHtml, /id="ticket-status" hidden tabindex="-1"/, 'Support status panel must be programmatically focusable.');
assert.match(supportHtml, /id="ticket-state" class="portal-state"/, 'Support portal must provide a dedicated lifecycle badge.');
const trackingHtml = await readFile(join(root, 'track.html'), 'utf8');
assert.match(trackingHtml, /class="tracking-result" hidden aria-live="polite" tabindex="-1"/, 'Tracking result must be programmatically focusable.');
assert.match(sourceStyles, /\.tracking-meta\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/, 'Order metadata must use a balanced collision-safe grid.');
assert.match(sourceStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.portal-status-reveal\s*\{\s*animation:\s*none/, 'Portal status transitions must respect reduced-motion preferences.');
assert.match(sourceStyles, /header nav a\[aria-current="location"\][\s\S]*header\.open > nav a\[aria-current="location"\]::after/, 'Current-section navigation styling must cover desktop and collision-safe mobile states.');
assert.match(sourceStyles, /\.collection-podium[\s\S]*@keyframes collectionPackFloat[\s\S]*@keyframes collectionOrbit/, 'The collection hero must retain its podium, floating packs and orbital motion.');
assert.match(sourceStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.collection-orbit,[\s\S]*\.pack-frame\s*\{\s*animation:\s*none !important;/, 'The collection hero must disable decorative motion for reduced-motion users.');

for (const cssName of ['styles.css', ...(await readdir(join(root, 'assets', 'build'))).filter(name => name.endsWith('.css')).map(name => join('assets', 'build', name))]) {
  const path = join(root, cssName);
  const css = await readFile(path, 'utf8');
  for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) {
    const target = localTarget(path, match[1]);
    if (target && !(await exists(target))) failures.push(`${cssName}: missing CSS asset ${match[1]}`);
  }
}

const worker = await readFile(join(root, 'service-worker.js'), 'utf8');
for (const match of worker.matchAll(/'\.\/([^']+)'/g)) {
  const target = localTarget(join(root, 'service-worker.js'), match[1]);
  if (target && !(await exists(target))) failures.push(`service-worker.js: missing precache asset ${match[1]}`);
}
assert.doesNotMatch(worker, /'\.\/(?:track|support|manage-subscription|admin)\.html'/, 'Private portal shell must not be precached.');
assert.doesNotMatch(worker, /assets\/build\/(?:farm-tour|subscription-booking|commerce|tracking|support|subscription-manager)\.[a-f0-9]+\.min\.js/, 'Feature and private-portal modules must remain network-lazy instead of downloading during service-worker installation.');
assert.match(worker, /event\.request\.mode === 'navigate'[\s\S]*fetch\(event\.request\)[\s\S]*caches\.match/, 'Document requests must be network-first with an offline fallback.');
for (const asset of ['logo', 'hero']) assert.match(worker, new RegExp(`samara-heritage-${asset}\\.jpg`), `Service worker must precache essential ${asset} artwork.`);
assert.doesNotMatch(worker, /samara-heritage-(?:milk|ghee|dahi)\.jpg|samara-delaval-milking\.webp/, 'Offline installation must not eagerly download below-the-fold product and editorial artwork.');
assert.doesNotMatch(worker, /samara-(?:milk-bottle|ghee-jar|dahi-bowl|buffalo-logo)\.webp/, 'Service worker must not precache legacy product artwork.');
const legacyArtworkPattern = /samara-(?:hero-3d-wide(?:\.jpg|\.webp)|mark-source(?:\.jpg|\.webp)|farm-hero(?:\.jpg|\.webp)|dahi-bowl\.webp|ghee-jar\.webp|milk-bottle\.webp|buffalo-logo\.webp)/;
assert.doesNotMatch(sourceStyles, legacyArtworkPattern, 'Compiled source styles must not retain superseded artwork references.');
assert.doesNotMatch(worker, legacyArtworkPattern, 'Offline caching must not retain superseded artwork references.');
for (const legacyAsset of [
  'samara-hero-3d-wide.jpg', 'samara-hero-3d-wide.webp',
  'samara-mark-source.jpg', 'samara-mark-source.webp',
  'samara-mark.svg',
  'samara-farm-hero.jpg', 'samara-farm-hero.webp',
  'samara-dahi-bowl.webp', 'samara-ghee-jar.webp',
  'samara-milk-bottle.webp', 'samara-buffalo-logo.webp'
]) assert.equal(await exists(join(root, 'assets', legacyAsset)), false, `Superseded production asset must not ship: ${legacyAsset}`);
const buildScript = await readFile(join(root, 'scripts', 'build-assets.mjs'), 'utf8');
assert.match(buildScript, /releaseHash[\s\S]*\[\.\.\.built\.values\(\)\]/, 'Offline cache releases must change when any built asset changes.');
const manifest = JSON.parse(await readFile(join(root, 'manifest.webmanifest'), 'utf8'));
assert.ok(manifest.icons.some(icon => icon.src === 'assets/samara-heritage-logo.jpg' && icon.sizes === '1254x1254'), 'Installable app icon metadata must match the current logo dimensions.');
const sourcePngs = (await readdir(join(root, 'assets'))).filter(name => name.toLowerCase().endsWith('.png'));
assert.deepEqual(sourcePngs, [], `Unused source PNG files must not ship from assets/: ${sourcePngs.join(', ')}`);
assert.deepEqual(failures, [], failures.join('\n'));
console.log(`Static site audit passed for ${htmlFiles.length} HTML files.`);

import { localizedPath } from '/locale.js';
import { main, api, escape, icons, date, locate, notice, toast, t } from '/common.js';
import { mountSocial } from '/social.js';
import { privateRepliesHtml } from '/tasks.js';

const exchangeNote = () => t('ScaleTag is a place to talk. Offers are expressions of interest, not orders or confirmed deals. Arrange any exchange and payment directly; ScaleTag does not process transactions or hold money.', 'ScaleTag 只提供交流空间。出价仅表示意向，不是订单，也不代表成交。交换和付款请双方自行商定，平台不处理交易，也不保管资金。');
export const saleStateLabel = state => state === 'closed' ? t('Closed', '已关闭') : t('Open for offers', '接受出价');
const showError = (node, error) => { if (!node) return; node.textContent = error.message; node.hidden = false; };

export function createSale() {
  document.title = t('Create a sale — ScaleTag', '发布摆卖 — ScaleTag');
  document.querySelector('[data-nav="create"]').classList.add('active');
  main.innerHTML = `<section class="create-section"><aside class="section-intro"><a class="back-link" href="/">${t('← Back to home', '← 返回首页')}</a><span class="eyebrow">${t('PASS SOMETHING ON', '让闲置遇到需要的人')}</span><h1>${t('A new home. <br>For something good.', '身边的闲置，<br>也许正有人需要。')}</h1><p>${t('Post an item, add your photos and hear from people nearby.', '发几张照片，说说物品的情况，和附近感兴趣的人聊一聊。')}</p><div class="rules"><p>${icons.clock} ${t('Expires 30 days after publication.', '发布 30 天后到期。')}</p><p>${icons.shield} ${t('Save your private management link.', '请保存好私人管理链接。')}</p></div><p>${exchangeNote()}</p></aside><form id="sale-form" class="form-card"><div class="post-kind-switch" aria-label="${t('Post type', '发布类型')}"><a href="/create">${t('Poll', '投票')}</a><a href="/create/task">${t('Task', '任务')}</a><a href="/create/sale" aria-current="page">${t('Sale', '摆卖')}</a></div><div class="form-heading"><h2>${t('Create a sale', '发布摆卖')}</h2></div><label for="sale-title">${t('Item title', '卖什么？')}</label><input id="sale-title" maxlength="140" required placeholder="${t('e.g. A well-loved reading chair', '例如：一把舒适的阅读椅')}"><label for="sale-description">${t('Description and condition', '物品介绍与成色')}</label><textarea id="sale-description" maxlength="4000" rows="5" required placeholder="${t('Describe the condition, any flaws and how you would like to meet.', '说说使用情况、瑕疵和方便见面的方式，请勿填写私人联系方式。')}"></textarea><label for="sale-price">${t('Asking price', '期望价格')}</label><input id="sale-price" maxlength="160" required placeholder="${t('e.g. CAD 25, negotiable, or free', '例如：25 加元、价格可议或免费赠送')}"><label for="sale-images">${t('Photos (optional)', '物品照片（选填）')}</label><input id="sale-images" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-describedby="sale-image-hint sale-image-error"><p class="field-hint" id="sale-image-hint">${t('Up to 3 JPEG, PNG or WebP photos. Each original must be at most 1 MiB (1,048,576 bytes). Originals are uploaded to the server for validation. Photos over 600 KiB are compressed to at most 300 KiB; smaller photos keep as much quality as possible. Photos are public; check for faces, addresses and other private details.', '最多 3 张 JPEG、PNG 或 WebP 照片，每张原图不超过 1 MiB（1,048,576 字节）。原图上传后由服务器验证，超过 600 KiB 的照片会压至不超过 300 KiB；较小的照片尽量保留画质。照片会公开，请先检查是否露出人脸、地址或其他隐私。')}</p><p id="sale-image-error" class="form-error" role="alert" hidden></p><div id="sale-photo-preview" class="sale-photo-preview"></div><label for="sale-name">${t('Your name (optional, unverified)', '你的名字（选填，未经验证）')}</label><input id="sale-name" maxlength="60"><p class="field-hint">${t('The description, price and name are public. Leave private contact details out of these fields.', '物品介绍、价格和姓名会公开显示，请勿在这些地方填写私人联系方式。')}</p><div class="location-box"><div><strong>${icons.pin} ${t('Help people nearby find it', '让附近的人找到它')}</strong><p id="sale-location-status" aria-live="polite">${t('Location is required. Only a rounded area appears on the map.', '发布时需要获取位置，地图只显示大致区域。')}</p></div><button id="sale-locate" class="button secondary small" type="button">${t('Enable location', '获取位置')}</button></div><label class="checkbox-row"><input id="sale-map-consent" type="checkbox" required><span>${t('I agree to show the approximate area on the public map. This does not guarantee anonymity.', '我同意在地图上公开显示大致区域。我了解这不能保证匿名。')}</span></label>${notice()}<label class="checkbox-row"><input id="sale-retention" type="checkbox" required><span>${t('I understand that this sale, its photos, offers and contact details leave the website 30 days after publication. Private daily backups are kept for up to 90 days after creation.', '我了解摆卖、照片、出价及联系方式会在发布 30 天后从网站移除，私有每日备份从创建之日起最多保留 90 天。')}</span></label><p class="field-hint">${t('Offer amounts, names and messages are public. Contact details are visible only through your private management link and to ScaleTag administrators and private backups. Save the link; it cannot be recovered.', '出价金额、姓名和留言会公开；联系方式只在私人管理页面显示，ScaleTag 管理员和私有备份也可访问。请保存好管理链接，丢失后无法找回。')}</p><button id="publish-sale" class="button publish-button" type="submit">${t('Publish sale', '发布摆卖')} ${icons.arrow}</button><p id="sale-progress" role="status" aria-live="polite"></p><p id="sale-error" class="form-error" role="alert" hidden></p></form></section>`;
  let position, locatedAt = 0, publishing = false;
  const filesInput = main.querySelector('#sale-images');
  const imageError = main.querySelector('#sale-image-error');
  function validateFiles() {
    const files = [...filesInput.files];
    if (files.length > 3) throw new Error(t('Choose no more than 3 photos.', '最多只能选择 3 张照片。'));
    for (const file of files) {
      if (file.size > 1048576) throw new Error(t(`${file.name}: the original photo exceeds 1 MiB. Choose a smaller original.`, `${file.name}：原图超过 1 MiB，请选择较小的原图。`));
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(t(`${file.name}: choose a JPEG, PNG or WebP photo.`, `${file.name}：请选择 JPEG、PNG 或 WebP 照片。`));
    }
    return files;
  }
  let previewURLs = [];
  function clearPreviews() { previewURLs.forEach(url => URL.revokeObjectURL(url)); previewURLs = []; main.querySelector('#sale-photo-preview').replaceChildren(); }
  filesInput.onchange = () => {
    clearPreviews(); imageError.hidden = true;
    try {
      for (const file of validateFiles()) {
        const url = URL.createObjectURL(file); previewURLs.push(url);
        const figure = document.createElement('figure'), img = document.createElement('img'), caption = document.createElement('figcaption');
        img.src = url; img.alt = file.name; caption.textContent = `${file.name} · ${Math.ceil(file.size / 1024)} KiB`;
        figure.append(img, caption); main.querySelector('#sale-photo-preview').append(figure);
      }
    } catch (e) { showError(imageError, e); }
  };
  window.addEventListener('pagehide', () => previewURLs.forEach(url => URL.revokeObjectURL(url)), {once:true});
  const locateButton = main.querySelector('#sale-locate');
  async function getLocation() {
    position = await locate(); locatedAt = Date.now();
    main.querySelector('#sale-location-status').textContent = t('Location ready. Only your approximate area will be public.', '位置已获取，只会公开显示大致区域。');
  }
  locateButton.onclick = async () => { locateButton.disabled = true; try { await getLocation(); } catch (e) { position = undefined; main.querySelector('#sale-location-status').textContent = e.message; } finally { locateButton.disabled = false; } };
  main.querySelector('#sale-form').onsubmit = async event => {
    event.preventDefault(); if (publishing) return;
    const error = main.querySelector('#sale-error'), button = main.querySelector('#publish-sale'), progress = main.querySelector('#sale-progress');
    error.hidden = true; publishing = true; button.disabled = true;
    try {
      const files = validateFiles();
      progress.textContent = t('Preparing original photos…', '正在读取原始照片…');
      const images = await Promise.all(files.map(file => new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error(t('Could not read a photo. Select it again.', '无法读取照片，请重新选择。'))); reader.readAsDataURL(file);
      })));
      if (!position || Date.now() - locatedAt > 300000) await getLocation();
      progress.textContent = t('Uploading and checking photos. Please wait…', '正在上传并验证照片，请稍候…');
      const value = id => main.querySelector(id).value.trim();
      const sale = await api('/api/sales', {title:value('#sale-title'), description:value('#sale-description'), price:value('#sale-price'), signature:value('#sale-name'), images, location:position, mapVisible:main.querySelector('#sale-map-consent').checked, retentionAccepted:main.querySelector('#sale-retention').checked});
      location.assign(localizedPath(`/sale/${sale.id}/manage?created=1#key=${sale.manageKey}`));
    } catch (e) { showError(error,e); progress.textContent = ''; button.disabled = false; } finally { publishing = false; }
  };
}

export async function salePage(id, {manage = false} = {}) {
  const key = new URLSearchParams(location.hash.slice(1)).get('key');
  if (manage && !/^[a-f0-9]{64}$/.test(key ?? '')) throw new Error(t('This management link is incomplete. Open the full private link saved when the sale was published.', '管理链接不完整，请打开发布摆卖时保存的完整私人链接。'));
  let sale = await api(`/api/sales/${id}${manage ? '/manage' : ''}`, manage ? {key} : undefined);
  document.title = `${manage ? t('Manage: ', '管理：') : ''}${sale.title} — ScaleTag`;
  const publicLink = `${location.origin}/sale/${id}`, privateLink = `${publicLink}/manage#key=${key}`;
  main.innerHTML = `<section class="poll-layout"><div class="poll-main"><a class="back-link" href="/PostList">${t('← Back to PostList', '← 返回帖子列表')}</a>${manage && new URLSearchParams(location.search).has('created') ? `<div class="success-banner" role="status">${t('Your sale is live. Save the private management link below before leaving.', '摆卖已发布。离开前请保存下方的私人管理链接。')}</div>` : ''}<div class="poll-meta"><span class="status-badge">${t('Sale', '摆卖')}</span><span id="sale-state" class="status-badge"></span><span>${t('Expires', '到期时间')} ${date(sale.deleteAt)}</span></div><h1 class="poll-title">${escape(sale.title)}</h1><p class="byline">${t('Posted by', '发布者')} <strong>${escape(sale.signature)}</strong> · ${date(sale.createdAt)} · ${t('Unverified', '未经验证')}</p><p class="poll-description">${escape(sale.description)}</p><div class="sale-photos">${(sale.images ?? []).filter(src => /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src)).map((src,i) => `<img src="${escape(src)}" alt="${t(`Item photo ${i+1}`, `物品照片 ${i+1}`)}" loading="lazy">`).join('')}</div><section class="task-reward"><span class="eyebrow">${t('ASKING PRICE', '期望价格')}</span><h2>${escape(sale.price)}</h2><p>${exchangeNote()}</p></section>${manage ? `<section class="manage-card"><span class="eyebrow">${t('PRIVATE · KEEP THIS LINK SAFE', '私人管理 · 请妥善保管链接')}</span><h2>${t('Manage this sale', '管理这条摆卖')}</h2><p>${t('Anyone with this link can see private contact details and close the sale. Do not share it or include it in screenshots. It cannot be recovered or reissued and may remain in browser history. Use the public link for sharing.', '持有此链接的人可查看出价者的私人联系方式并关闭摆卖。请勿分享链接或将其包含在截图中。链接丢失后无法找回或重新生成，也可能留在浏览器历史记录中。分享物品时请使用公开链接。')}</p><label for="manage-link">${t('Private management link', '私人管理链接')}</label><input id="manage-link" readonly value="${escape(privateLink)}"><button id="copy-manage-link" class="button secondary small" type="button">${t('Copy private link', '复制私人链接')}</button><p>${t('Closing stops new offers and cannot be undone. It does not confirm a deal or change the 30-day expiry.', '关闭后不再接受新出价，且无法撤销。这不代表成交，也不改变 30 天的到期期限。')}</p><button id="close-sale" class="button secondary" type="button">${t('Close sale', '关闭摆卖')}</button><p id="manage-error" class="form-error" role="alert" hidden></p><h3>${t('Private offer contacts', '出价者的私人联系方式')}</h3><p class="field-hint">${t('Use these details only to discuss this item. Do not republish them. They are removed with the sale.', '这些信息仅供就此物品联系对方，请勿再次公开。联系方式会随摆卖一起移除。')}</p><div id="private-offers" aria-live="polite"></div><button id="refresh-contacts" class="button secondary small" type="button">${t('Refresh contacts', '刷新联系方式')}</button></section>` : ''}<section id="social"></section><section class="social-card" aria-labelledby="offers-title"><div class="replies-heading"><h2 id="offers-title">${t('Public offers', '公开出价')}</h2><span id="offer-count"></span></div><p class="field-hint">${t('Amounts, names and messages are public and unverified. Contact details are never displayed here.', '出价金额、姓名和留言会公开显示，且未经验证。联系方式不会在这里显示。')}</p><div id="offer-list" aria-live="polite"></div><p id="offers-closed" role="status" hidden>${t('This sale is closed and no longer accepts offers.', '这条摆卖已关闭，不再接受新出价。')}</p><form id="offer-form"><h3>${t('Make an offer', '我想出价')}</h3><label for="offer-amount">${t('Your offer (public)', '你的出价（公开）')}</label><input id="offer-amount" maxlength="160" required aria-describedby="offer-amount-hint" placeholder="${t('e.g. CAD 20', '例如：CAD 20')}"><p id="offer-amount-hint" class="field-hint">${t('Use a nonnegative amount with up to two decimal places, optionally with a currency: CAD 20 or $20.50. Keep contact details in the private fields.', '请填写非负金额，最多两位小数，可加币种，例如 CAD 20 或 $20.50。联系方式请填在下方的私密字段。')}</p><label for="offer-name">${t('Your name (public, optional)', '你的名字（公开，选填）')}</label><input id="offer-name" maxlength="60"><label for="offer-message">${t('Message (public)', '留言（公开）')}</label><textarea id="offer-message" maxlength="2000" rows="4" required></textarea><p class="field-hint">${t('Your amount, name and message are public. Never put contact details here. Automatic checks cannot detect every contact detail.', '出价、姓名和留言会公开显示，请勿在这里填写联系方式。自动检测无法识别所有形式的联系方式。')}</p><fieldset class="contact-fields"><legend>${t('Private contact for the seller', '留给卖家的私人联系方式')}</legend><p class="field-hint">${t('Provide a phone number or email address, or both. Only holders of the private management link and ScaleTag administrators can see them; private backups also contain them.', '请填写电话、邮箱或两者。只有持有私人管理链接的人和 ScaleTag 管理员可以查看，私有备份中也会保留。')}</p><label for="offer-phone">${t('Phone (private)', '电话（私密）')}</label><input id="offer-phone" type="tel" maxlength="40" autocomplete="tel"><label for="offer-email">${t('Email (private)', '邮箱（私密）')}</label><input id="offer-email" type="email" maxlength="254" autocomplete="email"></fieldset><label class="checkbox-row"><input id="offer-privacy" type="checkbox" required><span>${t('I understand my amount, name and message are public until this sale expires, 30 days after publication. My contact details are private to management-link holders, administrators and backups kept for up to 90 days.', '我了解出价、姓名和留言会公开，直到这条摆卖在发布 30 天后到期。联系方式只供私人管理链接持有人、管理员和最多保留 90 天的私有备份访问。')}</span></label><label class="checkbox-row"><input id="offer-nonbinding" type="checkbox" required><span>${exchangeNote()}</span></label><button id="send-offer" class="button" type="submit" disabled>${t('Post offer', '发布出价')}</button><p id="offer-error" class="form-error" role="alert" hidden></p></form></section></div><aside class="poll-sidebar"><section class="share-card"><h2>${t('Share this item', '分享这件物品')}</h2><div class="qr-frame"><img src="/api/sales/${id}/qr.png" width="256" height="256" alt="${t('Public sale QR code', '摆卖公开链接二维码')}"></div><a class="button" href="/api/sales/${id}/qr.png?download=1" download="ScaleTag-sale-${id}.png">${icons.download} ${t('Save QR image', '保存二维码')}</a><button id="copy-sale-link" class="button secondary">${t('Copy public link', '复制公开链接')}</button><div id="public-link-fallback" hidden><label for="public-sale-link">${t('Public sale link', '摆卖公开链接')}</label><input id="public-sale-link" readonly></div></section><section class="timeline-card"><p>${t('Expires 30 days after publication, including all photos and offers.', '发布 30 天后到期，照片和所有出价也将一起移除。')}</p><strong>${date(sale.deleteAt)}</strong></section>${notice()}</aside></section>`;
  let social, socialData, sending = false, closing = false, fetchingContacts = false;
  function renderState() {
    if (!main.querySelector('#sale-state')) return;
    const closed = sale.saleState === 'closed';
    main.querySelector('#sale-state').textContent = saleStateLabel(sale.saleState);
    main.querySelector('#sale-state').classList.toggle('closed', closed);
    main.querySelector('#offer-form').hidden = closed || socialData?.acceptsPrivateContacts === false;
    main.querySelector('#offers-closed').hidden = !closed;
    main.querySelector('#send-offer').disabled = !socialData || closed || sending || !navigator.onLine || socialData.replies?.length >= 200;
    if (manage) main.querySelector('#close-sale').disabled = closed || closing || !navigator.onLine;
  }
  function renderOffers(data) {
    if (!main.querySelector('#offer-list')) return;
    socialData = data;
    if (data.saleState) sale.saleState = data.saleState;
    const replies = data.replies ?? [];
    main.querySelector('#offer-count').textContent = t(`${replies.length} offers`, `${replies.length} 条出价`);
    main.querySelector('#offer-list').innerHTML = replies.length ? replies.map(r => `<article class="reply-card"><div class="reply-byline"><strong>${escape(r.name)}</strong><span>${date(r.createdAt)}</span></div><strong class="sale-offer-amount">${escape(r.amount)}</strong><p class="reply-message">${escape(r.message)}</p></article>`).join('') : `<p class="field-hint">${t('No offers yet. Start a conversation.', '还没有人出价，来聊一聊吧。')}</p>`;
    renderState();
  }
  function renderPrivate(replies) {
    if (!main.querySelector('#private-offers')) return;
    main.querySelector('#private-offers').innerHTML = replies.length ? replies.map(r => `<div class="private-offer"><strong>${t('Offer', '出价')}：${escape(r.amount)}</strong>${privateRepliesHtml([r])}</div>`).join('') : privateRepliesHtml([]);
  }
  async function refreshContacts() {
    if (fetchingContacts) return; fetchingContacts = true;
    try { const data = await api(`/api/sales/${id}/manage`, {key}); renderPrivate(data.replies ?? []); main.querySelector('#manage-error').hidden = true; }
    catch(e) { showError(main.querySelector('#manage-error'),e); } finally { fetchingContacts = false; }
  }
  async function copyLink(link, input, fallback) {
    try { await navigator.clipboard.writeText(link); toast(t('Link copied.', '链接已复制。')); }
    catch { if(fallback) fallback.hidden = false; input.value = link; input.focus(); input.select(); toast(t('Copy the selected link.', '请复制选中的链接。')); }
  }
  main.querySelector('#copy-sale-link').onclick = () => copyLink(publicLink, main.querySelector('#public-sale-link'), main.querySelector('#public-link-fallback'));
  if(manage) {
    renderPrivate(sale.replies ?? []);
    main.querySelector('#copy-manage-link').onclick = () => copyLink(privateLink, main.querySelector('#manage-link'));
    main.querySelector('#refresh-contacts').onclick = refreshContacts;
    main.querySelector('#close-sale').onclick = async () => {
      if(closing || sale.saleState === 'closed' || !confirm(t('Close this sale? New offers will stop and this cannot be undone. This does not confirm a deal.', '确定关闭这条摆卖？关闭后不再接收新出价，且无法撤销。这不代表成交。'))) return;
      closing = true; renderState(); main.querySelector('#manage-error').hidden = true;
      try { sale = await api(`/api/sales/${id}/state`, {key,state:'closed'}); social?.refresh(); }
      catch(e) { showError(main.querySelector('#manage-error'),e); } finally { closing = false; renderState(); }
    };
  }
  main.querySelector('#offer-form').onsubmit = async event => {
    event.preventDefault(); if(sending || !socialData) return;
    const error = main.querySelector('#offer-error'), value = id => main.querySelector(id).value.trim(); error.hidden = true;
    if(!value('#offer-phone') && !value('#offer-email')) { showError(error,new Error(t('Provide a private phone number or email address.', '请提供私人电话或邮箱。'))); return; }
    sending = true; renderState();
    try {
      const data = await api(`/api/posts/${id}/offers`, {amount:value('#offer-amount'),name:value('#offer-name'),message:value('#offer-message'),phone:value('#offer-phone'),email:value('#offer-email'),privacyAccepted:main.querySelector('#offer-privacy').checked,nonBindingAccepted:main.querySelector('#offer-nonbinding').checked});
      event.target.reset(); renderOffers(data); social?.refresh(); if(manage) refreshContacts(); toast(t('Your offer is public. Your contact details stay on the private management page.', '出价已公开发布，联系方式仅在私人管理页面显示。'));
    } catch(e) { showError(error,e); if(e.status === 409) social?.refresh(); } finally { sending = false; renderState(); }
  };
  renderState();
  window.addEventListener('offline',renderState); window.addEventListener('online',renderState);
  social = mountSocial(id,false,() => { main.innerHTML = `<section class="empty-page"><h1>${t('This page is unavailable.', '此页面不可用。')}</h1><p>${t('This sale, its photos, offers and contact details have left the website.', '这条摆卖及其照片、出价和联系方式已从网站移除。')}</p><a class="button" href="/PostList">${t('Back to PostList', '返回帖子列表')}</a></section>`; },data => {renderOffers(data);});
}

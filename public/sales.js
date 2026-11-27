import { renderIntroFlow } from "/help.js";
import { localizedPath } from '/locale.js';
import { main, api, escape, icons, date, locate, toast, t, bindPostVisibility, postVisibilityFields, managementPasswordForm, managementDetails, bindManagementCopy, mountNativeShare, setActiveNav, showFormError, bindCharCounter } from '/common.js';
import { mountSocial } from '/social.js';
import { mountPosterActions } from '/poster.js';
import { mountOwnerEdit, refreshOwnerPreview } from '/owner-edit.js';
import { bindTextDraft, mountSavedPost } from '/local-posts.js';
import { pickupWindowFields, pickupWindowText, readLocalDateTime, readPickupWindow, toLocalDateTime } from '/pickup.js';

export function saleStateLabel(state) {
  if (state === 'claimed') return t('Claimed', '已领取');
  if (state === 'reserved') return t('Reserved', '已保留');
  return state === 'closed' ? t('Unavailable', '已下架') : t('Available', '可领取');
}

export function createSale() {
  document.title = t('Give something away — ScaleTag', '发布闲置赠予 — ScaleTag');
  setActiveNav('create');
  main.innerHTML = `<section class="create-section"><aside class="section-intro"><a class="back-link" href="/">${t('← Back to home','← 返回首页')}</a><span class="eyebrow">${t('PASS SOMETHING ON','让闲置遇到需要的人')}</span><h1>${t('Give it a<br> <em>new home.</em>', '让闲置物品<br><em>找到新主人。</em>')}</h1><p>${t('Share something free for someone nearby to pick up.', '把闲置物品免费分享给附近有需要的人。')}</p>${renderIntroFlow("giveaways")}<div class="rules"><p>${icons.clock} ${t('Available for 72 hours.','发布后保留 72 小时。')}</p><p>${icons.shield} ${t('Save your management URL and password to take it down.','保存管理网址和密码，物品被拿走后即可下架。')}</p></div></aside><form id="sale-form" class="form-card"><div class="post-kind-switch" aria-label="${t('Post type','发布类型')}"><a href="/create">${t('Poll','投票')}</a><a href="/create/task">${t('Task','任务')}</a><a href="/create/sale" aria-current="page">${t('Free Giveaways','闲置赠予')}</a><a href="/secrex">${t('Secrex','Secrex 阅后即焚')}</a></div><div class="form-heading"><h2>${t('Give something away','发布闲置赠予')}</h2></div><label for="sale-title">${t('Item title','物品名称')}</label><input id="sale-title" maxlength="140" aria-describedby="sale-title-count" required><div class="field-hint"><span>${t("Character count", "字数")}</span><span id="sale-title-count"></span></div><p id="sale-title-limit-status" class="field-hint reply-length-status" role="status"></p><label for="sale-description">${t('Description and condition','物品介绍与成色')}</label><textarea id="sale-description" maxlength="4000" rows="5" aria-describedby="sale-description-count" required></textarea><div class="field-hint"><span>${t("Character count", "字数")}</span><span id="sale-description-count"></span></div><p id="sale-description-limit-status" class="field-hint reply-length-status" role="status"></p><label for="pickup-location">${t('Pickup location (public)','领取地点（公开）')}</label><input id="pickup-location" maxlength="300" aria-describedby="pickup-location-hint pickup-location-count" required placeholder="${t('e.g. Outside the north library entrance','例如：图书馆北门外')}"><div class="field-hint"><span id="pickup-location-hint">${t('Give enough detail to find the item. Anyone who can open the post can see this location. Leave out contact details.','请写清楚物品在哪里。能打开帖子的人都能看到领取地点。请勿填写联系方式。')}</span><span id="pickup-location-count"></span></div><p id="pickup-location-limit-status" class="field-hint reply-length-status" role="status"></p>${pickupWindowFields('sale')}<label for="sale-images">${t('Photos (optional)','物品照片（选填）')}</label><input id="sale-images" type="file" accept="image/jpeg,image/png,image/webp" multiple><p class="field-hint">${t('Up to 2 JPEG, PNG or WebP photos, each original at most 1 MiB. Photos are public.','最多上传 2 张 JPEG、PNG 或 WebP 照片，每张原图不超过 1 MiB。照片会公开显示。')}</p><label for="sale-name">${t('Your name (optional, unverified)','你的名字（选填，未经验证）')}</label><input id="sale-name" maxlength="60">${postVisibilityFields()}<fieldset class="post-location-fields"><legend class="sr-only">${t("Post location", "帖子位置")}</legend><div class="location-box"><div><strong>${icons.pin} ${t('Show the approximate area on the map','在地图上显示大致区域')}</strong><p id="sale-location-status" aria-live="polite">${t('Location permission is required.','发布时需要获取位置。')}</p></div><button id="sale-locate" class="button secondary small" type="button">${t('Enable location','获取位置')}</button></div><label class="checkbox-row"><input id="sale-map-consent" type="checkbox" required><span>${t('I agree to show the approximate area publicly on the map.','我同意在地图上公开显示大致区域。')}</span></label></fieldset><label class="checkbox-row"><input id="sale-retention" type="checkbox" required><span>${t('I understand this post and photos are hidden after 72 hours and removed from active storage after 30 days. Daily backups are kept for up to 90 days after creation.','我了解帖子和照片在 72 小时后不再公开，发布 30 天后从当前存储中移除；每日备份从创建之日起最多保留 90 天。')}</span></label><p class="field-hint" role="note">${t("Disclaimer: Posts are supplied by users and are not verified by ScaleTag. Publishers are responsible for their content; users should exercise their own judgment. ScaleTag does not participate in transactions.", "免责声明：信息由用户发布，ScaleTag 不对内容进行核实。发布者对其内容负责，使用者应自行判断；ScaleTag 不参与交易。")}</p><button id="publish-sale" class="button publish-button" type="submit">${t('Publish giveaway','发布闲置赠予')} ${icons.arrow}</button><p id="sale-progress" role="status"></p><p id="sale-error" class="form-error" role="alert" hidden></p></form></section>`;
  let position, locatedAt = 0, publishing = false;
  const form = main.querySelector('#sale-form');
  const draft = bindTextDraft(form, 'sale', [
    '#sale-title', '#sale-description', '#pickup-location', '#sale-name', '#post-visibility',
  ]);
  bindCharCounter(main.querySelector('#sale-title'), main.querySelector('#sale-title-count'), main.querySelector('#sale-title-limit-status'));
  bindCharCounter(main.querySelector('#sale-description'), main.querySelector('#sale-description-count'), main.querySelector('#sale-description-limit-status'));
  bindCharCounter(main.querySelector('#pickup-location'), main.querySelector('#pickup-location-count'), main.querySelector('#pickup-location-limit-status'));
  const visibility = bindPostVisibility(form);
  const locationButton = main.querySelector('#sale-locate');
  async function getLocation() { position = await locate(); locatedAt = Date.now(); main.querySelector('#sale-location-status').textContent = t('Location ready.','位置已获取。'); locationButton.textContent = t("Refresh location", "刷新位置"); }
  locationButton.onclick = async () => { locationButton.disabled = true; locationButton.textContent = t("Locating…", "正在定位…"); try { await getLocation(); } catch (e) { position = undefined; main.querySelector('#sale-location-status').textContent = e.message; locationButton.textContent = t("Try again", "重试"); } finally { locationButton.disabled = false; } };
  form.onsubmit = async event => {
    event.preventDefault(); if (publishing) return;
    const error=main.querySelector('#sale-error'), button=main.querySelector('#publish-sale'), progress=main.querySelector('#sale-progress'); error.hidden=true; button.disabled=true; publishing=true;
    try {
      const files=[...main.querySelector('#sale-images').files];
      if(files.length>2 || files.some(f=>f.size>1048576 || !['image/jpeg','image/png','image/webp'].includes(f.type))) throw new Error(t('Choose at most 2 JPEG, PNG or WebP photos, each at most 1 MiB.','最多选择 2 张 JPEG、PNG 或 WebP 照片，每张不超过 1 MiB。'));
      const images=await Promise.all(files.map(file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error(t('Could not read a photo.','无法读取照片。')));reader.readAsDataURL(file);})));
      if (!visibility.unlisted && (!position || Date.now() - locatedAt > 300000)) await getLocation();
      progress.textContent=t('Publishing…','正在发布…');
      const value=id=>main.querySelector(id).value.trim();
      const pickupWindow = readPickupWindow(form.querySelector('#sale-pickup-start'), form.querySelector('#sale-pickup-end'));
      const payload = {title:value('#sale-title'),description:value('#sale-description'),pickupLocation:value('#pickup-location'),pickupWindow,signature:value('#sale-name'),images,...visibility.payload(position),retentionAccepted:main.querySelector('#sale-retention').checked};
      const submittedDraft = await draft.snapshot();
      const sale=await api('/api/sales', payload);
      await draft.published(submittedDraft);
      history.replaceState(null, "", localizedPath(`/sale/${sale.id}/manage?created=1`));
      await salePage(sale.id, { manage: true, password: sale.manageKey, published: sale });
    } catch(e) { showFormError(error,e); progress.textContent=''; button.disabled=false; } finally { publishing=false; }
  };
}

export async function salePage(id, { manage = false, password, published } = {}) {
  setActiveNav(null);
  const fragmentKey = new URLSearchParams(location.hash.slice(1)).get("key");
  const legacyKey = manage && !password && /^[a-f0-9]{64}$/.test(fragmentKey ?? "") ? fragmentKey : undefined;
  const key = password ?? legacyKey;
  if (manage && !key) {
    await api(`/api/sales/${id}`);
    return managementPasswordForm((password) => salePage(id, { manage: true, password }));
  }
  const sale = published ?? await api(`/api/sales/${id}${manage ? "/manage" : ""}`, manage ? { key } : undefined);
  let claimed = sale.saleState === 'claimed';
  const publicLink = `${location.origin}/sale/${id}`;
  const manageUrl = new URL(localizedPath(`/sale/${id}/manage`), location.origin).href;
  const privateLink = `${publicLink}/manage#key=${legacyKey}`;
  document.title=`${sale.title} — ScaleTag`;
  const holdControls = manage && !claimed ? `<form id="sale-hold-form">
    <label for="sale-hold-until">${t('Hold until', '保留至')}</label>
    <input id="sale-hold-until" type="datetime-local" value="${toLocalDateTime(sale.reservedUntil)}" max="${toLocalDateTime(sale.endsAt)}" required>
    <p class="field-hint">${t('The hold ends automatically at the chosen time.', '保留会在指定时间自动结束。')}</p>
    <button type="submit" class="button secondary small">${t('Hold item', '保留物品')}</button>
    <button id="release-sale" type="button" class="button secondary small" hidden>${t('Release hold', '取消保留')}</button>
  </form>` : '';
  const pickupCalendar = manage ? '' : `<div id="pickup-calendar" hidden>
    <a class="button secondary small" href="/api/sales/${id}/pickup.ics" download>${t('Add pickup time to calendar', '将领取时段加入日历')}</a>
    <p class="field-hint">${t('Check the post for current availability before heading out.', '出发前请打开帖子确认物品是否仍可领取。')}</p>
  </div>`;
  main.innerHTML=`<section class="poll-layout"><div class="poll-main"><a class="back-link" href="/PostList">${t('← Back to PostList','← 返回帖子列表')}</a>${manage&&new URLSearchParams(location.search).has('created')?`<div class="success-banner" role="status">${t('Your giveaway is live. Save the management details before leaving.','闲置赠予已发布。离开前请保存管理信息。')}</div>`:''}<div class="poll-meta"><span class="status-badge">${t('Free Giveaway','闲置赠予')}</span><span id="sale-availability" class="status-badge" ${claimed ? 'hidden' : ''}></span><span id="sale-claimed" class="status-badge closed" ${claimed ? '' : 'hidden'}>${saleStateLabel('claimed')}</span><span><span id="sale-expiry-label">${claimed ? t('Link expires', '链接有效期至') : t('Available until','有效期至')}</span> ${date(sale.endsAt)}</span></div><h1 class="poll-title">${escape(sale.title)}</h1><p class="byline">${t('Posted by','发布者')} <strong>${escape(sale.signature)}</strong> · ${date(sale.createdAt)}</p><p class="poll-description">${escape(sale.description)}</p><div class="sale-photos">${(sale.images??[]).filter(src=>/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src)).map((src,i)=>`<img src="${escape(src)}" alt="${t(`Item photo ${i+1}`,`物品照片 ${i+1}`)}" loading="lazy">`).join('')}</div><section id="sale-pickup" class="task-reward" ${claimed ? 'hidden' : ''}>${claimed ? '' : `<span class="eyebrow">${t('PICKUP LOCATION','领取地点')}</span><h2>${escape(sale.pickupLocation)}</h2><p>${t('Free to pick up. The item may have already been taken.','免费领取，物品也可能已被拿走。')}</p><p id="sale-pickup-window" hidden></p><p id="sale-reserved-until" class="field-hint" hidden></p>${pickupCalendar}`}</section><p id="sale-claimed-message" class="success-banner" role="status" ${claimed ? '' : 'hidden'}>${t('This item has been picked up.', '这件物品已被领取。')}</p>${manage?`<section class="manage-card"><h2>${t('Manage giveaway','管理闲置赠予')}</h2>${legacyKey ? `<p>${t('Save this private link. Anyone with it can take the post down. It cannot be recovered.','请保存此私人链接。持有链接的人可以下架帖子，链接丢失后无法找回。')}</p><label for="manage-link">${t('Private management link','私人管理链接')}</label><input id="manage-link" readonly value="${escape(privateLink)}"><button id="copy-manage-link" class="button secondary small">${t('Copy private link','复制私人链接')}</button>` : managementDetails(manageUrl)}${claimed ? '' : `<div id="sale-management-actions">${holdControls}<button id="claim-sale" type="button" class="button">${t('Mark as claimed', '标记为已领取')}</button> <button id="close-sale" type="button" class="button secondary">${t('Take down','下架帖子')}</button></div>`}<p id="manage-error" class="form-error" role="alert" hidden></p></section>`:''}<section id="social"></section></div><aside class="poll-sidebar"><section class="share-card"><h2>${t('Share this item','分享这件物品')}</h2><div class="qr-frame"><img src="/api/sales/${id}/qr.png" width="256" height="256" alt="${t('Public giveaway QR code','闲置赠予公开链接二维码')}"></div><button id="copy-sale-link" class="button secondary">${t('Copy public link','复制公开链接')}</button><div id="public-link-fallback" hidden><label for="public-sale-link">${t('Public link','公开链接')}</label><input id="public-sale-link" readonly></div></section><section class="timeline-card"><p>${t('Available for 72 hours after publication.','发布后 72 小时内可查看。')}</p><strong>${date(sale.endsAt)}</strong></section></aside></section>`;
  async function copyLink(link,input,fallback) {try {await navigator.clipboard.writeText(link);toast(t('Link copied.','链接已复制。'));} catch {if(fallback) fallback.hidden=false;input.value=link;input.focus();input.select();toast(t('Copy the selected link.','请复制选中的链接。'));}}
  main.querySelector('#copy-sale-link').onclick=()=>copyLink(publicLink,main.querySelector('#public-sale-link'),main.querySelector('#public-link-fallback'));
  if (!manage) {
    mountNativeShare(main.querySelector('#copy-sale-link'), {
      title: sale.title,
      url: `${location.origin}/sale/${id}`,
    });
  }
  const shareCard = main.querySelector('.share-card');
  mountSavedPost(shareCard, { path: `/sale/${id}${manage && !legacyKey ? '/manage' : ''}`, title: () => sale.title });
  const renderPoster = () => mountPosterActions(shareCard, {
    type: 'sale',
    id,
    title: sale.title,
    description: sale.description,
    signature: sale.signature,
    createdAt: sale.createdAt,
    endsAt: sale.endsAt,
    deleteAt: sale.deleteAt,
    pickupLocation: sale.pickupLocation,
    images: sale.images,
    qrUrl: `/api/sales/${id}/qr.png`,
    publicUrl: publicLink,
  });
  if (!claimed) renderPoster();
  const reservedUntil = main.querySelector('#sale-reserved-until');
  let pickupCopy;
  if (!manage && reservedUntil) {
    reservedUntil.insertAdjacentHTML('afterend', `<div id="pickup-copy" hidden>
      <button type="button" class="button secondary small">${t('Copy pickup location', '复制领取地点')}</button>
      <label class="pickup-copy-fallback" hidden>${t('Pickup location (public)', '领取地点（公开）')}
        <textarea rows="3" readonly></textarea>
      </label>
    </div>`);
    pickupCopy = main.querySelector('#pickup-copy');
    const copy = pickupCopy.querySelector('button');
    const fallback = pickupCopy.querySelector('label');
    const text = fallback.querySelector('textarea');
    const heading = main.querySelector('#sale-pickup h2');
    copy.onclick = async () => {
      const address = heading.textContent;
      try {
        await navigator.clipboard.writeText(address);
      } catch {
        if (!pickupCopy.isConnected || pickupCopy.hidden) return;
        fallback.hidden = false;
        text.value = address;
        text.focus();
        text.select();
        toast(t('Copy the selected location.', '请复制选中的地点。'));
        return;
      }
      if (!pickupCopy.isConnected || pickupCopy.hidden) return;
      fallback.hidden = true;
      text.value = '';
      toast(t('Pickup location copied.', '已复制领取地点。'));
    };
  }
  const calendar = main.querySelector('#pickup-calendar');
  let calendarTimer, calendarDeadline = 0;
  let holdTimer;
  let availabilityTime = 0;
  function refreshCalendarLink() {
    if (!calendar?.isConnected) return;
    clearTimeout(calendarTimer);
    const remaining = calendarDeadline - Date.now();
    calendar.hidden = remaining <= 0;
    if (remaining > 0) calendarTimer = setTimeout(refreshCalendarLink, remaining);
  }
  function renderAvailability(state) {
    const badge = main.querySelector('#sale-availability');
    if (!badge || claimed || state.serverTime < availabilityTime) return;
    availabilityTime = state.serverTime;
    clearTimeout(holdTimer);
    if (state.saleState === 'claimed') {
      showClaimed();
      return;
    }
    const reserved = state.saleState === 'reserved';
    badge.textContent = saleStateLabel(state.saleState);
    badge.classList.toggle('in-progress', reserved);
    const windowLabel = main.querySelector('#sale-pickup-window');
    windowLabel.hidden = !state.pickupWindow;
    windowLabel.textContent = state.pickupWindow ? pickupWindowText(state.pickupWindow) : '';
    calendarDeadline = state.saleState === 'open' && state.pickupWindow
      ? Date.now() + state.pickupWindow.endsAt - state.serverTime : 0;
    refreshCalendarLink();
    reservedUntil.hidden = !reserved;
    reservedUntil.textContent = reserved ? `${t('Reserved until', '保留至')} ${date(state.reservedUntil)}` : '';
    if (pickupCopy) {
      pickupCopy.hidden = state.saleState !== 'open';
      if (pickupCopy.hidden) {
        pickupCopy.querySelector('label').hidden = true;
        pickupCopy.querySelector('textarea').value = '';
      }
    }
    const release = main.querySelector('#release-sale');
    if (release) release.hidden = !reserved;
    if (reserved) holdTimer = setTimeout(() => renderAvailability({
      ...state, saleState: 'open', serverTime: state.reservedUntil,
    }), Math.max(0, state.reservedUntil - state.serverTime));
  }
  renderAvailability(sale);
  window.addEventListener('pagehide', () => {
    clearTimeout(holdTimer);
    clearTimeout(calendarTimer);
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) refreshCalendarLink();
  });
  function showClaimed() {
    if (claimed) return;
    claimed = true;
    main.querySelector('#sale-availability').hidden = true;
    main.querySelector('#sale-claimed').hidden = false;
    main.querySelector('#sale-claimed-message').hidden = false;
    main.querySelector('#sale-expiry-label').textContent = t('Link expires', '链接有效期至');
    const pickup = main.querySelector('#sale-pickup');
    pickup.replaceChildren();
    pickup.hidden = true;
    main.querySelector('#sale-management-actions')?.remove();
    main.querySelector('.owner-edit')?.remove();
    shareCard.querySelector('.poster-actions')?.remove();
    document.querySelector('#poster-print-root')?.remove();
  }
  if (manage) {
    if (!legacyKey) bindManagementCopy(manageUrl, key);
    else main.querySelector('#copy-manage-link').onclick=()=>copyLink(privateLink,main.querySelector('#manage-link'));
    if (!claimed) {
      mountOwnerEdit(main.querySelector('.manage-card'), sale, `/api/sales/${id}/edit`, key, (updated) => {
        if (claimed || !main.querySelector('#sale-pickup')) return;
        Object.assign(sale, updated);
        renderAvailability(updated);
        refreshOwnerPreview(main, sale);
        shareCard.querySelector('.poster-actions')?.remove();
        document.querySelector('#poster-print-root')?.remove();
        renderPoster();
      });
      const buttons = main.querySelectorAll('#sale-management-actions button');
      const error = main.querySelector('#manage-error');
      async function updateState(state, reservedUntil) {
        const isClaim = state === 'claimed';
        if (isClaim && !confirm(t('Mark this giveaway as claimed? Its pickup location will be hidden.', '标记为已领取？领取地点将不再公开。'))) return;
        if (state === 'closed' && !confirm(t('Take this giveaway down?', '确定下架这条闲置赠予吗？'))) return;
        error.hidden = true;
        buttons.forEach(button => { button.disabled = true; });
        try {
          const updated = await api(`/api/sales/${id}/state`, { key, state, reservedUntil });
          if (state === 'closed')
            main.innerHTML = `<section class="empty-page"><h1>${t('This giveaway is no longer available.','这条闲置赠予已下架。')}</h1><a class="button" href="/PostList">${t('Back to PostList','返回帖子列表')}</a></section>`;
          else renderAvailability(updated);
        } catch (e) {
          showFormError(error, e);
        } finally {
          buttons.forEach(button => { button.disabled = false; });
        }
      }
      main.querySelector('#sale-hold-form').onsubmit = (event) => {
        event.preventDefault();
        const time = readLocalDateTime(main.querySelector('#sale-hold-until'));
        if (!Number.isSafeInteger(time)) {
          showFormError(error, new Error(t('Choose a future hold time within the giveaway lifetime.', '请选择赠予有效期内的未来保留时间。')));
          return;
        }
        updateState('reserved', time);
      };
      main.querySelector('#release-sale').onclick = () => updateState('open');
      main.querySelector('#claim-sale').onclick = () => updateState('claimed');
      main.querySelector('#close-sale').onclick = () => updateState('closed');
    }
  }
  mountSocial(id, false, () => {
    main.innerHTML = `<section class="empty-page"><h1>${t('This giveaway is no longer available.','这条闲置赠予已下架或到期。')}</h1><a class="button" href="/PostList">${t('Back to PostList','返回帖子列表')}</a></section>`;
  }, renderAvailability);
}

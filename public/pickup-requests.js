import { api, date, escape, showFormError, t } from "/common.js";
import { readLocalDateTime, toLocalDateTime } from "/pickup.js";

export function mountPickupRequest(host, sale) {
  host.innerHTML = `
    <p>${t("Request pickup first. Return in this browser to see if you were selected.", "请先申请领取，再用同一浏览器回来查看是否获选。")}</p>
    <form id="pickup-request-form" hidden>
      <label for="pickup-request-time">${t("When can you pick it up?", "你什么时候可以领取？")}</label>
      <input type="datetime-local" id="pickup-request-time" required>
      <p class="field-hint">${t("Times use your device’s time zone.", "时间以设备所在时区为准。")}</p>
      <button class="button secondary small" type="submit">${t("Request pickup", "申请领取")}</button>
    </form>
    <p id="pickup-request-status" role="status"></p>
    <p id="requested-pickup-time" class="field-hint" hidden></p>
    <div id="pickup-request-details" hidden></div>
    <div class="local-post-controls">
      <button class="button secondary small" type="button" id="check-pickup-request">${t("Check pickup request", "查看领取申请")}</button>
      <button class="button secondary small" type="button" id="cancel-pickup-request" hidden>${t("Cancel pickup request", "取消领取申请")}</button>
    </div>
    <p class="form-error" role="alert" hidden></p>`;
  const form = host.querySelector("form");
  const time = form.querySelector("input");
  const submit = form.querySelector("button");
  const details = host.querySelector("#pickup-request-details");
  const status = host.querySelector("#pickup-request-status");
  const requestedTime = host.querySelector("#requested-pickup-time");
  const check = host.querySelector("#check-pickup-request");
  const cancel = host.querySelector("#cancel-pickup-request");
  const error = host.querySelector('[role="alert"]');
  let busy = false, queued = false, revision = 0, expiryTimer;
  let observedHold = sale.reservedUntil;

  function clearLocation() {
    clearTimeout(expiryTimer);
    details.textContent = "";
    details.hidden = true;
  }

  function render(result) {
    clearLocation();
    if ((!["pending", "accepted"].includes(result.state) && document.activeElement === cancel) ||
        (result.state !== "none" && form.contains(document.activeElement))) check.focus();
    form.hidden = result.state !== "none";
    cancel.hidden = !["pending", "accepted"].includes(result.state);
    status.textContent = result.state === "accepted"
      ? t("Your pickup request was confirmed.", "你的领取申请已确认。")
      : result.state === "pending"
        ? t("Your pickup request is pending.", "你的领取申请正在等待确认。")
        : result.state === "unavailable" ? t("This giveaway is no longer available.", "这条闲置赠予已下架或到期。") : "";
    requestedTime.hidden = !result.pickupAt;
    requestedTime.textContent = result.pickupAt ? `${t("Requested pickup time", "申请领取时间")} · ${date(result.pickupAt)}` : "";
    if (result.state === "accepted") {
      details.textContent = result.pickupLocation;
      details.hidden = false;
      expiryTimer = setTimeout(() => { clearLocation(); void run("status"); }, Math.max(0, result.reservedUntil - result.serverTime));
    }
    if (result.pickupAt) time.value = toLocalDateTime(result.pickupAt);
  }

  async function run(action, pickupAt) {
    if (busy) {
      if (action === "status") queued = true;
      return;
    }
    if (!host.isConnected || document.hidden) return;
    busy = true;
    const requestRevision = revision;
    if (action === "status") clearLocation();
    error.hidden = true;
    for (const button of [submit, check, cancel]) button.setAttribute("aria-disabled", "true");
    try {
      const result = await api(`/api/sales/${sale.id}/pickup-request`, { action, pickupAt });
      if (requestRevision === revision && host.isConnected) render(result);
    } catch (e) {
      if (requestRevision === revision && host.isConnected) showFormError(error, e, { focus: false });
    } finally {
      busy = false;
      for (const button of [submit, check, cancel]) button.removeAttribute("aria-disabled");
      if (queued) {
        queued = false;
        void run("status");
      }
    }
  }

  form.onsubmit = event => {
    event.preventDefault();
    if (busy) return;
    const pickupAt = readLocalDateTime(time);
    if (!Number.isSafeInteger(pickupAt)) {
      showFormError(error, t("Choose a future time within the pickup hours and giveaway lifetime.", "请选择领取时段和赠予有效期内的未来时间。"), { focus: false });
      return;
    }
    void run("request", pickupAt);
  };
  check.onclick = () => { if (!busy) void run("status"); };
  cancel.onclick = () => {
    if (!busy && confirm(t("Cancel this pickup request?", "取消这条领取申请？"))) {
      clearLocation();
      void run("cancel");
    }
  };
  time.max = toLocalDateTime(sale.pickupWindow?.endsAt ?? sale.endsAt);
  if (sale.pickupWindow) time.min = toLocalDateTime(sale.pickupWindow.startsAt);
  window.addEventListener("pagehide", () => { revision++; clearLocation(); });
  window.addEventListener("pageshow", event => { if (event.persisted) void run("status"); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void run("status"); });
  void run("status");

  return state => {
    if (observedHold === state.reservedUntil) return;
    observedHold = state.reservedUntil;
    revision++;
    clearLocation();
    void run("status");
  };
}

export function mountPickupManagement(host, sale, key, onChange) {
  host.innerHTML = `
    <h3>${t("Pickup requests", "领取申请")}</h3>
    <button type="button" class="button secondary small" id="refresh-pickup-requests">${t("Refresh pickup requests", "刷新领取申请")}</button>
    <p role="status" class="field-hint"></p>
    <ul></ul><p class="form-error" role="alert" hidden></p>`;
  const refresh = host.querySelector("button");
  const list = host.querySelector("ul");
  const status = host.querySelector('[role="status"]');
  const error = host.querySelector('[role="alert"]');
  let busy = false;

  function render(current) {
    if (current.saleState === "claimed") {
      host.remove();
      return;
    }
    if (list.contains(document.activeElement)) refresh.focus();
    status.textContent = current.selectedPickupRequestId
      ? t("A pickup request is confirmed.", "已确认一条领取申请。")
      : current.pickupRequests.length ? "" : t("No pickup requests yet.", "暂时没有领取申请。");
    list.innerHTML = current.pickupRequests.map(request => `
      <li><span>${escape(date(request.pickupAt))}</span>
      ${current.selectedPickupRequestId === request.id ? ` <strong>${t("Confirmed", "已确认")}</strong>` : ""}
      ${current.selectedPickupRequestId ? "" : ` <button type="button" class="button secondary small" data-request-id="${escape(request.id)}">${t("Confirm pickup request", "确认领取申请")}</button>`}</li>`).join("");
  }

  async function update(path, data) {
    if (busy) return;
    busy = true;
    error.hidden = true;
    const buttons = [...host.querySelectorAll("button")];
    buttons.forEach(button => button.setAttribute("aria-disabled", "true"));
    try {
      const current = await api(`/api/sales/${sale.id}/${path}`, { key, ...data });
      if (host.isConnected) onChange(current);
    } catch (e) {
      if (host.isConnected) showFormError(error, e, { focus: false });
    } finally {
      busy = false;
      buttons.forEach(button => button.removeAttribute("aria-disabled"));
    }
  }

  refresh.onclick = () => void update("manage");
  list.onclick = event => {
    const button = event.target.closest("[data-request-id]");
    if (!busy && button) void update("state", { state: "reserved", requestId: button.dataset.requestId });
  };
  render(sale);
  return render;
}

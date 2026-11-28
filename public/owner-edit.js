import {
  api, bindPhotoInput, escape, mountPollOptionOrder, photoFields, syncPollOptionOrder, t, uploadedPhotosHtml,
} from "/common.js";
import { mountDraftCopy } from "/local-posts.js";
import { pickupWindowFields, readLocalDateTime, readPickupWindow, toLocalDateTime } from "/pickup.js";

export function mountOwnerEdit(host, post, endpoint, key, onSaved) {
  const controls = document.createElement("div");
  controls.className = "owner-edit";
  const details = document.createElement("details");
  const canEditOptions = post.type === "poll" && post.canEditOptions;
  details.innerHTML = `<summary>${t("Edit public details", "修改公开内容")}</summary>
    <form class="form-card" id="owner-edit-form">
      <label for="owner-title">${t("Title", "标题")}</label>
      <input id="owner-title" name="title" value="${escape(post.title)}" maxlength="140" ${post.type === "poll" && !canEditOptions ? "readonly" : "required"}>
      <label for="owner-description">${t("Description", "说明")}</label>
      <textarea id="owner-description" name="description" rows="4" maxlength="4000" ${post.type === "poll" ? "" : "required"}>${escape(post.description)}</textarea>
      ${post.type === "task" && !post.taskKind ? `<label for="owner-reward">${t("Reward", "酬谢")}</label>
        <input id="owner-reward" name="reward" value="${escape(post.reward)}" maxlength="160" required>` : ""}
      ${post.type === "task" && !post.taskKind && !["completed", "closed"].includes(post.taskState) ? `
        <label for="owner-task-deadline">${t("Help needed by (optional)", "需要帮忙的截止时间（选填）")}</label>
        <input id="owner-task-deadline" type="datetime-local" value="${toLocalDateTime(post.taskDueAt)}" max="${toLocalDateTime(post.deleteAt)}">
        <p class="field-hint">${t("New replies stop at this time. Times use your device’s time zone.", "到时停止接收新回复。时间以设备所在时区为准。")}</p>` : ""}
      ${post.type === "sale" ? `<label for="owner-pickup">${post.pickupByRequest ? t("Pickup location (private)", "领取地点（私密）") : t("Pickup location (public)", "领取地点（公开）")}</label>
        <input id="owner-pickup" name="${post.pickupByRequest ? "privatePickupLocation" : "pickupLocation"}" value="${escape(post.pickupLocation)}" maxlength="300" required>
        ${pickupWindowFields("owner", post.pickupWindow)}` : ""}
      ${post.type === "poll" ? canEditOptions ? `<fieldset class="options-fieldset">
        <legend>${t("The options", "选项")}</legend>
        <div id="owner-options"></div>
        <button class="add-option" type="button" id="owner-add-option">${t("Add an option", "添加选项")}</button>
      </fieldset>` : `<p class="field-hint">${t("The poll question and options can change only before the first vote and before voting closes.", "投票问题和选项只能在第一票产生前且投票尚未截止时修改。")}</p>` : ""}
      ${["found", "lost"].includes(post.taskKind) ? "" : photoFields("owner", t("Replace photos (optional)", "替换照片（选填）"))}
      <div id="owner-photo-removal" ${post.images?.length ? "" : "hidden"}>
        <label class="checkbox-row"><input type="checkbox" id="owner-remove-photos">
          <span>${t("Remove current photos", "移除现有照片")}</span></label>
      </div>
      <button class="button secondary" type="submit">${t("Save changes", "保存修改")}</button>
      <p class="form-error" role="alert" hidden></p>
      <p class="field-hint" role="status"></p>
    </form>`;
  controls.append(details);
  host.append(controls);
  const form = details.querySelector("form");
  const photos = ["found", "lost"].includes(post.taskKind) ? null : bindPhotoInput(form, "owner");
  const submit = form.querySelector("[type=submit]");
  const error = form.querySelector("[role=alert]");
  const status = form.querySelector("[role=status]");
  const replacement = form.querySelector("#owner-images");
  const removePhotos = form.querySelector("#owner-remove-photos");
  const photoRemoval = form.querySelector("#owner-photo-removal");
  const optionList = form.querySelector("#owner-options");
  const addOption = form.querySelector("#owner-add-option");
  const pickupStart = form.querySelector("#owner-pickup-start");
  const pickupEnd = form.querySelector("#owner-pickup-end");
  const taskDeadline = form.querySelector("#owner-task-deadline");
  let current = post;
  mountDraftCopy(controls, () => current);
  let optionLabels = post.options?.map(({ label }) => label);
  if (canEditOptions) {
    function renumber() {
      const rows = [...optionList.children];
      rows.forEach((row, index) => {
        const label = row.querySelector("label");
        const input = row.querySelector("input");
        input.id = label.htmlFor = `owner-option-${index + 1}`;
        label.textContent = t(`Option ${index + 1}`, `选项 ${index + 1}`);
        syncPollOptionOrder(row, index, rows.length);
        const remove = row.querySelector(".text-link");
        remove.disabled = rows.length <= 2;
        remove.setAttribute("aria-label", t(`Remove option ${index + 1}`, `删除选项 ${index + 1}`));
      });
      addOption.disabled = rows.length >= 12;
    }
    function appendOption(value = "") {
      const row = document.createElement("div");
      row.innerHTML = `<label></label><input maxlength="120" required>
        <button class="text-link" type="button">${t("Remove option", "删除选项")}</button>`;
      const input = row.querySelector("input");
      input.value = value;
      row.querySelector(".text-link").onclick = () => {
        if (optionList.children.length <= 2) return;
        const nextFocus = row.nextElementSibling?.querySelector("input")
          ?? row.previousElementSibling?.querySelector("input")
          ?? addOption;
        row.remove();
        renumber();
        nextFocus?.focus();
      };
      mountPollOptionOrder(row, renumber);
      optionList.append(row);
      return input;
    }
    optionLabels.forEach(appendOption);
    renumber();
    addOption.onclick = () => {
      const input = appendOption();
      renumber();
      input.focus();
    };
  }
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (submit.hasAttribute("aria-disabled")) return;
    submit.setAttribute("aria-disabled", "true");
    error.hidden = true;
    status.textContent = "";
    try {
      const changes = { key };
      for (const [field, value] of new FormData(form)) {
        const previous = current[field === "privatePickupLocation" ? "pickupLocation" : field];
        if (value.trim() !== previous) changes[field] = value.trim();
      }
      if (optionList) {
        const options = Array.from(optionList.querySelectorAll("input"), field => field.value.trim());
        if (JSON.stringify(options) !== JSON.stringify(optionLabels)) changes.options = options;
      }
      if (pickupStart && (pickupStart.value !== pickupStart.defaultValue || pickupEnd.value !== pickupEnd.defaultValue))
        changes.pickupWindow = readPickupWindow(pickupStart, pickupEnd);
      if (taskDeadline && taskDeadline.value !== taskDeadline.defaultValue) {
        changes.taskDueAt = taskDeadline.value ? readLocalDateTime(taskDeadline) : null;
        if (changes.taskDueAt !== null && !Number.isSafeInteger(changes.taskDueAt))
          throw new Error(t("Choose a valid date and time for this task.", "请选择有效的任务日期和时间。"));
      }
      if (replacement && (replacement.files.length || removePhotos.checked)) changes.images = await photos.readImages();
      const updated = await api(endpoint, changes);
      current = updated;
      optionLabels = updated.options?.map(({ label }) => label);
      if (pickupStart) {
        pickupStart.defaultValue = pickupStart.value;
        pickupEnd.defaultValue = pickupEnd.value;
      }
      if (taskDeadline) taskDeadline.defaultValue = taskDeadline.value;
      if (replacement) {
        replacement.value = "";
        replacement.dispatchEvent(new Event("change"));
      }
      removePhotos.checked = false;
      photoRemoval.hidden = !updated.images?.length;
      status.textContent = t("Changes saved.", "已保存修改。");
      onSaved(updated, details, changes);
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
    } finally {
      submit.removeAttribute("aria-disabled");
    }
  };
  return details;
}

export function refreshOwnerPreview(host, post) {
  host.querySelector(".poll-title").textContent = post.title;
  document.title = `${post.title} — ScaleTag`;
  let description = host.querySelector(".poll-description");
  if (!description) {
    description = document.createElement("p");
    description.className = "poll-description";
    host.querySelector(".byline").after(description);
  }
  description.textContent = post.description;
  description.hidden = !post.description;
  host.querySelector(".sale-photos")?.remove();
  description.insertAdjacentHTML("afterend", uploadedPhotosHtml(post.images));
  if (post.type === "task" && !post.taskKind) host.querySelector(".task-reward h2").textContent = post.reward;
  const pickup = host.querySelector("#sale-pickup h2");
  if (post.type === "sale" && pickup) pickup.textContent = post.pickupLocation;
}

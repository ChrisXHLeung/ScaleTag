import {
  TRANSLATIONS,
  DYNAMIC_TRANSLATIONS,
  SERVER_ERRORS,
  FIELD_NAMES,
} from './locale-translations.js';

const LANGUAGES = new Map([
  ['en', { name: 'English', intl: 'en' }],
  ['zh', { name: '中文', html: 'zh-Hans', intl: 'zh-CN' }],
  ['ja', { name: '日本語', intl: 'ja-JP' }],
  ['ko', { name: '한국어', intl: 'ko-KR' }],
  ['fr', { name: 'Français', intl: 'fr-FR' }],
  ['pt', { name: 'Português', intl: 'pt-BR' }],
  ['es', { name: 'Español', intl: 'es-ES' }],
  ['de', { name: 'Deutsch', intl: 'de-DE' }],
  ['it', { name: 'Italiano', intl: 'it-IT' }],
]);

export const SUPPORTED_LANGUAGES = [...LANGUAGES.keys()];

export function htmlLangFor(lang = language) {
  return LANGUAGES.has(lang) ? LANGUAGES.get(lang).html ?? lang : 'en';
}

export function intlLocaleFor(lang = language) {
  return LANGUAGES.get(lang)?.intl ?? 'en';
}

export function languageFor(languages = []) {
  const primary = String(languages?.[0] ?? '').split('-')[0].toLowerCase();
  return LANGUAGES.has(primary) ? primary : 'en';
}

export function translate(lang, english, chinese) {
  if (lang === 'zh') return chinese;
  if (lang === 'en' || !LANGUAGES.has(lang)) return english;
  if (Object.hasOwn(TRANSLATIONS, english)) return TRANSLATIONS[english][lang] ?? english;
  for (const entry of DYNAMIC_TRANSLATIONS) {
    const match = entry.pattern.exec(english);
    if (match) return entry[lang]?.(match) ?? english;
  }
  return english;
}

const preferenceKey = 'scaletag-language';
const validLanguage = value => LANGUAGES.has(value);
let savedLanguage;
let storageAvailable = false;
if (typeof window !== 'undefined') {
  try {
    savedLanguage = window.localStorage.getItem(preferenceKey);
    // Test writes too: some environments allow reads but reject writes.
    window.localStorage.setItem(preferenceKey, savedLanguage ?? '');
    if (savedLanguage === null) window.localStorage.removeItem(preferenceKey);
    storageAvailable = true;
  } catch { /* Private/restricted browsers can still switch through the URL. */ }
}
const urlLanguage = typeof location === 'undefined' ? null : new URL(location.href).searchParams.get('lang');
export const language = storageAvailable && validLanguage(savedLanguage) ? savedLanguage :
  validLanguage(urlLanguage) ? urlLanguage : validLanguage(savedLanguage) ? savedLanguage :
  languageFor(typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language]));
export const t = (english, chinese) => translate(language, english, chinese);
if (validLanguage(urlLanguage) && storageAvailable) {
  try { window.localStorage.setItem(preferenceKey, language); }
  catch { storageAvailable = false; }
}

// Keep fallback navigation local; never copy a management fragment to another URL.
export function localizedPath(path) {
  const url = new URL(path, location.href);
  if (!storageAvailable && url.origin === location.origin) url.searchParams.set('lang', language);
  return url.href;
}

if (typeof document !== 'undefined') {
  document.documentElement.lang = htmlLangFor(language);
  const header = document.querySelector('.header-inner');
  if (header) {
    const control = document.createElement('div');
    control.className = 'language-control';
    const label = document.createElement('label');
    label.htmlFor = 'language-select';
    label.textContent = t('Language', '语言');
    const select = document.createElement('select');
    select.id = 'language-select';
    for (const [value, { name }] of LANGUAGES) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = name;
      option.lang = htmlLangFor(value);
      select.append(option);
    }
    select.value = language;
    control.append(label, select);
    header.append(control);
    if (!storageAvailable) {
      const warning = document.createElement('p');
      warning.className = 'language-storage-note';
      warning.id = 'language-storage-note';
      warning.textContent = t('Language cannot be saved in this browser. It stays with this URL and links opened here.', '此浏览器无法保存语言偏好；语言仅随当前网址及从此处打开的站内链接保留。');
      header.after(warning);
      select.setAttribute('aria-describedby', warning.id);
    }
    select.addEventListener('change', () => {
      if (select.value === language) return;
      const hasDraft = [...document.querySelectorAll('form input, form textarea, form select')].some(field => {
        if (field.form?.getAttribute('role') === 'search') return false;
        if (field.type === 'hidden' || field.type === 'submit' || field.type === 'button') return false;
        if (field.type === 'checkbox' || field.type === 'radio') return field.checked !== field.defaultChecked;
        if (field instanceof HTMLSelectElement) {
          const options = [...field.options];
          if (field.multiple) return options.some(option => option.selected !== option.defaultSelected);
          const marked = options.findLastIndex(option => option.defaultSelected);
          const initial = marked >= 0 ? marked : options.findIndex(option => !option.disabled);
          return field.selectedIndex !== initial;
        }
        return field.value !== field.defaultValue && field.value !== '';
      });
      if (hasDraft && !window.confirm(t('Changing language reloads this page and discards your unsent draft. Continue?', '切换语言将重新加载此页面，并丢弃尚未提交的草稿。是否继续？'))) {
        select.value = language;
        return;
      }
      let saved = false;
      try { window.localStorage.setItem(preferenceKey, select.value); saved = true; }
      catch { /* The URL carries the choice even without storage. */ }
      const url = new URL(location.href);
      if (saved) url.searchParams.delete('lang');
      else url.searchParams.set('lang', select.value);
      if (url.href === location.href) location.reload();
      else location.assign(url.href);
    });
  }
  if (!storageAvailable) {
    document.addEventListener('click', event => {
      const link = event.target.closest?.('a[href]');
      if (!link || link.hasAttribute('download') || link.getAttribute('href').startsWith('#')) return;
      const url = new URL(link.href, location.href);
      if (url.origin === location.origin && !url.pathname.startsWith('/api/') && /^https?:$/.test(url.protocol)) link.href = localizedPath(link.href);
    }, true);
  }
}

export const serverErrors = {
  'Invalid request origin. Please use the ScaleTag website.': '请求来源无效，请使用 ScaleTag 网站。',
  'Invalid content type.': '内容类型无效。',
  'Invalid filter.': '筛选条件无效。',
  'Invalid page cursor.': '分页参数无效。',
  'Invalid page cursor. Please reload the list.': '分页参数无效，请重新加载列表。',
  'This poll does not exist or has been removed from the website.': '此投票不存在或已从网站移除。',
  'Please allow this poll’s anonymous cookie and reload the page before voting.': '请允许此投票的匿名 Cookie，重新加载页面后再投票。',
  'Please allow this post’s anonymous cookie and reload before liking or replying.': '请允许此帖子的匿名 Cookie，重新加载后再点赞或回复。',
  'Please allow this post’s anonymous cookie and reload before reporting.': '请允许此帖子的匿名 Cookie，重新加载后再举报。',
  'This post has been permanently frozen after reports.': '此帖子因收到举报已被永久冻结。',
  'Please select exactly one option.': '请选择一个选项。',
  'Please select a valid option.': '请选择有效选项。',
  'Please select one or more different options.': '请选择一个或多个不同的有效选项。',
  'Choose a valid ballot type.': '请选择有效的投票类型。',
  'Too many replies. Please try again in a minute.': '回复过多，请一分钟后重试。',
  'Tasks do not accept votes.': '任务不接受投票。',
  'This poll has reached its current vote limit.': '此投票已达到当前投票上限。',
  'This post has reached its like limit.': '此帖子已达到点赞上限。',
  'Replies are available on tasks only.': '只有任务可以接收回复。',
  'Endpoint not found.': '接口不存在。',
  'Page not found.': '页面不存在。',

  'Upload at most 2 images.': '最多只能上传 2 张照片。',
  'Each image must be a JPEG, PNG or WebP no larger than 1 MiB.': '每张原图须为 JPEG、PNG 或 WebP，且不超过 1 MiB。',
  'This image is invalid, too large to decode, or cannot be safely compressed. Use another JPEG, PNG or WebP.': '这张照片无法读取、尺寸过大或无法安全压缩，请换一张 JPEG、PNG 或 WebP 照片。',
  'This post is closed and no longer accepts replies.': '这条帖子已关闭，不再接受新回复或出价。',
  'Enter a nonnegative offer amount with up to two decimal places and an optional currency, for example CAD 40 or $40.50. Keep contact details in the private fields.': '请填写非负金额，最多两位小数，可加币种，例如 CAD 40 或 $40.50。联系方式请填写在私密字段。',
  'Sale not found.': '出售信息不存在或已到期。',
  'This management link is invalid for this sale.': '这条出售信息的管理链接无效。',
  'Use the matching reply or offer form.': '请使用此帖对应的回复或出价表单。',
  'Replies are available on tasks and sales only.': '只有任务和出售信息可以接收回复或出价。',
  'Confirm that your offer is non-binding communication only. ScaleTag does not handle payments, transactions, reservations or completed sales.': '请确认出价仅表示交流意向，不代表订单或成交。ScaleTag 不处理付款、交易、预订或成交记录。',
  'A sale listing can only be closed. No sale or reservation is recorded.': '出售信息只能关闭，不记录成交或预订。',
  'Post not found.': '帖子不存在。',
  'Poll not found.': '投票不存在。',
  'Task not found.': '任务不存在。',
  'This management link is invalid for this task.': '此任务的管理链接无效。',
  'Choose a valid task status.': '请选择有效的任务状态。',
  'A valid GPS location is required. Allow location access and try again.': '需要有效的 GPS 位置。请允许定位后重试。',
  'Please complete the poll form.': '请填写完整的投票表单。',
  'Please complete the task form.': '请填写完整的任务表单。',
  'You can add up to 2 external images.': '最多可添加 2 张外部图片。',
  'Enter a valid HTTPS image URL.': '请输入有效的 HTTPS 图片链接。',
  'Images require HTTPS URLs without login credentials.': '图片须使用不含登录凭据的 HTTPS 链接。',
  'Please acknowledge the data retention policy.': '请确认数据保留政策。',
  'Provide between 2 and 12 options.': '请提供 2 至 12 个选项。',
  'Options must be unique.': '选项不能重复。',
  'Please complete your reply.': '请填写完整回复。',
  'Enter a valid phone number.': '请输入有效的电话号码。',
  'Enter a valid email address.': '请输入有效的电子邮箱地址。',
  'Your name and message are public. Remove the phone number or email address from them. If this task offers private contact fields, use those instead.': '你的姓名和留言是公开的。请删除其中的电话号码或邮箱；如果任务提供私人联系信息字段，请填写在那里。',
  'This older task has no private management link, so its poster cannot retrieve contact details. It no longer accepts replies.': '此旧任务没有私人管理链接，发布者无法查看联系方式，因此不再接受回复。',
  'Provide a phone number or email address, or both. Only the task creator can see them.': '请提供电话号码或电子邮箱，也可同时提供。持有私人管理链接的人和 ScaleTag 管理员可以查看，私人备份中也会保留。',
  'Please confirm that your name and message will be public and that contact details stay private to the task creator. Reload the page if you do not see this notice.': '请确认你的姓名和留言将公开，而持有私人管理链接的人和 ScaleTag 管理员可以查看，私人备份中也会保留。如未看到此提示，请重新加载页面。',
  'This browser has already voted in this poll.': '此浏览器已参与此投票。',
  'Voting has ended. You can still view results and share the QR code.': '投票已结束，你仍可查看结果并分享二维码。',
  'This task has reached its 200-reply limit.': '此任务已达到 200 条回复的上限。',
  'Please wait a minute before posting another reply to this task.': '请等待一分钟后再回复此任务。',
  'Storage is currently at capacity. Please try again later.': '存储空间已满，请稍后重试。',
  'The service is currently at capacity. Please try again later.': '服务已达容量上限，请稍后重试。',
  'Too many posts are being published. Please try again in a minute.': '发布请求过多，请一分钟后重试。',
};

const LENGTH_ERROR_RE = /^(Title|Description|Signature|Image URL|Option|Reward|Reply|Name|Phone|Email|Asking price|Offer|Pickup location) (is required and )?must be at most (\d+) characters\.$/;
const BLOCKED_ERROR_RE = /^(Title|Description|Signature|Option|Reward|Reply|Name|Pickup location) contains words or phrases that are not allowed in public text\. Please edit it and try again\.$/;
const FINAL_REPLY_RE = /^This task is (completed|closed) and no longer accepts replies\.$/;
const FINAL_STATE_RE = /^This task is already (completed|closed)\. Its status can no longer change\.$/;

const ERROR_FORMATS = {
  zh: {
    length: (name, required, max) => `${name}${required ? '为必填项，且' : ''}最多 ${max} 个字符。`,
    blocked: name => `${name}包含公开内容不允许使用的词语，请修改后重试。`,
    finalReply: completed => `此任务已${completed ? '完成' : '关闭'}，不再接受回复。`,
    finalState: completed => `此任务已${completed ? '完成' : '关闭'}，状态无法再更改。`,
  },
  ja: {
    length: (name, required, max) => `${name}${required ? 'は必須項目であり、' : 'は'}${max}文字以内で入力してください。`,
    blocked: name => `${name}に公開テキストでは許可されていない語句が含まれています。修正してもう一度お試しください。`,
    finalReply: completed => `このタスクは${completed ? '完了' : '終了'}しているため、返信を受け付けていません。`,
    finalState: completed => `このタスクはすでに${completed ? '完了' : '終了'}しています。ステータスは変更できません。`,
  },
  ko: {
    length: (name, required, max) => `${name}${required ? '은(는) 필수이며 ' : '은(는) '}최대 ${max}자까지 입력할 수 있습니다.`,
    blocked: name => `${name}에 공개 텍스트에서 허용되지 않는 단어나 문구가 포함되어 있습니다. 수정한 후 다시 시도해 주세요.`,
    finalReply: completed => `이 작업은 ${completed ? '완료' : '종료'}되어 더 이상 댓글을 받지 않습니다.`,
    finalState: completed => `이 작업은 이미 ${completed ? '완료' : '종료'}되었습니다. 상태를 변경할 수 없습니다.`,
  },
  fr: {
    length: (name, required, max) => `${name} ${required ? 'est obligatoire et ' : ''}doit contenir au maximum ${max} caractères.`,
    blocked: name => `${name} contient des mots ou expressions non autorisés dans un texte public. Veuillez modifier le texte et réessayer.`,
    finalReply: completed => `Cette tâche est ${completed ? 'terminée' : 'fermée'} et n’accepte plus de réponses.`,
    finalState: completed => `Cette tâche est déjà ${completed ? 'terminée' : 'fermée'}. Son statut ne peut plus être modifié.`,
  },
  pt: {
    length: (name, required, max) => `${name}: ${required ? 'campo obrigatório, com ' : ''}no máximo ${max} caracteres.`,
    blocked: name => `${name}: há palavras ou expressões proibidas em conteúdo público. Edite o texto e tente novamente.`,
    finalReply: completed => `Esta tarefa foi ${completed ? 'concluída' : 'encerrada'} e não aceita mais respostas.`,
    finalState: completed => `Esta tarefa já foi ${completed ? 'concluída' : 'encerrada'}. O status não pode mais ser alterado.`,
  },
  es: {
    length: (name, required, max) => `${name}: ${required ? 'campo obligatorio, con un ' : ''}máximo de ${max} caracteres.`,
    blocked: name => `${name}: el texto contiene palabras o expresiones no permitidas en contenido público. Edítalo e inténtalo de nuevo.`,
    finalReply: completed => `Esta tarea se ha ${completed ? 'completado' : 'cerrado'} y ya no admite respuestas.`,
    finalState: completed => `Esta tarea ya se ha ${completed ? 'completado' : 'cerrado'}. Su estado ya no se puede cambiar.`,
  },
  de: {
    length: (name, required, max) => `${name}: ${required ? 'Pflichtfeld mit ' : ''}maximal ${max} Zeichen.`,
    blocked: name => `${name}: Der Text enthält Wörter oder Ausdrücke, die in öffentlichen Inhalten nicht erlaubt sind. Bearbeite ihn und versuche es erneut.`,
    finalReply: completed => `Diese Aufgabe wurde ${completed ? 'erledigt' : 'geschlossen'}. Antworten sind nicht mehr möglich.`,
    finalState: completed => `Diese Aufgabe wurde bereits ${completed ? 'erledigt' : 'geschlossen'}. Ihr Status kann nicht mehr geändert werden.`,
  },
  it: {
    length: (name, required, max) => `${name}: ${required ? 'campo obbligatorio con un ' : ''}massimo di ${max} caratteri.`,
    blocked: name => `${name}: il testo contiene parole o espressioni non consentite nei contenuti pubblici. Modificalo e riprova.`,
    finalReply: completed => `Questa attività è stata ${completed ? 'completata' : 'chiusa'} e non accetta più risposte.`,
    finalState: completed => `Questa attività è già stata ${completed ? 'completata' : 'chiusa'}. Non è più possibile modificarne lo stato.`,
  },
};

export function translateError(message, targetLanguage = language) {
  if (!validLanguage(targetLanguage) || targetLanguage === 'en') {
    return ({
      'Sale not found.': 'Sale listing not found.',
      'This management link is invalid for this sale.': 'This management link is invalid for this listing.',
      'Replies are available on tasks and sales only.': 'Replies are available on tasks and sale listings only.',
    })[message] ?? message;
  }
  if (targetLanguage === 'zh' && Object.hasOwn(serverErrors, message)) {
    return serverErrors[message];
  }
  if (Object.hasOwn(SERVER_ERRORS, message)) {
    return SERVER_ERRORS[message][targetLanguage] ?? message;
  }
  const format = ERROR_FORMATS[targetLanguage];
  const length = LENGTH_ERROR_RE.exec(message);
  if (length) return format.length(FIELD_NAMES[length[1]][targetLanguage], Boolean(length[2]), length[3]);
  const blocked = BLOCKED_ERROR_RE.exec(message);
  if (blocked) return format.blocked(FIELD_NAMES[blocked[1]][targetLanguage]);
  const finalReply = FINAL_REPLY_RE.exec(message);
  if (finalReply) return format.finalReply(finalReply[1] === 'completed');
  const finalState = FINAL_STATE_RE.exec(message);
  if (finalState) return format.finalState(finalState[1] === 'completed');
  return message;
}

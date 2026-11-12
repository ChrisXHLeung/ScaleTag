export function languageFor(languages = []) {
  return /^zh(?:-|$)/i.test(languages[0] || '') ? 'zh' : 'en';
}
export function translate(language, english, chinese) {
  return language === 'zh' ? chinese : english;
}
const preferenceKey = 'scaletag-language';
const validLanguage = value => value === 'en' || value === 'zh';
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
  document.documentElement.lang = language === 'zh' ? 'zh-Hans' : 'en';
  const header = document.querySelector('.header-inner');
  if (header) {
    const control = document.createElement('div');
    control.className = 'language-control';
    const label = document.createElement('label');
    label.htmlFor = 'language-select';
    label.textContent = 'Language / 语言';
    const select = document.createElement('select');
    select.id = 'language-select';
    for (const [value, text] of [['en', 'English'], ['zh', '中文']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      option.lang = value === 'zh' ? 'zh-Hans' : 'en';
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
        if (field.type === 'hidden' || field.type === 'submit' || field.type === 'button') return false;
        if (field.type === 'checkbox' || field.type === 'radio') return field.checked !== field.defaultChecked;
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

const serverErrors = {
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
  'Too many replies. Please try again in a minute.': '回复过多，请一分钟后重试。',
  'Tasks do not accept votes.': '任务不接受投票。',
  'This poll has reached its current vote limit.': '此投票已达到当前投票上限。',
  'This post has reached its like limit.': '此帖子已达到点赞上限。',
  'Replies are available on tasks only.': '只有任务可以接收回复。',
  'Endpoint not found.': '接口不存在。',
  'Page not found.': '页面不存在。',

  'Upload at most 3 images.': '最多只能上传 3 张照片。',
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
  'You can add up to 3 external images.': '最多可添加 3 张外部图片。',
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
export function translateError(message) {
  if (language !== 'zh') return ({
    'Sale not found.': 'Sale listing not found.',
    'This management link is invalid for this sale.': 'This management link is invalid for this listing.',
    'Replies are available on tasks and sales only.': 'Replies are available on tasks and sale listings only.',
  })[message] ?? message;
  if (serverErrors[message]) return serverErrors[message];
  const match = /^(Title|Description|Signature|Image URL|Option|Reward|Reply|Name|Phone|Email|Asking price|Offer|Pickup location) (is required and )?must be at most (\d+) characters\.$/.exec(message);
  if (match) {
    const names = {'Pickup location':'领取地点', 'Asking price':'期望价格',Offer:'出价',Title:'标题', Description:'描述', Signature:'署名', 'Image URL':'图片链接', Option:'选项', Reward:'酬谢', Reply:'回复', Name:'姓名', Phone:'电话', Email:'邮箱'};
    return `${names[match[1]]}${match[2] ? '为必填项，且' : ''}最多 ${match[3]} 个字符。`;
  }
  const finalReply = /^This task is (completed|closed) and no longer accepts replies\.$/.exec(message);
  if (finalReply) return `此任务已${finalReply[1] === 'completed' ? '完成' : '关闭'}，不再接受回复。`;
  const finalState = /^This task is already (completed|closed)\. Its status can no longer change\.$/.exec(message);
  if (finalState) return `此任务已${finalState[1] === 'completed' ? '完成' : '关闭'}，状态无法再更改。`;
  return message;
}

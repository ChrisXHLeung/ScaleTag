export function languageFor(languages = []) {
  return /^zh(?:-|$)/i.test(languages[0] || '') ? 'zh' : 'en';
}
export function translate(language, english, chinese) {
  return language === 'zh' ? chinese : english;
}
export const language = languageFor(typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language]));
export const t = (english, chinese) => translate(language, english, chinese);

const serverErrors = {
  'Invalid request origin. Please use the ScaleTag website.': '请求来源无效，请使用 ScaleTag 网站。',
  'Invalid content type.': '内容类型无效。',
  'Invalid filter.': '筛选条件无效。',
  'Invalid page cursor.': '分页参数无效。',
  'Invalid page cursor. Please reload the list.': '分页参数无效，请重新加载列表。',
  'This poll does not exist or has been removed from the website.': '此投票不存在或已从网站移除。',
  'Please allow this poll’s anonymous cookie and reload the page before voting.': '请允许此投票的匿名 Cookie，重新加载页面后再投票。',
  'Please allow this post’s anonymous cookie and reload before liking or replying.': '请允许此帖子的匿名 Cookie，重新加载后再点赞或回复。',
  'Please select exactly one option.': '请选择一个选项。',
  'Please select a valid option.': '请选择有效选项。',
  'Too many replies. Please try again in a minute.': '回复过多，请一分钟后重试。',
  'Tasks do not accept votes.': '任务不接受投票。',
  'This poll has reached its current vote limit.': '此投票已达到当前投票上限。',
  'This post has reached its like limit.': '此帖子已达到点赞上限。',
  'Replies are available on tasks only.': '只有任务可以接收回复。',
  'Endpoint not found.': '接口不存在。',
  'Page not found.': '页面不存在。',

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
  'Provide a phone number or email address, or both. Only the task creator can see them.': '请提供电话号码或电子邮箱，也可同时提供。联系方式仅供任务创建者查看。',
  'Please confirm that your name and message will be public and that contact details stay private to the task creator. Reload the page if you do not see this notice.': '请确认你的姓名和留言将公开，而联系方式仅供任务创建者查看。如未看到此提示，请重新加载页面。',
  'This browser has already voted in this poll.': '此浏览器已参与此投票。',
  'Voting has ended. You can still view results and share the QR code.': '投票已结束，你仍可查看结果并分享二维码。',
  'This task has reached its 200-reply limit.': '此任务已达到 200 条回复的上限。',
  'Please wait a minute before posting another reply to this task.': '请等待一分钟后再回复此任务。',
  'Storage is currently at capacity. Please try again later.': '存储空间已满，请稍后重试。',
  'The service is currently at capacity. Please try again later.': '服务已达容量上限，请稍后重试。',
  'Too many posts are being published. Please try again in a minute.': '发布请求过多，请一分钟后重试。',
};
export function translateError(message) {
  if (language !== 'zh') return message;
  if (serverErrors[message]) return serverErrors[message];
  const match = /^(Title|Description|Signature|Image URL|Option|Reward|Reply|Name|Phone|Email) (is required and )?must be at most (\d+) characters\.$/.exec(message);
  if (match) {
    const names = {Title:'标题', Description:'描述', Signature:'署名', 'Image URL':'图片链接', Option:'选项', Reward:'报酬', Reply:'回复', Name:'姓名', Phone:'电话', Email:'邮箱'};
    return `${names[match[1]]}${match[2] ? '为必填项，且' : ''}最多 ${match[3]} 个字符。`;
  }
  const finalReply = /^This task is (completed|closed) and no longer accepts replies\.$/.exec(message);
  if (finalReply) return `此任务已${finalReply[1] === 'completed' ? '完成' : '关闭'}，不再接受回复。`;
  const finalState = /^This task is already (completed|closed)\. Its status can no longer change\.$/.exec(message);
  if (finalState) return `此任务已${finalState[1] === 'completed' ? '完成' : '关闭'}，状态无法再更改。`;
  return message;
}

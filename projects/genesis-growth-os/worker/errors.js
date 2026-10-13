// 机器字段名保持英文，用户可见错误统一为中文。
const MESSAGES = {
  'Genesis agent integration is not configured.': 'Agent 身份认证尚未配置。',
  'Cross-origin agent requests are not allowed.': '不允许此来源的跨域请求。',
  'Genesis agent authentication failed.': 'Agent 身份认证失败：缺少或无效的 Token。',
  'Genesis agent payload is too large.': 'Agent 请求内容过大。',
  'Invalid JSON request body.': '请求正文不是有效的 JSON。',
  'Payload must be a safe JSON object.': '请求正文必须是安全的 JSON 对象。',
  'project payload must be an object.': '项目数据必须是 JSON 对象。',
  'growth payload must be an object.': '成长记录必须是 JSON 对象。',
  'asset payload must be an object.': '资产数据必须是 JSON 对象。',
  'progress must be between 0 and 100.': '项目进度必须在 0 到 100 之间。',
  'metric_value must be finite.': '指标数值必须是有限数字。',
  'Idempotency-Key was already used for a different request.': '幂等键已用于另一请求，请勿用同一键提交不同内容。',
  'project_id does not reference an existing project.': '关联项目不存在，请先保存项目。',
  'Project not found.': '未找到该项目。',
  'Not found': '未找到该接口。',
  'Method not allowed': '此接口不支持当前请求方法。',
  'Genesis API unavailable.': 'Genesis 服务暂时不可用，请稍后重试。',
};
export function chineseError(message) {
  if (MESSAGES[message]) return MESSAGES[message];
  const rules = [
    [/^(.+) is required\.$/, '不能为空。'],
    [/^(.+) is invalid or too long\.$/, '无效或超过长度限制。'],
    [/^(.+) is invalid or too large\.$/, '无效或超过大小限制。'],
    [/^(.+) is invalid\.$/, '无效。'],
    [/^(.+) must be an array\.$/, '必须是数组。'],
    [/^(.+) must be an object or array\.$/, '必须是对象或数组。'],
    [/^(.+) must be a valid date\.$/, '必须是有效日期。'],
  ];
  for (const [pattern, suffix] of rules) {
    const match = message.match(pattern);
    if (match) return `${match[1]} ${suffix}`;
  }
  return /[\u4e00-\u9fff]/.test(message) ? message : '请求失败，请检查参数后重试。';
}

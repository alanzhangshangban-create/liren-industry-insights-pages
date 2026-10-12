export const ALLOWED_CATEGORIES = ['美妆', '护肤', '洗护', '宠物保健', 'Target Group', '电商AI'];
export const ALLOWED_LEVELS = ['重大变化', '重要动态', '常规更新'];
export const ALLOWED_EVIDENCE_TYPES = [
  'regulatorInterpretation',
  'professionalImplementation',
  'industryAssociationInterpretation',
  'companyResponse'
];
export const FORBIDDEN_TERMS = [
  '管理层判断', '丽人启示', '建议行动', '后续措施', '业务Tracking', '业务 tracking',
  '目标达成率', '风险店铺', '内部预算', '内部目标', '待定'
];

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validHttpsUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('https://')) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function hasAuthorizedEditorialLead(issue) {
  const leadItems = issue.items.filter(news => news.editorialPlacement === 'lead');
  return leadItems.length === 1 && nonempty(issue.editorialOverride?.reason)
    && validDate(issue.editorialOverride?.authorizedAt) && nonempty(leadItems[0].dateNote);
}

function sourceGate(news) {
  const sources = news.sources || [];
  const official = sources.filter(source => source.kind === 'official').length;
  const independent = sources.filter(source => source.kind === 'independent').length;
  if (news.sourceMode === 'official_disclosure') {
    const verified = news.disclosureVerification;
    return official >= 1 && verified?.publisherIdentityVerified === true
      && verified?.disclosureDateVerified === true && verified?.scope === 'announcement';
  }
  if (news.sourceMode === 'confirmed_material') {
    const confirmation = news.materialConfirmation;
    return nonempty(confirmation?.publisher) && confirmation?.publisherConfirmed === true
      && confirmation?.publicationDateConfirmed === true && validDate(confirmation?.confirmedPublishedAt)
      && confirmation?.confirmedPublishedAt === news.publishedAt
      && ['screenshot_excerpt', 'public_notice'].includes(confirmation?.materialType)
      && confirmation?.scope === 'visible_announcement' && confirmation?.evidenceRetained === true
      && sources.some(source => source.kind === 'confirmed_material' && validHttpsUrl(source.url));
  }
  if (Object.hasOwn(news, 'sourceMode')) return false;
  return (official >= 1 && independent >= 1) || independent >= 3;
}

export function requiresImplementationEvidence(news) {
  return ['policy', 'standard'].includes(news.eventType);
}

export function validateIssues(issues) {
  const errors = [];
  for (const issue of issues) {
    if (issue.items.length > 9) errors.push(`${issue.id} 新闻数量超过9条`);
    if (issue.items.some(news => news.editorialPlacement === 'lead') && !hasAuthorizedEditorialLead(issue)) {
      errors.push(`${issue.id} 专题补录需唯一首位条目、明确授权理由、有效授权日期及日期说明`);
    }
    const categoryCounts = new Map();
    for (const news of issue.items) {
      categoryCounts.set(news.category, (categoryCounts.get(news.category) || 0) + 1);
      if (!ALLOWED_CATEGORIES.includes(news.category)) errors.push(`${news.id} 使用了未允许板块`);
      if (!ALLOWED_LEVELS.includes(news.level)) errors.push(`${news.id} 事件等级无效`);
      if (news.score < 65) errors.push(`${news.id} 评分低于65分`);
      if (!Array.isArray(news.industryImpact) || news.industryImpact.length < 1 || news.industryImpact.length > 3) errors.push(`${news.id} 行业影响需包含1至3点`);
      if (!sourceGate(news)) errors.push(`${news.id} 来源未通过核验门槛`);
      if (news.sources.some(source => source.kind === 'provided_material')
        && (news.sourceMode !== 'confirmed_material' || news.editorialPlacement !== 'lead' || !hasAuthorizedEditorialLead(issue))) {
        errors.push(`${news.id} 附带材料仅限明确授权的专题首位`);
      }
      for (const source of news.sources) {
        if (!source.url.startsWith('https://')) errors.push(`${news.id} 存在非HTTPS来源`);
      }
      if (requiresImplementationEvidence(news)) {
        if (!Array.isArray(news.implementationEvidence) || news.implementationEvidence.length === 0) {
          errors.push(`${news.id} 缺少落地证据`);
        } else {
          for (const evidence of news.implementationEvidence) {
            if (!ALLOWED_EVIDENCE_TYPES.includes(evidence.type)) errors.push(`${news.id} 落地证据类型无效`);
            if (!evidence.sourceUrl?.startsWith('https://')) errors.push(`${news.id} 落地证据存在非HTTPS来源`);
          }
        }
      }
      const body = `${news.title} ${news.summary} ${(news.industryImpact || []).join(' ')}`.toLowerCase();
      for (const term of FORBIDDEN_TERMS) {
        if (body.includes(term.toLowerCase())) errors.push(`${news.id} 包含敏感或禁用表述：${term}`);
      }
    }
    for (const [category, count] of categoryCounts) {
      if (count > 3) errors.push(`${issue.id} 的${category}板块超过3条`);
    }
  }
  return errors;
}

export function getLatestIssue(issues) {
  if (!issues.length) return null;
  return [...issues].sort((a, b) => b.id.localeCompare(a.id))[0];
}

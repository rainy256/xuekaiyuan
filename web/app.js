const byId = id => document.getElementById(id);
const main = byId('main');
const icons = {
  home: '<path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7"/>',
  archive: '<path d="M4 4h16v16H4zM8 8h8m-8 4h8m-8 4h5"/>',
  big: '<path d="M4 20h16M6 16v-4m6 4V6m6 10V9"/>',
  small: '<path d="M3 6h18v12H3zM3 7l9 6 9-6"/>',
  sentence: '<path d="M12 6c-3-2-6-2-9-1v13c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1zm0 0v13"/>',
  manage: '<path d="M4 7h16M4 12h16M4 17h16M8 5v4m8 1v4m-7 1v4"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/>',
};
const glyph = name => '<svg viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + '</svg>';
const e = value => String(value ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[x]);
const readLocal = k => { try { return localStorage.getItem(k); } catch { return null; } };
const saveLocal = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const categories = { large: '大作文', small: '小作文', review: '待核对' };
const headings = {
  source: '真题与图表', draft: '原稿', review: '评分与批改', model: '精修范文与译文',
  paragraphs: '段落解析', compare: '修改对照', patterns: '重点句型', plan: '个人复习建议',
};
const state = { essays: [], progress: {}, loaded: false };
const mobile = matchMedia('(max-width: 760px)');
let mobileOpen = false;
let toastTimer;
let renderNumber = 0;

async function api(path, method = 'GET', body) {
  const response = await fetch('/api' + path, {
    method, cache: 'no-store', ...(body === undefined ? {} : {
      body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
    }),
  });
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(parsed.error || '读取或保存失败，请重新登录后重试。');
  return parsed;
}
async function reload() {
  Object.assign(state, await api('/library'));
  state.loaded = true;
  byId('connection').textContent = '私人档案';
}
function toast(message) {
  const notice = byId('toast');
  notice.textContent = message;
  notice.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { notice.hidden = true; }, 3300);
}
function route(path, replace = false) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  mobileOpen = false;
  syncNavigation();
  window.scrollTo(0, 0);
  render();
  main.focus({ preventScroll: true });
}
function syncNavigation() {
  const hide = mobile.matches ? !mobileOpen : readLocal('yanxie.nav') === 'closed';
  const control = byId('toggle-nav');
  document.body.classList.toggle('nav-hidden', hide);
  byId('mobile-overlay').hidden = !mobile.matches || hide;
  control.setAttribute('aria-expanded', String(!hide));
  control.setAttribute('aria-label', hide ? '展开导航' : '收起导航');
}
function setTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  byId('theme').setAttribute('aria-pressed', String(dark));
}
function link(path, label, cls = '') {
  return '<a class="' + cls + '" href="' + e(path) + '" data-route>' + label + '</a>';
}
function tag(text, variant = '') { return '<span class="tag ' + variant + '">' + e(text) + '</span>'; }
function text(value, cls = '') {
  return value ? '<div class="text-body ' + cls + '">' + e(value) + '</div>' : '<p class="subtle">资料待补充</p>';
}
function optional(value, label, cls = '') {
  return value ? '<p class="' + cls + '"><strong>' + e(label) + '</strong> ' + e(value) + '</p>' : '';
}
function list(values, ordered = false) {
  if (!values?.length) return '<p class="subtle">资料待补充</p>';
  const name = ordered ? 'ol' : 'ul';
  return '<' + name + '>' + values.map(x => '<li>' + e(x) + '</li>').join('') + '</' + name + '>';
}
function panel(id, body) {
  return '<section class="surface panel" id="' + id + '"><h2>' + headings[id] + '</h2>' + body + '</section>';
}
function pathOf(record) { return '/essays/' + record.id; }
function liveEssays() {
  return state.essays.filter(item => !item.archived).sort((a,b) =>
    (b.record.year ?? '').localeCompare(a.record.year ?? '') || a.record.id.localeCompare(b.record.id));
}
function allSentences() {
  return liveEssays().flatMap(item => (item.record.sentences ?? []).map(s => ({s, r: item.record, key: item.record.id + ':' + s.id})));
}
function nav(path, type) {
  const essays = liveEssays();
  const current = path === '/' ? '/' : path === '/essays' ? '/essays' + (type ? '?type=' + type : '') : path.startsWith('/essays/') ? '/essays' : path;
  const item = (href, title, icon, total = '') =>
    '<a class="nav-link" data-route href="' + e(href) + '"' + (current === href ? ' aria-current="page"' : '') + '>' +
    glyph(icon) + e(title) + (total !== '' ? '<small>' + total + '</small>' : '') + '</a>';
  byId('sidebar').innerHTML = '<nav>' + item('/', '学习概览', 'home') + '<p class="nav-caption">写作档案</p>' +
    item('/essays', '全部作文', 'archive', essays.length) +
    item('/essays?type=large', '大作文', 'big', essays.filter(x => x.type === 'large').length) +
    item('/essays?type=small', '小作文', 'small', essays.filter(x => x.type === 'small').length) +
    (essays.some(x => x.type === 'review') ? item('/essays?type=review', '待核对', 'archive') : '') +
    item('/sentences', '句型库', 'sentence', allSentences().length) +
    '</nav><nav class="nav-foot">' + item('/manage', '数据管理', 'manage') + '</nav>';
}
function essayCard(item) {
  const r = item.record;
  return link(pathOf(r), '<div class="card-top">' + tag(categories[item.type], item.type === 'small' ? 'gold' : '') +
    '<span class="year">' + e(r.year ? r.year + ' 年' : '年份待补充') + '</span></div><h3>' + e(r.title) +
    '</h3><div class="card-foot"><span>' + e(r.score || r.kind || r.status || '查看批改') +
    '</span><span class="arrow" aria-hidden="true">↗</span></div>', 'surface essay-card');
}
function grid(items) {
  return items.length ? '<div class="essay-grid">' + items.map(essayCard).join('') + '</div>' :
    '<div class="surface empty">没有符合条件的作文。</div>';
}
function overview() {
  const essays = liveEssays();
  return '<div class="hero"><div><div class="eyebrow">考研英语二 · 写作复盘</div><h1>研写档案</h1>' +
    '<p>对照手写原稿和精修范文，把每次批改里值得复用的表达留在句型库。</p>' +
    link('/essays', '打开作文档案 <span aria-hidden="true">→</span>', 'button') +
    '</div><div class="hero-meta"><div><b>' + essays.length + '</b><span>篇作文</span></div><div><b>' +
    allSentences().length + '</b><span>条句型</span></div></div></div>' +
    '<div class="section-head"><h2>作文档案</h2>' + link('/essays', '筛选全部作文 →') + '</div>' + grid(essays.slice(0, 6));
}
function options(values, placeholder) {
  return '<option value="">' + e(placeholder) + '</option>' + [...new Set(values.filter(Boolean))]
    .map(v => '<option value="' + e(v) + '">' + e(v) + '</option>').join('');
}
function filterInput(id, hint) {
  return '<label class="filter">' + glyph('search') + '<input id="' + id + '" type="search" aria-label="' + e(hint) + '" placeholder="' + e(hint) + '"></label>';
}
function filterText(value, query) {
  return query.trim().toLowerCase().split(/\s+/).every(word => value.toLowerCase().includes(word));
}
function essaysView(type) {
  const items = liveEssays().filter(x => !type || x.type === type);
  main.innerHTML = '<div class="wrap"><div class="page-head"><div><h1>' + (categories[type] || '全部作文') +
    '</h1><p>按年份、主题或关键词定位要复盘的文章。</p></div></div>' +
    '<div class="surface filters">' + filterInput('query', '搜索题干、原稿、批改或范文') +
    '<select id="year" aria-label="筛选年份">' + options(items.map(x => x.record.year), '全部年份') + '</select>' +
    '<select id="topic" aria-label="筛选主题">' + options(items.flatMap(x => x.record.tags ?? []), '全部主题') +
    '</select></div><div id="essay-results"></div></div>';
  const results = () => {
    const year = byId('year').value, topic = byId('topic').value, query = byId('query').value;
    byId('essay-results').innerHTML = grid(items.filter(({record:r}) => (!year || r.year === year) &&
      (!topic || r.tags?.includes(topic)) && filterText(JSON.stringify(r), query)));
  };
  for (const id of ['year', 'topic', 'query']) byId(id).addEventListener('input', results);
  results();
}
function photo(url, label) {
  return url ? '<details class="photo"><summary>' + label + '</summary><a href="' + e(url) +
    '" target="_blank" rel="noopener">查看原尺寸</a><img loading="lazy" decoding="async" alt="' + label +
    '" src="' + e(url) + '"></details>' : '<p class="subtle">' + label + ' · 来源待补充</p>';
}
function draftPhotos(assets) {
  const pages = assets.draftImages ?? [];
  if (!pages.length) return photo(assets.draftImage, '手写原图');
  const reading = assets.draftImage ? photo(assets.draftImage, '手写稿阅读版') : '';
  return reading + pages.map((url, i) => photo(url, '手写原图 · 照片 ' + (i + 1))).join('');
}
const chartReference = {
  'e2-2021-48': { ticks: [0,10,20,30,40,50,60], axisDecimals: 1, valueDecimals: 1 },
  'e2-2022-48': { ticks: [0,30], valueDecimals: 2 },
  'e2-2024-48': { ticks: [0,10,20,30,40,50,60,70,80,90,100], axisDecimals: 2, valueDecimals: 2,
    title: '某高校实践活动课学生主要收获调查' },
};
function chart(r) {
  if (!r.chart?.length) return '';
  const rows = r.chart;
  const options = r.chartOptions ?? chartReference[r.id] ?? {};
  const ticks = options.ticks ?? [0,20,40,60,80,100];
  const max = ticks.at(-1) || 100;
  const percent = (v, decimals = 0) => Number(v).toFixed(decimals) + '%';
  const value = v => percent(v, options.valueDecimals ?? 1);
  const axis = v => percent(v, options.axisDecimals);
  const scale = v => v * 100 / max;
  let picture;
  if (r.chartType === 'horizontal') {
    picture = '<div class="chart-h"><div class="h-categories">' +
      rows.map(d => '<span class="chart-label">' + e(d.label) + '</span>').join('') +
      '</div><div class="h-plot">' + ticks.map(v => '<i class="h-grid" style="left:' + scale(v) + '%"></i>').join('') +
      rows.map(d => '<div class="h-bar" style="width:' + scale(d.value) + '%"><span class="chart-value ' +
        (scale(d.value) > 77 ? 'inside' : '') + '">' + value(d.value) + '</span></div>').join('') +
      '</div><div class="h-ticks">' + ticks.map((v,i) => '<span class="chart-axis tick-' + (i % 2) + ' step-' + (i % 3) +
        '" style="left:' + scale(v) + '%">' + axis(v) + '</span>').join('') + '</div></div>';
  } else if (r.chartType === 'line') {
    const n = rows.length;
    const x = i => 100 * (i + .5) / n;
    const top = v => 100 - Math.min(96, scale(v)) * .91;
    const points = rows.map((d,i) => x(i) + ',' + top(d.value)).join(' ');
    picture = '<div class="line-figure"><svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">' +
      '<polyline points="' + points + '" fill="none" stroke="#4c8b71" stroke-width="2.25" vector-effect="non-scaling-stroke"/></svg>' +
      rows.map((d,i) => '<i class="line-dot" style="left:' + x(i) + '%;top:' + top(d.value) + '%"></i>' +
        '<span class="chart-value line-number line-' + (i % 2) + '" style="left:' + x(i) + '%;top:' +
        top(d.value) + '%">' + value(d.value) + '</span>').join('') +
      '</div><div class="line-years">' + rows.map(d => '<span class="chart-label">' + e(d.label) + '</span>').join('') + '</div>';
  } else {
    picture = '<div class="chart-v"><div class="v-scale">' +
      ticks.map(v => '<span class="chart-axis" style="bottom:' + scale(v) + '%">' + axis(v) + '</span>').join('') +
      '</div><div class="v-plot">' + ticks.map(v => '<i class="v-grid" style="bottom:' + scale(v) + '%"></i>').join('') +
      rows.map(d => '<div class="v-column"><i style="height:' + scale(d.value) +
        '%"><span class="chart-value">' + value(d.value) + '</span></i></div>').join('') +
      '</div><div class="v-labels">' + rows.map(d => '<span class="chart-label">' + e(d.label) + '</span>').join('') + '</div></div>';
  }
  const title = options.title || r.chartTitle || r.title;
  const source = r.id === 'e2-2024-48' ?
    '<p class="subtle">横向图的类别顺序和刻度依据公开版核对。 <a href="https://kaoyan.eol.cn/shiti/yingyu/202312/t20231226_2551126.shtml" target="_blank" rel="noopener">中国教育在线 2024 真题</a></p>' : '';
  return '<figure class="chart" aria-label="' + e(title) + '">' + (options.ylabel ? '<div class="subtle">' + e(options.ylabel) + '</div>' : '') +
    picture + '<figcaption>' + e(title) + '</figcaption></figure>' + source;
}
function diagnostic(d) {
  const mode = typeof d.required === 'boolean' ? (d.required ? '必须改正' : '可选润色') :
    d.level === '重点' ? '优先检查' : d.level === '提升' ? '可选润色' : '';
  return '<div class="review-row"><div class="inline">' + tag(d.level, d.level === '重点' ? 'rose' : '') +
    '<strong>' + e(d.category) + '</strong>' + (mode ? '<span class="subtle">' + e(mode) + '</span>' : '') +
    '</div><blockquote class="quote">' + e(d.quote) + '</blockquote><div class="en text-body">' + e(d.fix) + '</div>' +
    optional(d.reason, '批改说明') + optional(d.drill, '复练') + '</div>';
}
function sentenceCard(s, r, showEssay = false) {
  const key = r.id + ':' + s.id;
  const p = state.progress[key] || {};
  return '<article class="sentence" data-sentence="' + e(key) + '"><div class="inline">' + tag(s.cat || '其他') +
    (showEssay ? link(pathOf(r) + '#patterns', e(r.title), 'subtle') : '') + '</div><p class="sentence-en' +
    (p.favorite ? ' favorite' : '') + '" lang="en">' + e(s.en) + '</p><p class="sentence-cn">' + e(s.cn) + '</p>' +
    ((s.why || s.transfer) ? '<details><summary>用法与迁移</summary>' + optional(s.why, '用法') + optional(s.transfer, '迁移') + '</details>' : '') +
    '<footer><button class="button small" data-progress="favorite" aria-pressed="' + !!p.favorite +
    '">' + (p.favorite ? '★ 已收藏' : '☆ 收藏') + '</button><button class="button small" data-progress="mastered" aria-pressed="' +
    !!p.mastered + '">' + (p.mastered ? '✓ 已掌握' : '标记掌握') + '</button>' +
    '<button class="button small" data-copy>复制英文</button></footer></article>';
}
function sentencesView() {
  const entries = allSentences();
  main.innerHTML = '<div class="wrap"><div class="page-head"><div><h1>句型库</h1><p>按场景查找表达，标记已经掌握的句型。</p></div></div>' +
    '<div class="surface filters sent-filters">' + filterInput('sentence-query', '搜索中英文句型') +
    '<select id="sentence-cat" aria-label="句型分类">' + options(entries.map(x => x.s.cat || '其他'), '全部分类') +
    '</select><select id="sentence-status" aria-label="筛选学习状态"><option value="">全部状态</option><option value="favorite">已收藏</option>' +
    '<option value="mastered">已掌握</option><option value="pending">待掌握</option></select></div>' +
    '<p class="subtle" id="sentence-count" aria-live="polite"></p><div id="sentence-results" class="sentence-grid"></div></div>';
  for (const id of ['sentence-query','sentence-cat','sentence-status']) byId(id).addEventListener('input', fillSentences);
  fillSentences();
}
function fillSentences() {
  const category = byId('sentence-cat').value, status = byId('sentence-status').value, q = byId('sentence-query').value;
  const results = allSentences().filter(({s,key}) => (!category || (s.cat || '其他') === category) &&
    (!status || (status === 'pending' ? !state.progress[key]?.mastered : state.progress[key]?.[status])) &&
    filterText(JSON.stringify(s), q));
  byId('sentence-count').textContent = '显示 ' + results.length + ' 条句型';
  byId('sentence-results').innerHTML = results.map(({s,r}) => sentenceCard(s,r,true)).join('') ||
    '<div class="surface empty">没有符合条件的句型。</div>';
}
function articleView(essay, historic = false) {
  const { record:r, assets:a } = essay;
  const localPatterns = (r.sentences ?? []).map(s => sentenceCard(s,r)).join('');
  const contents = [
    panel('source', optional(r.origin, '资料来源', 'subtle') + text(r.prompt, 'en') + text(r.promptCn) +
      chart(r) + photo(a.promptImage, r.chart?.length ? '题图参考' : '题干原图')),
    panel('draft', optional(r.draftCaution, '手写辨读说明', 'callout') + text(r.initial, 'en raw') + draftPhotos(a)),
    panel('review', '<div class="duo"><div class="inset"><h3>初稿估分</h3>' + e(r.score || '待补充') +
      '</div><div class="inset"><h3>精修稿估分</h3>' + e(r.modelScore || '待补充') + '</div></div>' +
      optional(r.scoreNote, '估分说明', 'subtle') + '<div class="duo"><div class="inset"><h3>可保留</h3>' + list(r.strengths) +
      '</div><div class="inset"><h3>优先改进</h3>' + list(r.weaknesses) + '</div></div>' +
      ((r.diagnostics ?? []).map(diagnostic).join('') || '<p class="subtle">逐句批改待补充</p>')),
    panel('model', text(r.model, 'en') + '<h3 style="margin-top:16px">中文翻译</h3>' + text(r.translation)),
    panel('paragraphs', (r.paragraphs ?? []).map(p => '<div class="review-row"><h3>' + e(p.name) + '</h3>' +
      optional(p.purpose, '段落作用') + text(p.en,'en') + text(p.cn) + (p.points?.length ? list(p.points) : '') + '</div>').join('') ||
      '<p class="subtle">段落解析待补充</p>'),
    panel('compare',(r.comparisons ?? []).map(c => '<div class="review-row"><div class="duo"><div class="inset"><h3>原写法</h3>' +
      text(c.before,'en') + '</div><div class="inset"><h3>修改稿</h3>' + text(c.after,'en') + '</div></div>' +
      optional(c.why, '调整理由') + '</div>').join('') || '<p class="subtle">修改对照待补充</p>'),
    panel('patterns', localPatterns ? '<div class="row-list">' + localPatterns + '</div>' : '<p class="subtle">句型待补充</p>'),
    panel('plan', list(r.actionPlan,true) + optional(r.notes,'补充说明','callout')),
  ];
  return link('/essays', '← 返回作文档案', 'breadcrumb') + '<div class="surface article-head"><div class="inline">' +
    tag(categories[essay.type] ?? categories.review) + (r.kind ? tag(r.kind,'gold') : '') +
    (essay.archived ? tag('已归档','rose') : '') + (historic ? tag('历史版本','gold') : '') +
    '</div><h1>' + e(r.title) + '</h1>' + (r.subtitle ? '<p class="subtle">' + e(r.subtitle) + '</p>' : '') +
    '<div class="tags">' + (r.tags ?? []).map(t => tag(t)).join('') + '</div><div class="inline">' +
    (historic ? link(pathOf(r), '返回当前版', 'button small') :
      link('/manage?edit=' + e(r.id), '编辑作文', 'button small') +
      link(pathOf(r) + '?history=1', '版本历史', 'button small')) +
    '</div></div><div class="read-layout"><article>' +
    contents.join('') + '</article><nav class="surface toc" aria-label="文章目录"><h2>文章目录</h2>' +
    Object.entries(headings).map(([id,label]) => '<a href="#' + id + '">' + label + '</a>').join('') + '</nav></div>';
}
const baseRecord = {
  id: '', title: '', year: '', type: '', kind: '', subtitle: '', status: '已批改',
  tags: [], origin: '', prompt: '', promptCn: '', initial: '', draftCaution: '',
  chartType: '', chart: [], score: '', modelScore: '', scoreNote: '',
  model: '', translation: '', paragraphs: [], diagnostics: [], comparisons: [],
  sentences: [], strengths: [], weaknesses: [], actionPlan: [], notes: '',
};
const editorFields = [
  ['title','标题'], ['year','年份'], ['kind','题型'], ['origin','来源'],
  ['prompt','英文题干'], ['promptCn','中文题意'], ['initial','原稿转录'],
  ['draftCaution','手写辨读说明'], ['score','初稿估分'], ['modelScore','精修稿估分'],
  ['model','精修范文'], ['translation','中文翻译'], ['notes','补充说明'],
];
function field([name,label], r) {
  const long = ['prompt','promptCn','initial','draftCaution','model','translation','notes'].includes(name);
  const attr = ' name="' + name + '"' + (name === 'title' ? ' required' : '');
  return '<label>' + label + (long ? '<textarea' + attr + '>' + e(r[name]) + '</textarea>' :
    '<input' + attr + ' value="' + e(r[name]) + '"' + (name === 'year' ? ' inputmode="numeric" maxlength="4"' : '') + '>') + '</label>';
}
function manage(edit) {
  const selected = state.essays.find(x => x.record.id === edit);
  if (edit && (edit === 'new' || selected)) return editor(selected);
  const items = state.essays.slice().sort((a,b) => a.record.id.localeCompare(b.record.id));
  main.innerHTML = '<div class="wrap"><div class="page-head"><div><h1>数据管理</h1><p>更正作文、查看历史版本或备份学习记录。</p></div>' +
    link('/manage?edit=new','新增作文','button primary') + '</div>' +
    '<section class="surface panel"><h2>备份与导入</h2><p>备份包含作文、原图和当前账号的句型状态。导入按 ID 补充作文和缺失的学习标记。</p>' +
    '<p><a class="button" href="/api/backup" download="研写档案-备份.json">下载 JSON 备份</a></p>' +
    '<form class="edit-form" id="import-form"><label>选择 V5 导出文件或本站 JSON 备份<input name="file" type="file" accept=".json,application/json" required></label>' +
    '<div class="inline"><button type="submit" class="button">导入备份</button><span id="import-status" role="status"></span></div></form></section>' +
    '<section class="surface panel"><h2>作文与归档</h2>' +
    (items.length ? items.map(({record:r,archived,version}) => '<div class="manage-row"><div>' + link(pathOf(r),e(r.title)) +
      '<div class="subtle">版本 ' + version + (archived ? ' · 已归档' : '') + '</div></div><div class="inline">' +
      link('/manage?edit=' + r.id,'编辑','button small') + '<button class="button small" data-archive="' + r.id +
      '">' + (archived ? '恢复' : '归档') + '</button></div></div>').join('') : '<p class="subtle">暂无作文。</p>') +
    '</section></div>';
  byId('import-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    const message = byId('import-status');
    button.disabled = true;
    message.textContent = '正在导入…';
    try {
      const file = form.elements.file.files[0];
      if (file.size > 28 * 1024 * 1024) throw Error('备份超过 28 MB，请拆分为多次导入。');
      let body;
      try { body = JSON.parse(await file.text()); } catch { throw Error('无法读取该 JSON 文件。'); }
      if (Array.isArray(body)) body = {records:body};
      const out = await api('/backup','POST',body);
      await reload();
      nav('/manage');
      manage();
      byId('import-status').textContent = '新增 ' + out.inserted.length + ' 篇，跳过重复 ' + out.skipped.length +
        ' 篇，处理 ' + out.progress + ' 条句型状态。';
    } catch (error) { message.textContent = error.message; }
    finally { button.disabled = false; }
  });
}
function editor(selected) {
  const record = selected?.record ?? baseRecord;
  const meta = { ...record };
  for (const key of ['promptImage','draftImage','draftImages','type','id', ...editorFields.map(([name]) => name)]) delete meta[key];
  const pageCount = selected?.assets.draftImages?.length ?? 0;
  main.innerHTML = '<div class="wrap">' + link('/manage','← 返回数据管理','breadcrumb') +
    '<section class="surface panel"><h1>' + (selected ? '编辑作文' : '新增作文') + '</h1>' +
    '<form id="editor" class="edit-form" style="margin-top:16px"><div class="duo"><label>稳定 ID<input name="record-id" ' +
    'pattern="[A-Za-z0-9][A-Za-z0-9_\\-]{0,79}" maxlength="80" required value="' + e(record.id) + '"' +
    (selected ? ' readonly' : ' placeholder="e2-2024-48-practice2"') + '></label>' +
    '<label>类别<select name="type"><option value="">自动判断</option>' +
    Object.entries(categories).map(([key, label]) => '<option value="' + key + '"' + (record.type === key ? ' selected' : '') + '>' + label + '</option>').join('') +
    '</select></label></div>' + editorFields.map(f => field(f,record)).join('') +
    '<div class="duo">' + [['promptImage','题干原图'],['draftImage','手写原图']].map(([key,label]) =>
      '<label>' + label + (selected?.assets[key] ? ' · 已保存，选择文件可替换' : '') +
      '<input type="file" name="' + key + '" accept="image/jpeg,image/png,image/webp">' +
      (selected?.assets[key] ? '<span><input style="min-height:auto" type="checkbox" name="clear-' + key + '">从当前版移除</span>' : '') +
    '</label>').join('') + '</div>' +
    '<label>分张手写原图（最多 6 张）' + (pageCount ? ' · 已保存 ' + pageCount + ' 张，选新照片可替换整组' : '') +
    '<input type="file" name="draftImages" accept="image/jpeg,image/png,image/webp" multiple>' +
    (pageCount ? '<span><input style="min-height:auto" type="checkbox" name="clear-draftImages">从当前版移除整组原图</span>' : '') +
    '</label>' +
    '<details><summary>图表、句型、逐句批改和其他字段</summary><p class="subtle">在 JSON 中编辑图表数据、段落、逐句批改、修改对照、句型与复习计划。保留句型 ID 可保留学习标记。</p>' +
    '<label>结构化内容<textarea class="json-area" name="metadata" spellcheck="false">' +
    e(JSON.stringify(meta,null,2)) + '</textarea></label></details><div class="inline"><button type="submit" class="button primary">保存作文</button>' +
    '<span class="form-error" id="edit-status" role="status"></span></div></form></section></div>';
  byId('editor').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type=submit]');
    const msg = byId('edit-status');
    button.disabled = true;
    msg.textContent = '';
    try {
      let structured;
      try { structured = JSON.parse(form.elements.metadata.value); } catch { throw Error('结构化内容的 JSON 格式有误。'); }
      if (!structured || Array.isArray(structured) || typeof structured !== 'object') throw Error('结构化内容须为 JSON 对象。');
      const result = { ...structured, id: form.elements['record-id'].value.trim(),
        type: form.elements.type.value, ...Object.fromEntries(editorFields.map(([key]) => [key, form.elements[key].value])) };
      for (const key of ['promptImage','draftImage']) {
        const file = form.elements[key].files[0];
        delete result[key];
        if (file) result[key] = await readImage(file);
        else if (form.elements['clear-' + key]?.checked) result[key] = '';
      }
      const pages = [...form.elements.draftImages.files];
      if (pages.length > 6) throw Error('手写原图最多可上传 6 张。');
      delete result.draftImages;
      if (pages.length) result.draftImages = await Promise.all(pages.map(readImage));
      else if (form.elements['clear-draftImages']?.checked) result.draftImages = [];
      await api(selected ? '/essays/' + result.id : '/essays', selected ? 'PUT' : 'POST',
        selected ? { record: result, version: selected.version } : { record: result });
      await reload();
      route(pathOf(result));
      toast('作文已保存');
    } catch (error) { msg.textContent = error.message; }
    finally { button.disabled = false; }
  });
}
function readImage(file) {
  if (file.size > 8 * 1024 * 1024) throw Error('每张图片最大 8 MB。');
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error('读取图片失败。'));
    reader.readAsDataURL(file);
  });
}
async function showArticle(id, params, ticket) {
  const essay = state.essays.find(x => x.record.id === id);
  if (!essay) {
    main.innerHTML = '<div class="wrap surface empty">未找到这篇作文。 ' + link('/essays','返回作文档案') + '</div>';
    return;
  }
  if (params.has('history')) {
    main.innerHTML = '<div class="wrap">' + link(pathOf(essay.record),'← 返回作文','breadcrumb') +
      '<section class="surface panel"><h1>版本历史</h1><p>' + e(essay.record.title) + '</p><div id="history-table">正在读取…</div></section></div>';
    try {
      const items = await api('/essays/' + id + '/history');
      if (ticket !== renderNumber) return;
      byId('history-table').innerHTML = items.map(v => '<div class="manage-row"><div><strong>版本 ' + v.revision +
        '</strong><div class="subtle">' + e(new Date(v.saved_at).toLocaleString('zh-CN')) + (v.archived ? ' · 已归档' : '') +
        '</div></div>' + link(pathOf(essay.record) + '?version=' + v.revision,'查看版本','button small') + '</div>').join('');
    } catch (error) { if (ticket === renderNumber) byId('history-table').textContent = error.message; }
    return;
  }
  if (params.has('version')) {
    const ver = params.get('version');
    try {
      const previous = await api('/essays/' + id + '/history?version=' + encodeURIComponent(ver));
      if (ticket === renderNumber) main.innerHTML = '<div class="wrap">' + articleView(previous,true) + '</div>';
    } catch (error) { if (ticket === renderNumber) main.textContent = error.message; }
    return;
  }
  main.innerHTML = '<div class="wrap">' + articleView(essay) + '</div>';
  scrollToHash();
}
function scrollToHash() {
  const name = location.hash.slice(1);
  if (name && /^[a-z]+$/.test(name)) byId(name)?.scrollIntoView();
}
function render() {
  const ticket = ++renderNumber;
  const params = new URLSearchParams(location.search);
  const path = location.pathname.replace(/\/$/,'') || '/';
  const type = Object.hasOwn(categories, params.get('type')) ? params.get('type') : '';
  nav(path,type);
  if (!state.loaded) return;
  if (path === '/') main.innerHTML = '<div class="wrap">' + overview() + '</div>';
  else if (path === '/essays') essaysView(type);
  else if (path.startsWith('/essays/')) showArticle(path.slice('/essays/'.length),params,ticket);
  else if (path === '/sentences') sentencesView();
  else if (path === '/manage') manage(params.get('edit'));
  else main.innerHTML = '<div class="wrap surface empty">页面不存在。</div>';
}
async function clickAction(event) {
  const target = event.target;
  const link = target.closest('a[data-route]');
  if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) {
    event.preventDefault();
    route(link.getAttribute('href'));
    return;
  }
  const button = target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.archive) {
    const essay = state.essays.find(x => x.record.id === button.dataset.archive);
    if (!essay || !confirm(essay.archived ? '恢复这篇作文？' : '归档这篇作文？可以随时恢复。')) return;
    button.disabled = true;
    try {
      await api('/essays/' + essay.record.id + (essay.archived ? '/restore' : '/archive'), 'POST', {version:essay.version});
      await reload();
      render();
      toast(essay.archived ? '作文已恢复' : '作文已归档');
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
    return;
  }
  const block = button.closest('[data-sentence]');
  if (!block) return;
  if (button.hasAttribute('data-copy')) {
    try {
      await navigator.clipboard.writeText(block.querySelector('.sentence-en').textContent);
      toast('英文句型已复制');
    } catch { toast('复制不可用，可长按或选中文字手动复制。'); }
    return;
  }
  const field = button.dataset.progress;
  if (!field) return;
  const key = block.dataset.sentence;
  const [essayId,sentenceId] = key.split(':');
  const enabled = !state.progress[key]?.[field];
  button.disabled = true;
  try {
    await api('/progress','PATCH',{essayId,sentenceId,[field]:enabled});
    state.progress[key] = { ...state.progress[key], [field]: enabled };
    button.setAttribute('aria-pressed', String(enabled));
    button.textContent = field === 'favorite' ? (enabled ? '★ 已收藏' : '☆ 收藏') : (enabled ? '✓ 已掌握' : '标记掌握');
    if (field === 'favorite') block.querySelector('.sentence-en').classList.toggle('favorite',enabled);
    if (byId('sentence-status')?.value) fillSentences();
    toast('已同步学习状态');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}
byId('toggle-nav').addEventListener('click', () => {
  if (mobile.matches) mobileOpen = !mobileOpen;
  else saveLocal('yanxie.nav', document.body.classList.contains('nav-hidden') ? 'open' : 'closed');
  syncNavigation();
});
byId('mobile-overlay').addEventListener('click', () => { mobileOpen = false; syncNavigation(); });
byId('theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  saveLocal('yanxie.theme', dark ? 'dark' : 'light');
  setTheme(dark);
});
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && mobileOpen) {
    mobileOpen = false; syncNavigation(); byId('toggle-nav').focus();
  }
});
window.addEventListener('popstate', render);
mobile.addEventListener('change', syncNavigation);
document.addEventListener('click', clickAction);
setTheme((readLocal('yanxie.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark');
syncNavigation();
reload().then(render).catch(error => {
  byId('connection').textContent = '连接失败';
  main.innerHTML = '<div class="wrap surface empty"><h2>无法读取档案</h2><p>' + e(error.message) +
    '</p><button class="button" id="retry">重新加载</button></div>';
  byId('retry').addEventListener('click', () => location.reload());
});

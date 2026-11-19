const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; base-uri 'none'; form-action 'self'; object-src 'none'",
};
const imageFields = ['promptImage', 'draftImage'];
const draftImageLimit = 6;
const textFields = ['kind', 'subtitle', 'status', 'updatedAt', 'origin', 'prompt', 'promptCn', 'initial',
  'draftCaution', 'model', 'translation', 'score', 'modelScore', 'scoreNote', 'notes', 'chartTitle'];
const listFields = ['tags', 'strengths', 'weaknesses', 'actionPlan'];
const nestedFields = {
  paragraphs: ['name', 'en', 'cn', 'purpose', 'points'],
  diagnostics: ['level', 'category', 'quote', 'fix', 'reason', 'drill', 'required'],
  comparisons: ['before', 'after', 'why'],
  sentences: ['id', 'cat', 'en', 'cn', 'why', 'transfer'],
};
class Problem extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function expect(condition, message, status = 400) {
  if (!condition) throw new Problem(status, message);
}
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status, headers: { ...privateHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
function validId(value) { return typeof value === 'string' && idPattern.test(value); }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

async function identity(request, env) {
  const authorization = request.headers.get('X-Archive-Migration-Key');
  if (authorization && env.MIGRATION_KEY) {
    const encode = new TextEncoder();
    const [provided, expected] = await Promise.all([authorization, env.MIGRATION_KEY]
      .map(value => crypto.subtle.digest('SHA-256', encode.encode(value))));
    const a = new Uint8Array(provided), b = new Uint8Array(expected);
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
    if (mismatch === 0) return { id: 'migration:service', service: true };
  }
  const id = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  return id && email && env.OWNER_EMAIL && email.toLowerCase() === env.OWNER_EMAIL.toLowerCase()
    ? { id: 'account:' + id, service: false } : null;
}
function sameOrigin(request, user) {
  if (user.service) return;
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  expect((!origin || origin === new URL(request.url).origin) &&
    (!site || site === 'same-origin' || site === 'none'), '请求来源无法验证。', 403);
}
async function readBody(request, limit = 28 * 1024 * 1024) {
  expect(Number(request.headers.get('Content-Length') || 0) <= limit, '上传内容超过大小限制。', 413);
  expect(request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'),
    '请提交 JSON 数据。', 415);
  const reader = request.body?.getReader();
  expect(reader, '请求缺少数据。');
  const decoder = new TextDecoder();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new Problem(413, '上传内容超过大小限制。');
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  try { return JSON.parse(chunks.join('')); }
  catch { throw new Problem(400, 'JSON 格式有误。'); }
}

function validChartOptions(options) {
  return plain(options) && Object.keys(options).every(k => ['ticks','axisDecimals','valueDecimals','ylabel','title'].includes(k)) &&
    (!('ticks' in options) || (Array.isArray(options.ticks) && options.ticks.length >= 2 &&
      options.ticks.length <= 15 && options.ticks.every((v, i, a) => Number.isFinite(v) && v >= 0 && v <= 100 && (!i || v > a[i-1])))) &&
    ['axisDecimals', 'valueDecimals'].every(k => !(k in options) || [0, 1, 2].includes(options[k])) &&
    ['ylabel','title'].every(k => !(k in options) || typeof options[k] === 'string');
}
function checkRecord(record) {
  expect(plain(record) && validId(record.id) && typeof record.title === 'string' &&
    record.title.trim() && record.title.length <= 180, '作文需要合法的稳定 ID 和标题。');
  expect(record.type === undefined || ['large', 'small', 'review', ''].includes(record.type), '作文类型无效。');
  expect(record.year === undefined || (typeof record.year === 'string' && /^(?:\d{4})?$/.test(record.year)),
    '年份应为四位数字字符串，未知时可留空。');
  for (const key of textFields) {
    expect(!(key in record) || typeof record[key] === 'string', key + ' 应为文字。');
  }
  for (const key of listFields) {
    expect(!(key in record) || (Array.isArray(record[key]) && record[key].every(v => typeof v === 'string')),
      key + ' 应为文字列表。');
  }
  for (const [key, fields] of Object.entries(nestedFields)) {
    if (!(key in record)) continue;
    expect(Array.isArray(record[key]) && record[key].every(entry => plain(entry) && fields.every(field =>
      !(field in entry) || (field === 'points' ? Array.isArray(entry[field]) &&
        entry[field].every(text => typeof text === 'string') : field === 'required' ?
        typeof entry[field] === 'boolean' : typeof entry[field] === 'string'))), key + ' 的内容格式有误。');
  }
  if (record.sentences) {
    const ids = new Set(record.sentences.map(s => s.id));
    expect(ids.size === record.sentences.length && [...ids].every(validId) &&
      record.sentences.every(s => s.en?.trim()), '每条句型需要独立 ID 和英文句子。');
  }
  if ('chart' in record) {
    expect(Array.isArray(record.chart) && record.chart.length <= 24 &&
      record.chart.every(i => plain(i) && typeof i.label === 'string' && i.label.length <= 100 &&
        Number.isFinite(i.value) && i.value >= 0 && i.value <= 100), '图表数据必须是 0 到 100 的百分比。');
  }
  expect(!('chartType' in record) || ['', 'line', 'horizontal', 'vertical'].includes(record.chartType), '图表类型无效。');
  expect(!('chartOptions' in record) || validChartOptions(record.chartOptions), '图表刻度配置无效。');
  expect(!record.chartOptions?.ticks || !record.chart?.some(i => i.value > record.chartOptions.ticks.at(-1)),
    '坐标上界必须覆盖所有百分比。');
  for (const key of imageFields) {
    expect(!(key in record) || typeof record[key] === 'string', key + ' 应为图片 data URL。');
  }
  if ('draftImages' in record) {
    expect(Array.isArray(record.draftImages) && record.draftImages.length <= draftImageLimit &&
      record.draftImages.every(value => typeof value === 'string' && value.length > 0), '手写原图最多可上传 6 张。');
  }
}
function inferredType(r) {
  if (r.type) return r.type;
  if (r.chart?.length) return 'large';
  const prompt = [r.prompt, r.promptCn, r.subtitle].filter(Boolean).join(' ');
  if (/\b150 words\b|150\s*词|第\s*48\s*题/i.test(prompt)) return 'large';
  if (/\b100 words\b|100\s*词|第\s*47\s*题|\bwrite (?:him |her |them )?(?:a letter|an email)\b/i.test(prompt)) return 'small';
  return 'review';
}
function decodeImage(encoded) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(encoded);
  expect(match && match[2].length <= 11 * 1024 * 1024, '图片须为不超过 8 MB 的 JPG、PNG 或 WebP。');
  let raw;
  try { raw = atob(match[2]); } catch { throw new Problem(400, '图片编码有误。'); }
  expect(raw.length <= 8 * 1024 * 1024, '图片不能超过 8 MB。');
  const mime = match[1];
  expect((mime === 'image/jpeg' && raw.startsWith('\xff\xd8\xff')) ||
    (mime === 'image/png' && raw.startsWith('\x89PNG\r\n\x1a\n')) ||
    (mime === 'image/webp' && raw.startsWith('RIFF') && raw.slice(8, 12) === 'WEBP'), '图片内容与声明的格式不符。');
  return { mime, bytes: Uint8Array.from(raw, c => c.charCodeAt(0)) };
}
async function storeImage(encoded, env) {
  const { mime, bytes } = decodeImage(encoded);
  const key = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    x => x.toString(16).padStart(2, '0')).join('');
  if (!await env.BUCKET.head(key)) await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: mime } });
  return { key, mime };
}
function toBase64(bytes) {
  const text = [];
  for (let i = 0; i < bytes.length; i += 16384) text.push(String.fromCharCode(...bytes.subarray(i, i + 16384)));
  return btoa(text.join(''));
}
function sql(env, statement, ...bindings) { return env.DB.prepare(statement).bind(...bindings); }
async function current(env, id) { return sql(env, 'SELECT * FROM current_essays WHERE essay_id = ?', id).first(); }
function unpack(row) { return JSON.parse(row.payload); }
function visibleEssay(row) {
  const { record, assets } = unpack(row);
  const url = asset => '/api/images/' + asset.key;
  const urls = Object.fromEntries(Object.entries(assets)
    .map(([field, asset]) => [field, Array.isArray(asset) ? asset.map(url) : url(asset)]));
  return { record: { ...record }, assets: urls, version: row.revision,
    archived: Boolean(row.archived), savedAt: row.saved_at, type: inferredType(record) };
}
async function dbEssays(env) {
  const result = await sql(env, 'SELECT * FROM current_essays ORDER BY essay_id').all();
  return result.results;
}
async function insertRevision(env, row, id, payload, archived) {
  const revision = row ? row.revision + 1 : 1;
  let result;
  try {
    result = await sql(env,
      'INSERT INTO essay_revisions (essay_id, revision, payload, archived) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
      id, revision, JSON.stringify(payload), Number(archived)).run();
  } catch (error) { console.error('Essay revision insert failed', error.name); throw error; }
  expect(result.meta.changes === 1, '这篇作文已有新版本，请刷新后重试。', 409);
  return sql(env, 'SELECT * FROM essay_revisions WHERE essay_id = ? AND revision = ?', id, revision).first();
}
async function putEssay(env, record, expected) {
  checkRecord(record);
  const row = await current(env, record.id);
  expect(expected === undefined ? !row : row?.revision === expected,
    expected === undefined ? '该作文 ID 已存在。请使用新的 ID，或从文章页编辑。' : '作文已更新，请刷新后重试。', 409);
  const previous = row && unpack(row);
  const assets = previous?.assets ?? {};
  const savedRecord = { ...record };
  for (const key of imageFields) {
    if (!(key in record)) {
      if (previous && key in previous.record) savedRecord[key] = previous.record[key];
      continue;
    }
    if (record[key]) assets[key] = await storeImage(record[key], env);
    else delete assets[key];
    savedRecord[key] = '';
  }
  if ('draftImages' in record) {
    const images = [];
    for (const encoded of record.draftImages) images.push(await storeImage(encoded, env));
    if (images.length) assets.draftImages = images;
    else delete assets.draftImages;
    savedRecord.draftImages = [];
  } else if (previous && 'draftImages' in previous.record) {
    savedRecord.draftImages = previous.record.draftImages;
  }
  expect(new TextEncoder().encode(JSON.stringify(savedRecord)).length <= 650000, '作文文本过长。', 413);
  return insertRevision(env, row, record.id, { record: savedRecord, assets }, row?.archived || 0);
}
async function exportRecord(env, row) {
  const { record, assets } = unpack(row);
  const encode = async asset => {
    const blob = await env.BUCKET.get(asset.key);
    expect(blob, '备份所需的原图缺失。', 500);
    return 'data:' + asset.mime + ';base64,' + toBase64(new Uint8Array(await blob.arrayBuffer()));
  };
  for (const key of imageFields) {
    if (assets[key]) record[key] = await encode(assets[key]);
  }
  if (assets.draftImages) {
    record.draftImages = [];
    for (const asset of assets.draftImages) record.draftImages.push(await encode(asset));
  }
  return record;
}
async function progressRows(env, user) {
  const result = await sql(env,
    'SELECT essay_id, sentence_id, favorite, mastered FROM user_sentence_progress WHERE user_id = ?', user.id).all();
  return Object.fromEntries(result.results.map(row => [
    row.essay_id + ':' + row.sentence_id,
    { ...(row.favorite === null ? {} : { favorite: !!row.favorite }), ...(row.mastered === null ? {} : { mastered: !!row.mastered }) },
  ]));
}
function writeProgress(env, user, essay, sentence, favorite, mastered, importing) {
  const update = importing ?
    'favorite = COALESCE(user_sentence_progress.favorite,excluded.favorite), mastered = COALESCE(user_sentence_progress.mastered,excluded.mastered)' :
    'favorite = COALESCE(excluded.favorite,user_sentence_progress.favorite), mastered = COALESCE(excluded.mastered,user_sentence_progress.mastered)';
  return sql(env, 'INSERT INTO user_sentence_progress (user_id,essay_id,sentence_id,favorite,mastered) VALUES (?,?,?,?,?) ' +
    'ON CONFLICT (user_id,essay_id,sentence_id) DO UPDATE SET ' + update,
    user.id, essay, sentence, favorite === undefined ? null : Number(favorite), mastered === undefined ? null : Number(mastered));
}
function progressChanges(value) {
  if (!plain(value)) return {};
  return {
    favorite: typeof value.favorite === 'boolean' ? value.favorite :
      typeof value.fav === 'boolean' ? value.fav : undefined,
    mastered: typeof value.mastered === 'boolean' ? value.mastered :
      typeof value.known === 'boolean' ? value.known : undefined,
  };
}
function legacyKeys(essay, sentence) {
  return [essay + ':' + sentence, essay + '::' + sentence, essay + '/' + sentence,
    essay + '|' + sentence, essay + '__' + sentence, essay + '-' + sentence, essay + '_' + sentence];
}
async function importProgress(env, user, raw) {
  if (!plain(raw)) return 0;
  const rows = await sql(env, "SELECT DISTINCT e.essay_id, json_extract(s.value, '$.id') AS sentence_id FROM essay_revisions e JOIN json_each(e.payload, '$.record.sentences') s").all();
  const updates = [];
  for (const { essay_id: essay, sentence_id: sentence } of rows.results) {
    const keys = legacyKeys(essay, sentence);
    const saved = keys.map(k => raw[k]).find(plain) ?? raw[essay]?.[sentence];
    const { favorite, mastered } = progressChanges(saved);
    const fav = favorite ?? (Array.isArray(raw.favorites) && keys.some(k => raw.favorites.includes(k)) ? true : undefined);
    const done = mastered ?? (Array.isArray(raw.mastered) && keys.some(k => raw.mastered.includes(k)) ? true : undefined);
    if (fav !== undefined || done !== undefined) updates.push(writeProgress(env, user, essay, sentence, fav, done, true));
  }
  for (let start = 0; start < updates.length; start += 50) await env.DB.batch(updates.slice(start, start + 50));
  return updates.length;
}
async function importArchive(env, user, body) {
  expect(plain(body), '备份格式有误。');
  const records = body.records ?? body.essays ?? [];
  expect(Array.isArray(records) && records.length <= 120, '一次最多导入 120 篇作文。');
  const ids = new Set();
  for (const record of records) {
    checkRecord(record);
    expect(!ids.has(record.id), '备份中有重复作文 ID。');
    ids.add(record.id);
  }
  const archived = new Set(Array.isArray(body.archivedIds) ? body.archivedIds : []);
  const inserted = [], skipped = [];
  for (const record of records) {
    if (await current(env, record.id)) { skipped.push(record.id); continue; }
    let row;
    try { row = await putEssay(env, record); }
    catch (error) {
      if (error.status !== 409) throw error;
      skipped.push(record.id);
      continue;
    }
    if (archived.has(record.id)) await insertRevision(env, row, record.id, unpack(row), true);
    inserted.push(record.id);
  }
  const progress = await importProgress(env, user, {
    favorites: body.favorites, mastered: body.mastered, ...body.userProgress,
  });
  return { inserted, skipped, progress };
}

const mcpTools = [
  {
    name: 'list_english2_essays',
    description: '列出研写档案中的英语二作文。可按年份、分类或关键词检索。返回稳定 ID、标题、版本和所在网页路径。',
    inputSchema: { type: 'object', properties: {
      year: { type: 'string' }, type: { enum: ['large', 'small', 'review'] }, keyword: { type: 'string' },
    }, additionalProperties: false },
  },
  {
    name: 'get_english2_essay',
    description: '读取一篇作文的题干、原稿转录、批改、范文、翻译、句型和来源。适用于复查已有作文。',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'add_english2_essay',
    description: '将已经完成的英语二作文批改写入研写档案。新练习必须用新的稳定 ID。保存完成后刷新网站可见。初稿须保留手写错误及存疑标记，缺失材料留空。',
    inputSchema: {
      type: 'object', required: ['record'], additionalProperties: false,
      properties: { record: { type: 'object', required: ['id', 'title'], additionalProperties: false, properties: {
        id: { type: 'string', description: '如 e2-2024-48-practice2，重试请保持相同 ID' },
        title: { type: 'string' }, year: { type: 'string' }, type: { enum: ['large', 'small', 'review'] },
        ...Object.fromEntries(textFields.map(name => [name, { type: 'string' }])),
        ...Object.fromEntries(listFields.map(name => [name, { type: 'array', items: { type: 'string' } }])),
        chartType: { enum: ['line', 'vertical', 'horizontal', ''] },
        chart: { type: 'array', items: { type: 'object', required: ['label', 'value'], properties: {
          label: { type: 'string' }, value: { type: 'number' },
        } } },
        chartOptions: { type: 'object', properties: {
          ticks: { type: 'array', items: { type: 'number' } }, axisDecimals: { type: 'integer' },
          valueDecimals: { type: 'integer' }, title: { type: 'string' }, ylabel: { type: 'string' },
        } },
        ...Object.fromEntries(imageFields.map(name => [name, {
          type: 'string', description: '原始 JPG、PNG 或 WebP 图片的完整 data URL。不能读取图片字节时留空。',
        }])),
        draftImages: { type: 'array', maxItems: draftImageLimit, items: { type: 'string' },
          description: '按页序保存的 JPG、PNG 或 WebP 原始图片 data URL。' },
        ...Object.fromEntries(Object.entries(nestedFields).map(([name, fields]) => [name, {
          type: 'array', items: { type: 'object', properties: Object.fromEntries(fields.map(field => [field,
            field === 'points' ? { type: 'array', items: { type: 'string' } } :
            { type: field === 'required' ? 'boolean' : 'string' }])) },
        }])),
      } } },
    },
  },
];
async function mcp(request, env, user) {
  const { id, method, params } = await readBody(request);
  const respond = result => json({ jsonrpc: '2.0', id: id ?? null, result });
  const rpcError = (code, message) => json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (method === 'server/discover') return respond({ supportedVersions: ['2026-07-28'], capabilities: { tools: {} },
    serverInfo: { name: 'yanxie-english2', version: '1.0.0' } });
  if (method === 'initialize') return respond({ protocolVersion: '2026-07-28', capabilities: { tools: {} },
    serverInfo: { name: 'yanxie-english2', version: '1.0.0' } });
  if (method === 'notifications/initialized') return new Response(null, { status: 202 });
  if (method === 'ping') return respond({});
  if (method === 'tools/list') return respond({ tools: mcpTools });
  if (method !== 'tools/call') return rpcError(-32601, 'Method not found');
  if (!user) return rpcError(-32001, '请使用网站所有者的 ChatGPT 账号。');
  const args = params?.arguments ?? {};
  const asText = (value, isError = false) => respond({ isError, content: [{ type: 'text', text: JSON.stringify(value) }] });
  try {
    if (params.name === 'list_english2_essays') {
      const rows = await dbEssays(env);
      const keyword = typeof args.keyword === 'string' ? args.keyword.toLowerCase() : '';
      return asText(rows.filter(r => !r.archived && (!keyword || r.payload.toLowerCase().includes(keyword)))
        .map(visibleEssay).filter(({ record, type }) => (!args.year || record.year === args.year) && (!args.type || type === args.type))
        .map(({ record, version, type }) => ({ id: record.id, year: record.year, title: record.title, version, type, path: '/essays/' + record.id })));
    }
    if (params.name === 'get_english2_essay') {
      expect(validId(args.id), '作文 ID 无效。');
      const row = await current(env, args.id);
      expect(row, '未找到这篇作文。', 404);
      return asText(visibleEssay(row));
    }
    if (params.name === 'add_english2_essay') {
      const row = await putEssay(env, args.record);
      return asText({ id: row.essay_id, version: row.revision, path: '/essays/' + row.essay_id });
    }
    return rpcError(-32602, 'Unknown tool');
  } catch (error) {
    return asText({ error: error instanceof Problem ? error.message : '保存或读取失败，请稍后重试。' }, true);
  }
}

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const user = await identity(request, env);
  if (path === '/mcp' && method === 'POST') {
    // Tool metadata contains no archive content. Every tool invocation requires the owner.
    return mcp(request, env, user);
  }
  if (!user) return path.startsWith('/api/') || path === '/mcp'
    ? json({ error: '请使用网站所有者的 ChatGPT 账号登录。' }, 401)
    : new Response('此写作档案仅向所有者开放。', { status: 403, headers: {
      ...privateHeaders, 'Content-Type': 'text/plain; charset=utf-8',
    } });
  if (method === 'GET' && (path === '/' || path === '/app.js' || path === '/styles.css' ||
    /^\/(?:sentences|manage|essays(?:\/[a-zA-Z0-9_-]+)?)\/?$/.test(path))) {
    const asset = webAssets[path] ?? webAssets['/'];
    return new Response(asset.body, { headers: { ...privateHeaders, 'Content-Type': asset.mime } });
  }
  if (!['GET', 'HEAD'].includes(method)) sameOrigin(request, user);
  if (path === '/api/library' && method === 'GET') {
    const [rows, progress] = await Promise.all([dbEssays(env), progressRows(env, user)]);
    return json({ essays: rows.map(visibleEssay), progress });
  }
  if (path === '/api/backup' && method === 'GET') {
    const rows = await dbEssays(env);
    const records = [];
    for (const row of rows) records.push(await exportRecord(env, row));
    return json({ format: 'yanxie-english2-v1', exportedAt: new Date().toISOString(),
      records, archivedIds: rows.filter(row => row.archived).map(row => row.essay_id), userProgress: await progressRows(env, user) });
  }
  if (path === '/api/backup' && method === 'POST') return json(await importArchive(env, user, await readBody(request)));
  if (path.startsWith('/api/images/') && method === 'GET') {
    const key = path.slice('/api/images/'.length);
    expect(hashPattern.test(key), '找不到该图片。', 404);
    const object = await env.BUCKET.get(key);
    expect(object, '找不到该图片。', 404);
    return new Response(object.body, { headers: { ...privateHeaders,
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
    } });
  }
  if (path === '/api/essays' && method === 'POST') {
    const body = await readBody(request);
    return json(visibleEssay(await putEssay(env, body.record)), 201);
  }
  const essay = /^\/api\/essays\/([a-zA-Z0-9_-]+)(?:\/(history|archive|restore))?$/.exec(path);
  if (essay && validId(essay[1])) {
    const [, id, action] = essay;
    const row = await current(env, id);
    expect(row, '未找到这篇作文。', 404);
    if (!action && method === 'GET') return json(visibleEssay(row));
    if (!action && method === 'PUT') {
      const body = await readBody(request);
      expect(body.record?.id === id && Number.isInteger(body.version), '请提供当前版本与原作文 ID。');
      return json(visibleEssay(await putEssay(env, body.record, body.version)));
    }
    if (action === 'history' && method === 'GET') {
      if (url.searchParams.has('version')) {
        const previous = await sql(env, 'SELECT * FROM essay_revisions WHERE essay_id = ? AND revision = ?',
          id, Number(url.searchParams.get('version'))).first();
        expect(previous, '版本不存在。', 404);
        return json(visibleEssay(previous));
      }
      const result = await sql(env,
        'SELECT revision, archived, saved_at FROM essay_revisions WHERE essay_id = ? ORDER BY revision DESC', id).all();
      return json(result.results);
    }
    if ((action === 'archive' || action === 'restore') && method === 'POST') {
      const body = await readBody(request);
      expect(row.revision === body.version, '作文已更新，请刷新后重试。', 409);
      const archived = action === 'archive';
      return json(visibleEssay(Boolean(row.archived) === archived ? row :
        await insertRevision(env, row, id, unpack(row), archived)));
    }
    // Only the migration service can remove its synthetic test record and test account markers.
    if (!action && method === 'DELETE' && user.service && id.startsWith('qa-')) {
      await env.DB.batch([
        sql(env, 'DELETE FROM essay_revisions WHERE essay_id = ?', id),
        sql(env, 'DELETE FROM user_sentence_progress WHERE user_id = ?', user.id),
      ]);
      return json({ removed: id });
    }
  }
  if (path === '/api/progress' && method === 'PATCH') {
    const body = await readBody(request, 16384);
    expect(validId(body.essayId) && validId(body.sentenceId), '句型 ID 无效。');
    const { favorite, mastered } = progressChanges(body);
    expect(favorite !== undefined || mastered !== undefined, '请选择收藏或掌握状态。');
    const row = await sql(env, 'SELECT sentence_id FROM essay_sentences WHERE essay_id = ? AND sentence_id = ?',
      body.essayId, body.sentenceId).first();
    expect(row, '句型不存在或该作文已归档。', 404);
    await writeProgress(env, user, body.essayId, body.sentenceId, favorite, mastered, false).run();
    return json({ saved: true });
  }
  return json({ error: '页面或功能不存在。' }, 404);
}

export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch (error) {
      if (error instanceof Problem) return json({ error: error.message }, error.status);
      console.error('Request failed:', new URL(request.url).pathname, error.name, error.message);
      return json({ error: '数据暂时不可用，请稍后刷新重试。' }, 500);
    }
  },
};

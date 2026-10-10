#!/usr/bin/env node
// ts_evidence.cjs — يستخرج حقائق حالات it()/test() من ملفات الاختبار بمحلل TypeScript الفعلي
// (CLM-0521 · CLM-0523 · الحارس 28 · ADR-069 §2.8/§7.2).
//
// المدخل: مسارات ملفات (argv). المخرج (stdout): JSON
//   { ok: true, files: { <path>: { error?, cases: [CaseFacts] } } }
// أو { ok: false, error } إن تعذّر تحميل typescript — والحارس يفشل مغلقًا عندها.
//
// الحقائق تُستخرج من **جسم الحالة نفسها** فقط (مع حل ثوابت `const` في الحالة ثم في الوحدة)،
// فلا يُحسب تعليق ولا سلسلة نصية ولا اختبار آخر في الملف. الحارس (Python) يطبّق القواعد.

"use strict";
const fs = require("node:fs");
const path = require("node:path");

let ts;
try {
  ts = require("typescript");
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: `typescript غير متاح: ${e.message}` }));
  process.exit(0);
}

const IDENTITY_KEY = /^(obo|onBehalfOf\w*|session\w*|authorization|actor\w*|endUser\w*)$/i;
const STATUS_PROPS = new Set(["statusCode", "status"]);
const EQ_MATCHERS = new Set(["toBe", "toEqual", "toStrictEqual"]);

function unwrap(n) {
  while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isAwaitExpression(n) ||
               ts.isNonNullExpression(n) || ts.isTypeAssertionExpression?.(n) || ts.isSatisfiesExpression?.(n))) {
    n = n.expression;
  }
  return n;
}

function propName(p) {
  if (!p.name) return null;
  if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) return p.name.text;
  if (ts.isComputedPropertyName(p.name) && ts.isIdentifier(p.name.expression)) return `[${p.name.expression.text}]`;
  return null;
}

function collectConsts(root, into) {
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      into.set(n.name.text, n.initializer);
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
}

function chainOf(callee) {
  // it / it.skip / it.skipIf(c) / describe.each(...)  ⇒ { base, mods[] }
  const mods = [];
  let n = callee;
  for (;;) {
    if (ts.isCallExpression(n)) { n = n.expression; continue; }
    if (ts.isPropertyAccessExpression(n)) { mods.unshift(n.name.text); n = n.expression; continue; }
    break;
  }
  return { base: ts.isIdentifier(n) ? n.text : null, mods };
}

function analyzeFile(file) {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const moduleConsts = new Map();
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer) moduleConsts.set(d.name.text, d.initializer);
    }
  }
  const cases = [];
  const visit = (n, ancestors) => {
    if (ts.isCallExpression(n)) {
      const { base, mods } = chainOf(n.expression);
      const a0 = n.arguments[0];
      const fn = n.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
      if ((base === "it" || base === "test") && a0 && (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0))) {
        const all = [...mods, ...ancestors.flat()];
        cases.push(caseFacts(a0.text, mods, all, fn, moduleConsts, sf));
      }
      if (base === "describe" && fn) {
        visit_children(n, [...ancestors, mods]);
        return;
      }
    }
    visit_children(n, ancestors);
  };
  const visit_children = (n, anc) => ts.forEachChild(n, (c) => visit(c, anc));
  visit(sf, []);
  return { cases };
}

function caseFacts(title, ownMods, allMods, fn, moduleConsts, sf) {
  const dead = allMods.some((m) => m === "skip" || m === "todo");
  const conditional = allMods.some((m) => m === "skipIf" || m === "runIf" || m === "each");
  const facts = { title, live: !!fn && !dead && !conditional, dead, conditional, mods: allMods,
                  has_body: !!fn, mode_off: false, requests: [], expects: [] };
  if (!fn) return facts;
  const body = fn.body;
  const local = new Map();
  collectConsts(body, local);
  const resolve = (n, depth = 0) => {
    n = unwrap(n);
    if (n && ts.isIdentifier(n) && depth < 8) {
      const init = local.get(n.text) ?? moduleConsts.get(n.text);
      if (init) return resolve(init, depth + 1);
    }
    return n;
  };
  // معرّفات ونصوص شجرة بعد حل الثوابت (لمقارنة الهويات).
  const idsLits = (n, out = { ids: new Set(), lits: new Set() }, depth = 0) => {
    if (!n || depth > 8) return out;
    n = unwrap(n);
    if (ts.isIdentifier(n)) {
      out.ids.add(n.text);
      const init = local.get(n.text) ?? moduleConsts.get(n.text);
      if (init) idsLits(init, out, depth + 1);
      return out;
    }
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) { out.lits.add(n.text); return out; }
    ts.forEachChild(n, (c) => idsLits(c, out, depth));
    return out;
  };
  const pack = (n) => { const r = idsLits(n); return { ids: [...r.ids], lits: [...r.lits], text: n.getText(sf) }; };

  // url ⇒ أجزاء: نص حرفي أو موضع { ids, lits, text }
  const flatten = (n, depth = 0) => {
    const r = resolve(n);
    if (!r || depth > 8) return [{ hole: pack(n) }];
    if (ts.isStringLiteral(r) || ts.isNoSubstitutionTemplateLiteral(r)) return [{ lit: r.text }];
    if (ts.isTemplateExpression(r)) {
      const out = [{ lit: r.head.text }];
      for (const sp of r.templateSpans) {
        const inner = resolve(sp.expression);
        if (inner && (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner) || ts.isTemplateExpression(inner))) {
          out.push(...flatten(sp.expression, depth + 1));
        } else {
          out.push({ hole: pack(sp.expression) });
        }
        out.push({ lit: sp.literal.text });
      }
      return out;
    }
    if (ts.isBinaryExpression(r) && r.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return [...flatten(r.left, depth + 1), ...flatten(r.right, depth + 1)];
    }
    return [{ hole: pack(n) }];
  };

  const objProps = (n) => {
    const r = resolve(n);
    return r && ts.isObjectLiteralExpression(r) ? r.properties : null;
  };
  // كل خاصية تحمل هوية جلسة داخل الترويسات (عبر وسائط الدوال والكائنات والثوابت).
  const identityProps = (n, out = [], depth = 0) => {
    if (!n || depth > 6) return out;
    const r = resolve(n);
    if (!r) return out;
    if (ts.isObjectLiteralExpression(r)) {
      for (const p of r.properties) {
        const k = propName(p);
        if (ts.isPropertyAssignment(p) && k && IDENTITY_KEY.test(k)) out.push({ key: k, ...pack(p.initializer) });
        else if (ts.isShorthandPropertyAssignment(p) && IDENTITY_KEY.test(p.name.text)) out.push({ key: p.name.text, ...pack(p.name) });
        else if (ts.isPropertyAssignment(p)) identityProps(p.initializer, out, depth + 1);
      }
    } else if (ts.isCallExpression(r)) {
      for (const a of r.arguments) identityProps(a, out, depth + 1);
    }
    return out;
  };
  const payloadFields = (n, out = [], depth = 0) => {
    if (!n || depth > 4) return out;
    const r = resolve(n);
    if (!r) return out;
    if (ts.isObjectLiteralExpression(r)) {
      for (const p of r.properties) {
        const k = propName(p);
        if (ts.isPropertyAssignment(p) && k) { out.push({ key: k, ...pack(p.initializer) }); payloadFields(p.initializer, out, depth + 1); }
        else if (ts.isShorthandPropertyAssignment(p)) out.push({ key: p.name.text, ...pack(p.name) });
      }
    } else if (ts.isCallExpression(r)) {
      for (const a of r.arguments) payloadFields(a, out, depth + 1);
    }
    return out;
  };

  // متغير الحلقة ⇒ قيم مصفوفة حرفية (for (const q of [...]))
  const loopValues = (node) => {
    const vals = {};
    for (let p = node.parent; p && p !== body.parent; p = p.parent) {
      if (ts.isForOfStatement(p) && ts.isVariableDeclarationList(p.initializer)) {
        const d = p.initializer.declarations[0];
        const arr = resolve(p.expression);
        if (d && ts.isIdentifier(d.name) && arr && ts.isArrayLiteralExpression(arr)) {
          vals[d.name.text] = arr.elements.map((e) => {
            const r = resolve(e);
            return r && (ts.isStringLiteral(r) || ts.isNoSubstitutionTemplateLiteral(r)) ? r.text : null;
          });
        }
      }
    }
    return vals;
  };

  const resVarOf = (call) => {
    let p = call.parent;
    while (p && (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p) || ts.isAsExpression(p))) p = p.parent;
    return p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) ? p.name.text : null;
  };

  const walk = (n) => {
    // المستقبل off داخل الحالة: process.env.WASLA_USER_ASSERTION_MODE = "off" أو { WASLA_USER_ASSERTION_MODE: "off" }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const l = n.left, r = resolve(n.right);
      const lname = ts.isPropertyAccessExpression(l) ? l.name.text :
        ts.isElementAccessExpression(l) && ts.isStringLiteral(l.argumentExpression) ? l.argumentExpression.text :
        ts.isElementAccessExpression(l) && ts.isIdentifier(l.argumentExpression) ? `[${l.argumentExpression.text}]` : null;
      if ((lname === "WASLA_USER_ASSERTION_MODE" || lname === "[USER_ASSERTION_MODE_ENV]") && r && ts.isStringLiteral(r) && r.text === "off") facts.mode_off = true;
    }
    if (ts.isPropertyAssignment(n)) {
      const k = propName(n), r = resolve(n.initializer);
      if ((k === "WASLA_USER_ASSERTION_MODE" || k === "[USER_ASSERTION_MODE_ENV]") && r && ts.isStringLiteral(r) && r.text === "off") facts.mode_off = true;
    }
    if (ts.isCallExpression(n)) {
      // طلب: fn({ url, method?, headers?, payload|body? })
      const props = n.arguments[0] ? objProps(n.arguments[0]) : null;
      const urlP = props && props.find((p) => ts.isPropertyAssignment(p) && propName(p) === "url");
      if (urlP) {
        const get = (k) => props.find((p) => ts.isPropertyAssignment(p) && propName(p) === k);
        const m = get("method") && resolve(get("method").initializer);
        const headers = get("headers");
        const payload = get("payload") || get("body");
        const query = get("query");
        facts.requests.push({
          method: m && ts.isStringLiteral(m) ? m.text.toUpperCase() : (get("method") ? null : "GET"),
          url: flatten(urlP.initializer),
          loop: loopValues(n),
          identity: headers ? identityProps(headers.initializer) : [],
          payload: payload ? payloadFields(payload.initializer) : [],
          query_keys: query && objProps(query.initializer) ? objProps(query.initializer).map(propName).filter(Boolean) : [],
          res: resVarOf(n),
          statuses: [],
          pos: n.getStart(sf),
        });
      }
      // expect(X).[not.]matcher(Y)
      if (ts.isPropertyAccessExpression(n.expression)) {
        const matcher = n.expression.name.text;
        let e = n.expression.expression, negated = false;
        if (ts.isPropertyAccessExpression(e) && e.name.text === "not") { negated = true; e = e.expression; }
        if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "expect" && e.arguments[0]) {
          const arg = e.arguments[0];
          const raw = { ids: new Set(), strs: new Set(), props: new Set() };
          const scan = (x) => {
            if (ts.isIdentifier(x)) raw.ids.add(x.text);
            if (ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x)) raw.strs.add(x.text);
            if (ts.isPropertyAccessExpression(x)) raw.props.add(x.name.text);
            ts.forEachChild(x, scan);
          };
          scan(arg);
          const a = unwrap(arg);
          const exp = n.arguments[0];
          const expR = exp ? resolve(exp) : null;
          facts.expects.push({
            matcher, negated,
            status_of: ts.isPropertyAccessExpression(a) && STATUS_PROPS.has(a.name.text) && ts.isIdentifier(a.expression) ? a.expression.text : null,
            expected_num: expR && ts.isNumericLiteral(expR) ? Number(expR.text) : null,
            expected_bool: expR && (expR.kind === ts.SyntaxKind.TrueKeyword) ? true : expR && expR.kind === ts.SyntaxKind.FalseKeyword ? false : null,
            expected: exp ? pack(exp) : null,
            arg_ids: [...raw.ids], arg_strs: [...raw.strs], arg_props: [...raw.props],
            pos: n.getStart(sf),
          });
        }
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(body);

  // ربط الحالات بالطلب: expect(res.statusCode).toBe(n) — المتغير نفسه في الحالة نفسها.
  for (const r of facts.requests) {
    if (!r.res) continue;
    for (const x of facts.expects) {
      if (x.status_of === r.res && EQ_MATCHERS.has(x.matcher) && !x.negated && x.expected_num !== null) r.statuses.push(x.expected_num);
    }
  }
  // المشتقات من نتيجة الطلب: res ثم كل const يعتمد عليه (نقطة ثابتة).
  const derived = new Set(facts.requests.map((r) => r.res).filter(Boolean));
  let grew = true;
  while (grew) {
    grew = false;
    for (const [k, init] of local) {
      if (derived.has(k)) continue;
      const s = idsLits(init);
      // لا نتبع حل الثوابت هنا: نريد الاعتماد المباشر على متغير النتيجة.
      const direct = new Set();
      const sc = (x) => { if (ts.isIdentifier(x)) direct.add(x.text); ts.forEachChild(x, sc); };
      sc(init);
      if ([...direct].some((i) => derived.has(i))) { derived.add(k); grew = true; }
    }
  }
  facts.derived = [...derived];
  for (const x of facts.expects) x.on_result = x.arg_ids.some((i) => derived.has(i));
  return facts;
}

const out = { ok: true, files: {} };
for (const f of process.argv.slice(2)) {
  try {
    out.files[f] = analyzeFile(f);
  } catch (e) {
    out.files[f] = { error: String(e && e.message || e), cases: [] };
  }
}
process.stdout.write(JSON.stringify(out));

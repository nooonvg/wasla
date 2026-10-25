# gov-cases-xr-domain-freeze.sh — حالاتُ خرقٍ مزروعٍ للحارس 29 (xr-domain-freeze · ADR-076 · XR-1 · M0-54).
#
# تُستدعى من `scripts/checks/test-governance.sh`. كلُّ حالةٍ تبني مستودعَ git صناعيًّا في
# mktemp، وتنسخُ إليهِ الحارسَ وقائمةَ المساراتِ الحقيقيَّين، وتزرعُ إيداعًا ثمَّ تُشغِّلُ
# الحارسَ على النطاقِ main..HEAD. والحالةُ الرافضةُ تُطابِقُ سببَ الرفضِ (`[XR-FREEZE]`
# والمسارَ بعينِه) لا رمزَ الخروجِ وحدَه، والموجبةُ تُثبِتُ أنّ الحارسَ ليسَ جدارًا أعمى.
#
# المرجع: docs/ecosystem/ECOSYSTEM_ROADMAP.md §4 (XR-1) · ADR-076

printf '\n\033[1m[XR] تجميدُ مجالِ MOVE ومجالاتِ CORE (ADR-076 · XR-1 · الحارسُ 29)\033[0m\n'

_xr_repo() { # _xr_repo → يطبعُ مسارَ مستودعٍ صناعيٍّ على main
  local d
  d="$(mktemp -d)"
  mkdir -p "$d/scripts/checks/lib" "$d/services/dispatch/src" "$d/services/delivery/src/domain" \
    "$d/services/delivery/src/use-cases" "$d/services/marketplace/src" "$d/services/identity/src"
  cp "$REPO_ROOT/scripts/checks/validate-xr-domain-freeze.sh" "$d/scripts/checks/"
  cp "$REPO_ROOT/scripts/checks/lib/xr-frozen-paths.sh" "$d/scripts/checks/lib/"
  cp "$REPO_ROOT/scripts/checks/lib/xr-freeze-exceptions.sh" "$d/scripts/checks/lib/"
  # السجلُ الحقيقيُّ فارغٌ — آليّةُ الاستثناءِ تُختبرُ باستثناءٍ تركيبيٍّ مزروعٍ في
  # المستودعِ الصناعيِّ وحدَه، لا باستثناءٍ حيٍّ في الحقيقيِّ.
  printf 'XR_FREEZE_EXCEPTIONS=("SELFTEST-0701|services/identity/")\n' > "$d/scripts/checks/lib/xr-freeze-exceptions.sh"
  printf 'export const a = 1;\n' > "$d/services/dispatch/src/a.ts"
  printf 'export const s = 1;\n' > "$d/services/delivery/src/domain/store-order.ts"
  printf 'export const g = 1;\n' > "$d/services/delivery/src/use-cases/delegate-to-dispatch.ts"
  printf 'export const m = 1;\n' > "$d/services/marketplace/src/m.ts"
  printf 'export const i = 1;\n' > "$d/services/identity/src/i.ts"
  ( cd "$d" && git init -q -b main && git add -A \
    && git -c user.email=t@t -c user.name=t commit -qm "base" && git checkout -q -b work )
  printf '%s' "$d"
}

_xr_commit() { # _xr_commit <repo> <message> <cmd…>
  local d="$1" msg="$2"; shift 2
  ( cd "$d" && "$@" && git add -A && git -c user.email=t@t -c user.name=t commit -qm "$msg" )
}

_xr_run() { # _xr_run <repo> → الحارسُ على main..HEAD
  bash "$1/scripts/checks/validate-xr-domain-freeze.sh" main HEAD
}

_xr_reject() { # _xr_reject <repo> <path> — يرفضُ ويُسمّي المسارَ بسببِ التجميدِ
  local out
  out="$(_xr_run "$1" 2>&1)" && { printf '%s\n' "$out"; return 1; }
  [[ "$out" == *"[XR-FREEZE]"*"$2"* ]] || { printf '%s\n' "$out"; return 1; }
  return 0
}

XR_D="$(_xr_repo)"
_xr_commit "$XR_D" "feat: planted breach" sh -c 'echo "// x" >> services/dispatch/src/a.ts'
t "خرقٌ مزروعٌ: تعديلُ services/dispatch بلا وسمٍ يُرفَض" pass _xr_reject "$XR_D" "services/dispatch/src/a.ts"
rm -rf "$XR_D"

XR_D="$(_xr_repo)"
_xr_commit "$XR_D" "feat: new driver flow" sh -c 'mkdir -p bots/driver-bot/src && echo x > bots/driver-bot/src/n.ts'
t "خرقٌ مزروعٌ: إضافةٌ في bots/driver-bot تُرفَض" pass _xr_reject "$XR_D" "bots/driver-bot/src/n.ts"
rm -rf "$XR_D"

XR_D="$(_xr_repo)"
_xr_commit "$XR_D" "fix: retry" sh -c 'echo "// x" >> services/delivery/src/use-cases/delegate-to-dispatch.ts'
t "خرقٌ مزروعٌ: ساقُ delivery_task → dispatch تُرفَض" pass _xr_reject "$XR_D" "services/delivery/src/use-cases/delegate-to-dispatch.ts"
rm -rf "$XR_D"

XR_D="$(_xr_repo)"
_xr_commit "$XR_D" "fix: SECURITY patch" sh -c 'echo "// a" >> services/identity/src/i.ts'
_xr_commit "$XR_D" "feat: sneak" sh -c 'echo "// b" >> services/dispatch/src/a.ts'
t "وسمُ SECURITY في إيداعٍ لا يُعفي إيداعًا آخرَ" pass _xr_reject "$XR_D" "services/dispatch/src/a.ts"
rm -rf "$XR_D"

XR_D="$(_xr_repo)"
_xr_commit "$XR_D" "chore: XR-RETIRE unwire dispatch" sh -c 'echo "// x" >> services/dispatch/src/a.ts'
t "إيداعٌ موسومٌ XR-RETIRE يمرّ" pass _xr_run "$XR_D"
rm -rf "$XR_D"

XR_D="$(_xr_repo)"
_xr_commit "$XR_D" "chore: remove dispatch" git rm -q services/dispatch/src/a.ts
t "حذفُ ملفٍّ مجمَّدٍ (XR-5) يمرّ" pass _xr_run "$XR_D"
rm -rf "$XR_D"

XR_D="$(_xr_repo)"
_xr_commit "$XR_D" "feat: store order" sh -c 'echo "// x" >> services/delivery/src/domain/store-order.ts && echo "// y" >> services/marketplace/src/m.ts'
t "store_order وservices/marketplace مفتوحانِ" pass _xr_run "$XR_D"
rm -rf "$XR_D"

XR_D="$(_xr_repo)"
_xr_commit "$XR_D" "feat: SELFTEST-0701 XR-EX-SELFTEST-0701" sh -c 'echo "// lifecycle" >> services/identity/src/i.ts'
t "الاستثناءُ التركيبيُّ المزروعُ (XR-EX-SELFTEST-0701 · services/identity) يمرّ لمسارِهِ هو" pass _xr_run "$XR_D"
rm -rf "$XR_D"

XR_D="$(_xr_repo)"
_xr_commit "$XR_D" "feat: XR-EX-SELFTEST-0701" sh -c 'echo "// x" >> services/dispatch/src/a.ts'
t "وسمُ الاستثناءِ لا يفتحُ مجالاً مجمَّداً آخرَ (services/dispatch)" pass _xr_reject "$XR_D" "services/dispatch/src/a.ts"
rm -rf "$XR_D"

XR_D="$(_xr_repo)"
_xr_commit "$XR_D" "feat: SELFTEST-0701 lifecycle" sh -c 'echo "// lifecycle" >> services/identity/src/i.ts'
t "بلا وسمِ XR-EX- يبقى services/identity مجمَّداً" pass _xr_reject "$XR_D" "services/identity/src/i.ts"
rm -rf "$XR_D"

XR_D="$(_xr_repo)"
t "مرجعٌ لا يُحَلُّ يُرفَض (fail-closed)" fail bash "$XR_D/scripts/checks/validate-xr-domain-freeze.sh" no-such-ref HEAD
rm -rf "$XR_D"
unset XR_D

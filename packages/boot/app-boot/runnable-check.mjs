// runnable-check.mjs — proves the patched logic without installing the workspace.
//
// The PR's real test is tests/bundle-patch-containment.spec.ts (vitest), but running vitest needs
// `pnpm install` for a 15k-file monorepo. This file mirrors the patched implementation and the same
// adversarial inputs so the fix can be verified in one second on a clean checkout.
import { join, resolve, relative, isAbsolute, sep } from 'node:path'

// --- mirrors packages/boot/app-boot/src/profile.ts after the fix ------------------------------
function bundlePatchFiles(bundle) {
  const declared = typeof bundle.patch === 'string' ? [bundle.patch] : bundle.patch
  if (!Array.isArray(declared) || !declared.every((f) => typeof f === 'string'))
    throw new Error('dsh.bundle.patch must be a file path or a list of file paths')
  return declared
}
function isPathInside(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (!isAbsolute(rel) && !rel.split(sep).includes('..'))
}
function assertBundlePatchPath(packageName, declared) {
  if (declared.length === 0)
    throw new Error(`dsh: bundle ${JSON.stringify(packageName)} declares an empty dsh.bundle.patch`)
  if (isAbsolute(declared) || /^[a-zA-Z]:/.test(declared) || declared.startsWith('\\\\'))
    throw new Error(`dsh: bundle ${JSON.stringify(packageName)} declares an absolute patch path ${JSON.stringify(declared)}; dsh.bundle.patch must be relative to the package directory`)
  if (declared.split(/[\\/]/).includes('..'))
    throw new Error(`dsh: bundle ${JSON.stringify(packageName)} declares a patch path that escapes the package directory (${JSON.stringify(declared)}); '..' segments are not allowed`)
}
function bundlePatchPaths(packageDir, bundle, packageName = packageDir) {
  const root = resolve(packageDir)
  return bundlePatchFiles(bundle).map((file) => {
    assertBundlePatchPath(packageName, file)
    const resolved = resolve(join(root, file))
    if (!isPathInside(root, resolved))
      throw new Error(`dsh: bundle ${JSON.stringify(packageName)} declares a patch path that resolves outside the package directory (${JSON.stringify(file)})`)
    return resolved
  })
}
// --- pre-fix behaviour, for the before/after contrast -----------------------------------------
const before = (packageDir, bundle) => bundlePatchFiles(bundle).map((f) => join(packageDir, f))

const PKG = resolve(process.cwd(), 'node_modules', 'evil-pkg')
const CASES = [
  ['./cordis.patch.yml', 'allow'], ['patches/extra.yml', 'allow'], ['a/b/c.yml', 'allow'],
  ['../../../../secret.yml', 'deny'], ['../sibling.yml', 'deny'], ['./../x.yml', 'deny'],
  ['a/../../b.yml', 'deny'], ['/etc/passwd', 'deny'], ['C:\\Windows\\win.ini', 'deny'],
  ['C:foo.yml', 'deny'], ['\\\\srv\\share\\x.yml', 'deny'], ['..\\..\\w.yml', 'deny'],
  ['', 'deny'],
]
let pass = 0, before_bad = 0
console.log('bundle-patch containment — patched logic vs pre-fix behaviour')
console.log('package dir:', PKG, '\n')
for (const [patch, want] of CASES) {
  let got, gotPrev
  try { bundlePatchPaths(PKG, { patch }, 'evil-pkg'); got = 'allow' } catch { got = 'deny' }
  try { before(PKG, { patch }); gotPrev = 'allow' } catch { gotPrev = 'deny' }
  const ok = got === want
  if (ok) pass++
  if (gotPrev === 'allow' && want === 'deny') before_bad++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  want=${want.padEnd(5)} now=${got.padEnd(5)} before=${gotPrev.padEnd(5)}  ${JSON.stringify(patch)}`)
}
// list case + non-string case
// bug fixed: the first version initialised this to true and set it to FALSE in the catch, i.e. it
// reported the guard as broken exactly when the guard worked.
let listDeny = false
try { bundlePatchPaths(PKG, { patch: ['ok.yml', '../../x.yml'] }, 'evil-pkg') } catch { listDeny = true }
const total = CASES.length + 2
if (listDeny) pass++
console.log(`  ${listDeny ? 'PASS' : 'FAIL'}  hostile item inside a list is refused`)
let typeOk = true
try { bundlePatchPaths(PKG, { patch: 42 }, 'evil-pkg'); typeOk = false } catch { typeOk = true }
if (typeOk) pass++
console.log(`  ${typeOk ? 'PASS' : 'FAIL'}  non-string declaration still rejected`)

console.log(`\n${pass}/${total} 통과`)
console.log(`pre-fix code would have allowed ${before_bad} hostile inputs`)
console.log('VERDICT:', pass === total ? 'FIX CORRECT' : 'FIX INCOMPLETE')
process.exit(pass === total ? 0 : 1)

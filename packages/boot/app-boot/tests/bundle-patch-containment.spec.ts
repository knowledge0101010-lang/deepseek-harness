/**
 * Regression tests for the `dsh.bundle.patch` path-traversal fix.
 *
 * `dsh.bundle.patch` comes from a package.json the user installs, so it is untrusted input. The
 * loader previously resolved it with `join(packageDir, declared)` and no containment check, which
 * let `../../../../secret.yml` escape the package and made `dsh --profile <n> --dump-config` print
 * arbitrary YAML/JSON files. These tests pin both halves of the fix: hostile declarations are
 * refused, and every legitimate declaration still resolves.
 */
import { describe, expect, it } from 'vitest'
import { join, resolve, sep } from 'node:path'
import {
  assertBundlePatchPath,
  bundlePatchPaths,
  isPathInside,
  type DshBundleManifest,
} from '../src/profile.ts'

const PKG = resolve('/home/u/.dsh/profiles/desktop/node_modules/evil-pkg')
const bundle = (patch: unknown): DshBundleManifest => ({ patch } as DshBundleManifest)

describe('bundlePatchPaths containment', () => {
  it('resolves a normal relative path inside the package', () => {
    const [p] = bundlePatchPaths(PKG, bundle('./cordis.patch.yml'), 'evil-pkg')
    expect(p).toBe(join(PKG, 'cordis.patch.yml'))
    expect(p.startsWith(PKG)).toBe(true)
  })

  it('resolves nested relative paths and preserves order', () => {
    const got = bundlePatchPaths(PKG, bundle(['a.yml', 'patches/b.yml']), 'evil-pkg')
    expect(got).toEqual([join(PKG, 'a.yml'), join(PKG, 'patches', 'b.yml')])
  })

  it('refuses the advisory payload', () => {
    expect(() => bundlePatchPaths(PKG, bundle('../../../../secret.yml'), 'evil-pkg'))
      .toThrow(/escapes the package directory/)
  })

  it('refuses every upward-traversal shape', () => {
    for (const hostile of ['../sibling.yml', './../x.yml', 'a/../../b.yml', '..\\..\\w.yml']) {
      expect(() => bundlePatchPaths(PKG, bundle(hostile), 'evil-pkg'),
        hostile).toThrow(/escapes the package directory/)
    }
  })

  it('refuses absolute paths, drive-relative paths, and UNC paths', () => {
    for (const hostile of ['/etc/passwd', 'C:\\Windows\\win.ini', 'C:foo.yml', '\\\\srv\\share\\x.yml']) {
      expect(() => bundlePatchPaths(PKG, bundle(hostile), 'evil-pkg'),
        hostile).toThrow(/absolute patch path/)
    }
  })

  it('refuses an empty declaration', () => {
    expect(() => bundlePatchPaths(PKG, bundle(''), 'evil-pkg')).toThrow(/empty dsh\.bundle\.patch/)
  })

  it('refuses when any file in a list is hostile', () => {
    expect(() => bundlePatchPaths(PKG, bundle(['ok.yml', '../../x.yml']), 'evil-pkg'))
      .toThrow(/escapes the package directory/)
  })

  it('still rejects non-string declarations', () => {
    expect(() => bundlePatchPaths(PKG, bundle(42), 'evil-pkg'))
      .toThrow(/must be a file path or a list of file paths/)
    expect(() => bundlePatchPaths(PKG, bundle(['ok.yml', 7]), 'evil-pkg'))
      .toThrow(/must be a file path or a list of file paths/)
  })

  it('names the offending package in the error', () => {
    expect(() => bundlePatchPaths(PKG, bundle('../x.yml'), '@evil/pkg')).toThrow(/"@evil\/pkg"/)
  })
})

describe('isPathInside', () => {
  it('accepts the root itself and descendants', () => {
    expect(isPathInside(PKG, PKG)).toBe(true)
    expect(isPathInside(PKG, join(PKG, 'a', 'b.yml'))).toBe(true)
  })

  it('rejects parents, siblings and other drives', () => {
    expect(isPathInside(PKG, resolve(PKG, '..'))).toBe(false)
    expect(isPathInside(PKG, resolve(PKG, '..', 'other'))).toBe(false)
    expect(isPathInside(PKG, `${resolve('/')}${sep}`)).toBe(false)
  })

  it('rejects a prefix that is not a path boundary', () => {
    // /a/evil-pkg-extra must not count as inside /a/evil-pkg
    expect(isPathInside(PKG, `${PKG}-extra`)).toBe(false)
  })
})

describe('assertBundlePatchPath', () => {
  it('returns nothing for a legal path', () => {
    expect(() => assertBundlePatchPath('pkg', './cordis.patch.yml')).not.toThrow()
  })

  it('rejects traversal regardless of separator', () => {
    expect(() => assertBundlePatchPath('pkg', 'a/../b')).toThrow(/'\.\.' segments are not allowed/)
    expect(() => assertBundlePatchPath('pkg', 'a\\..\\b')).toThrow(/'\.\.' segments are not allowed/)
  })
})

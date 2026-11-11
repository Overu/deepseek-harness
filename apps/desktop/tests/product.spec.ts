import { describe, expect, it } from 'vitest'
import {
  DESKTOP_RUNTIME_VERSION_FIELD,
  INSIGHT_DESKTOP_PRODUCT,
  resolveDesktopProduct,
} from '../src/product.ts'

describe('desktop product', () => {
  it('keeps the official product when no selector is present', () => {
    expect(resolveDesktopProduct({ isPackaged: false, environment: {} })).toEqual({ kind: 'official' })
    expect(resolveDesktopProduct({ isPackaged: true, manifest: { version: '0.2.2' }, environment: { DSH_DESKTOP_PRODUCT: INSIGHT_DESKTOP_PRODUCT } }))
      .toEqual({ kind: 'official' })
  })

  it('uses only the development selector before packaging', () => {
    expect(resolveDesktopProduct({
      isPackaged: false,
      environment: { DSH_DESKTOP_PRODUCT: INSIGHT_DESKTOP_PRODUCT, INSIGHT_DESKTOP_VERSION: '1.4.0-beta.2', DSH_CLIENT_VERSION: '0.2.2' },
    })).toMatchObject({
      kind: 'insight', productName: '因赛AI', appId: 'com.insight-aigc.desktop', userDataName: 'insight-desktop',
      developmentUserDataName: 'insight-desktop-dev', serviceEnvironment: 'test', productVersion: '1.4.0-beta.2', runtimeVersion: '0.2.2',
      branding: { macIcon: 'branding/icon.icns', windowsIcon: 'branding/icon.ico', resourceIcon: 'branding/app-icon.png' },
    })
  })

  it('uses only the packaged manifest after packaging', () => {
    expect(resolveDesktopProduct({
      isPackaged: true,
      manifest: { dshDesktopProduct: INSIGHT_DESKTOP_PRODUCT, version: '1.4.0', [DESKTOP_RUNTIME_VERSION_FIELD]: '0.2.2' },
      environment: {},
    })).toMatchObject({ kind: 'insight', serviceEnvironment: 'production', productVersion: '1.4.0', runtimeVersion: '0.2.2' })
  })

  it('isolates a packaged test client from the production application and account data', () => {
    expect(resolveDesktopProduct({ isPackaged: true, manifest: {
      dshDesktopProduct: INSIGHT_DESKTOP_PRODUCT, dshDesktopAppId: 'com.insight-aigc.desktop.test',
      dshInsightServiceEnvironment: 'test', version: '1.4.0-beta.2',
    } })).toMatchObject({ kind: 'insight', productName: '因赛AI 测试版', appId: 'com.insight-aigc.desktop.test',
      userDataName: 'insight-desktop-test', serviceEnvironment: 'test' })
    expect(() => resolveDesktopProduct({ isPackaged: true, manifest: {
      dshDesktopProduct: INSIGHT_DESKTOP_PRODUCT, dshDesktopAppId: 'com.insight-aigc.desktop',
      dshInsightServiceEnvironment: 'test', version: '1.4.0-beta.2',
    } })).toThrow(/isolated test application ID/u)
    expect(() => resolveDesktopProduct({ isPackaged: true, manifest: {
      dshDesktopProduct: INSIGHT_DESKTOP_PRODUCT, dshDesktopAppId: 'com.insight-aigc.desktop.test',
      version: '1.4.0-beta.2',
    } })).toThrow(/test service environment/u)
  })

  it.each([
    { isPackaged: false, environment: { DSH_DESKTOP_PRODUCT: INSIGHT_DESKTOP_PRODUCT } },
    { isPackaged: false, environment: { DSH_DESKTOP_PRODUCT: INSIGHT_DESKTOP_PRODUCT, INSIGHT_DESKTOP_VERSION: '0.2.2' } },
    { isPackaged: true, manifest: { dshDesktopProduct: INSIGHT_DESKTOP_PRODUCT, version: '1.4.0+local', [DESKTOP_RUNTIME_VERSION_FIELD]: '0.2.2' } },
    { isPackaged: true, manifest: { dshDesktopProduct: INSIGHT_DESKTOP_PRODUCT, version: '1.4.0', [DESKTOP_RUNTIME_VERSION_FIELD]: 'not-a-version' } },
  ])('rejects an incomplete or conflated Insight version %#', (options) => {
    expect(() => resolveDesktopProduct(options)).toThrow(/desktop product/u)
  })

  it('rejects an unknown selector instead of silently changing products', () => {
    expect(() => resolveDesktopProduct({ isPackaged: false, environment: { DSH_DESKTOP_PRODUCT: 'other' } }))
      .toThrow(/DSH_DESKTOP_PRODUCT/u)
  })
})

import { describe, expect, it } from 'vitest'
import { builtInComponents } from '../main/components/built-in-components'
import { componentDescriptorSchema } from './component'

describe('Component Contract v1', () => {
  it('accepts the built-in Component and Adapter descriptors', () => {
    for (const component of builtInComponents) {
      expect(componentDescriptorSchema.parse(component.descriptor)).toEqual(component.descriptor)
    }
  })

  it('rejects duplicate capability declarations in one Component', () => {
    const descriptor = structuredClone(builtInComponents[0].descriptor)
    descriptor.provides.push({ ...descriptor.provides[0] })

    expect(() => componentDescriptorSchema.parse(descriptor)).toThrow('不能重复声明')
  })

  it('does not treat generated Adapter code as a valid Adapter without a runtime reference', () => {
    const descriptor = structuredClone(builtInComponents[2].descriptor)
    descriptor.runtimeAdapter = null

    expect(() => componentDescriptorSchema.parse(descriptor)).toThrow(
      'Adapter 必须声明 Runtime Adapter',
    )
  })

  it('rejects credentialed Descriptor references before they can enter project storage', () => {
    const descriptor = structuredClone(builtInComponents[0].descriptor)
    descriptor.source.location = 'https://user:secret@example.test/component?token=value'

    expect(() => componentDescriptorSchema.parse(descriptor)).toThrow('不得包含凭证')

    descriptor.source.location = 'local-package token=raw-secret'
    expect(() => componentDescriptorSchema.parse(descriptor)).toThrow('不得包含凭证')
  })
})

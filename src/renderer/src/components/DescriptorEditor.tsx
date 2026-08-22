import { Plus, Trash } from '@phosphor-icons/react'
import { useState } from 'react'
import {
  componentDescriptorSchema,
  coreCapabilities,
  type ComponentDescriptor,
} from '../../../shared/component'

interface DescriptorEditorProps {
  descriptor: ComponentDescriptor
  pending: boolean
  onCancel: () => void
  onSave: (descriptor: ComponentDescriptor) => Promise<boolean>
}

const replaceabilityOptions: ComponentDescriptor['provides'][number]['replaceability'][] = [
  'built-in',
  'configurable',
  'disableable',
  'replaceable',
  'adapter-required',
  'fork-required',
  'locked',
  'unknown',
]
const strategyOptions: ComponentDescriptor['compatibility']['level'][] = [
  'native',
  'configuration',
  'adapter',
  'fork',
  'blocked',
  'unknown',
]

export function DescriptorEditor({ descriptor, pending, onCancel, onSave }: DescriptorEditorProps) {
  const [draft, setDraft] = useState<ComponentDescriptor>(() => structuredClone(descriptor))
  const [formError, setFormError] = useState<string>()
  const update = (next: Partial<ComponentDescriptor>) =>
    setDraft((current) => ({ ...current, ...next }))

  return (
    <form
      className="descriptor-form descriptor-form--complete"
      aria-label={`更新 ${descriptor.name} Descriptor`}
      onSubmit={(event) => {
        event.preventDefault()
        const parsed = componentDescriptorSchema.safeParse(draft)
        if (!parsed.success) {
          setFormError(parsed.error.issues[0]?.message ?? 'Descriptor 字段无效。')
          return
        }
        setFormError(undefined)
        void onSave(parsed.data).then((saved) => {
          if (saved) onCancel()
        })
      }}
    >
      <header>
        <div>
          <h3>结构化 Descriptor 编辑器</h3>
          <p>保存会写入审计记录，但不会把 declared 提升为契约或运行证据。</p>
        </div>
      </header>

      {formError ? <div role="alert">{formError}</div> : null}
      <div className="descriptor-form__grid">
        <label>
          <span>名称</span>
          <input
            maxLength={100}
            onChange={(event) => update({ name: event.target.value })}
            required
            value={draft.name}
          />
        </label>
        <label>
          <span>版本</span>
          <input
            onChange={(event) => update({ version: event.target.value })}
            pattern="\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?"
            required
            value={draft.version}
          />
        </label>
        <label>
          <span>类型</span>
          <select
            onChange={(event) =>
              update({ kind: event.target.value as ComponentDescriptor['kind'] })
            }
            value={draft.kind}
          >
            <option value="component">Component</option>
            <option value="adapter">Adapter</option>
          </select>
        </label>
        <label>
          <span>许可证</span>
          <input
            maxLength={120}
            onChange={(event) =>
              update({ source: { ...draft.source, license: event.target.value } })
            }
            required
            value={draft.source.license}
          />
        </label>
      </div>

      <fieldset>
        <legend>平台</legend>
        {(['darwin-arm64', 'darwin-x64'] as const).map((platform) => (
          <label className="checkbox-row" key={platform}>
            <input
              checked={draft.platforms.includes(platform)}
              onChange={(event) =>
                update({
                  platforms: event.target.checked
                    ? [...draft.platforms, platform]
                    : draft.platforms.filter((item) => item !== platform),
                })
              }
              type="checkbox"
            />
            <span>{platform}</span>
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>兼容处置策略</legend>
        <div className="descriptor-form__grid">
          <label>
            <span>策略</span>
            <select
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  compatibility: {
                    ...current.compatibility,
                    level: event.target.value as ComponentDescriptor['compatibility']['level'],
                    strategySelectedAt: new Date().toISOString(),
                  },
                }))
              }
              value={draft.compatibility.level}
            >
              {strategyOptions.map((option) => (
                <option key={option} value={option}>
                  {option === 'blocked' ? 'incompatible' : option}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>验证等级（系统只读）</span>
            <input disabled value={draft.compatibility.validation} />
          </label>
        </div>
        <label>
          <span>策略理由</span>
          <textarea
            maxLength={500}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                compatibility: {
                  ...current.compatibility,
                  strategyRationale: event.target.value || undefined,
                },
              }))
            }
            required={Boolean(draft.compatibility.strategySelectedAt)}
            rows={2}
            value={draft.compatibility.strategyRationale ?? ''}
          />
        </label>
        <label>
          <span>兼容性说明</span>
          <textarea
            maxLength={500}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                compatibility: { ...current.compatibility, detail: event.target.value },
              }))
            }
            required
            rows={3}
            value={draft.compatibility.detail}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>提供能力</legend>
        {draft.provides.map((provider, index) => (
          <div className="descriptor-array-row" key={`provider-${index}`}>
            <label>
              <span>能力</span>
              <input
                list="component-capabilities"
                onChange={(event) => {
                  const provides = [...draft.provides]
                  provides[index] = { ...provider, capability: event.target.value as never }
                  update({ provides })
                }}
                required
                value={provider.capability}
              />
            </label>
            <label>
              <span>实现标识</span>
              <input
                onChange={(event) => {
                  const provides = [...draft.provides]
                  provides[index] = { ...provider, implementation: event.target.value }
                  update({ provides })
                }}
                required
                value={provider.implementation}
              />
            </label>
            <label>
              <span>替换性</span>
              <select
                onChange={(event) => {
                  const provides = [...draft.provides]
                  provides[index] = { ...provider, replaceability: event.target.value as never }
                  update({ provides })
                }}
                value={provider.replaceability}
              >
                {replaceabilityOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>激活方式</span>
              <select
                onChange={(event) => {
                  const provides = [...draft.provides]
                  provides[index] = { ...provider, activation: event.target.value as never }
                  update({ provides })
                }}
                value={provider.activation}
              >
                <option value="owner-only">owner-only</option>
                <option value="always-active">always-active</option>
              </select>
            </label>
            <label>
              <span>来源置信</span>
              <select
                onChange={(event) => {
                  const provides = [...draft.provides]
                  provides[index] = { ...provider, confidence: event.target.value as never }
                  update({ provides })
                }}
                value={provider.confidence}
              >
                <option value="declared">declared</option>
                <option value="detected">detected</option>
                <option value="user-confirmed">user-confirmed（仅人工决策）</option>
                <option value="verified">verified</option>
              </select>
            </label>
            <button
              aria-label={`移除提供能力 ${provider.capability}`}
              className="icon-button"
              disabled={draft.provides.length === 1}
              onClick={() =>
                update({ provides: draft.provides.filter((_, item) => item !== index) })
              }
              type="button"
            >
              <Trash size={16} />
            </button>
          </div>
        ))}
        <datalist id="component-capabilities">
          {coreCapabilities.map((capability) => (
            <option key={capability} value={capability} />
          ))}
        </datalist>
        <button
          className="button button--quiet"
          onClick={() =>
            update({
              provides: [
                ...draft.provides,
                {
                  capability: 'memory',
                  implementation: `${draft.id}.memory`,
                  replaceability: 'unknown',
                  confidence: 'declared',
                  activation: 'owner-only',
                },
              ],
            })
          }
          type="button"
        >
          <Plus size={16} />
          添加提供能力
        </button>
      </fieldset>

      <fieldset>
        <legend>依赖能力</legend>
        {draft.requires.map((requirement, index) => (
          <div
            className="descriptor-array-row descriptor-array-row--compact"
            key={`requirement-${index}`}
          >
            <label>
              <span>能力</span>
              <input
                list="component-capabilities"
                onChange={(event) => {
                  const requires = [...draft.requires]
                  requires[index] = { ...requirement, capability: event.target.value as never }
                  update({ requires })
                }}
                required
                value={requirement.capability}
              />
            </label>
            <label>
              <span>版本范围（可选）</span>
              <input
                onChange={(event) => {
                  const requires = [...draft.requires]
                  requires[index] = { ...requirement, version: event.target.value || null }
                  update({ requires })
                }}
                value={requirement.version ?? ''}
              />
            </label>
            <button
              aria-label={`移除依赖 ${requirement.capability}`}
              className="icon-button"
              onClick={() =>
                update({ requires: draft.requires.filter((_, item) => item !== index) })
              }
              type="button"
            >
              <Trash size={16} />
            </button>
          </div>
        ))}
        <button
          className="button button--quiet"
          onClick={() =>
            update({
              requires: [...draft.requires, { capability: 'model-provider', version: null }],
            })
          }
          type="button"
        >
          <Plus size={16} />
          添加依赖
        </button>
      </fieldset>

      <fieldset>
        <legend>配置与运行入口</legend>
        <div className="descriptor-form__grid">
          <label>
            <span>配置 Schema 引用（可选）</span>
            <input
              onChange={(event) => update({ configSchema: event.target.value || null })}
              value={draft.configSchema ?? ''}
            />
          </label>
          <label>
            <span>Runtime Adapter 引用（可选）</span>
            <input
              onChange={(event) => update({ runtimeAdapter: event.target.value || null })}
              value={draft.runtimeAdapter ?? ''}
            />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>最小权限声明</legend>
        {(draft.permissions ?? []).map((permission, index) => (
          <div
            className="descriptor-array-row descriptor-array-row--compact"
            key={`permission-${index}`}
          >
            <label>
              <span>范围</span>
              <select
                onChange={(event) => {
                  const permissions = [...(draft.permissions ?? [])]
                  permissions[index] = { ...permission, scope: event.target.value as never }
                  update({ permissions })
                }}
                value={permission.scope}
              >
                {['network', 'filesystem-read', 'filesystem-write', 'subprocess', 'keychain'].map(
                  (scope) => (
                    <option key={scope}>{scope}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              <span>理由</span>
              <input
                onChange={(event) => {
                  const permissions = [...(draft.permissions ?? [])]
                  permissions[index] = { ...permission, reason: event.target.value }
                  update({ permissions })
                }}
                required
                value={permission.reason}
              />
            </label>
            <label className="checkbox-row">
              <input
                checked={permission.required}
                onChange={(event) => {
                  const permissions = [...(draft.permissions ?? [])]
                  permissions[index] = { ...permission, required: event.target.checked }
                  update({ permissions })
                }}
                type="checkbox"
              />
              <span>必需</span>
            </label>
            <button
              aria-label={`移除权限 ${permission.scope}`}
              className="icon-button"
              onClick={() =>
                update({
                  permissions: (draft.permissions ?? []).filter((_, item) => item !== index),
                })
              }
              type="button"
            >
              <Trash size={16} />
            </button>
          </div>
        ))}
        <button
          className="button button--quiet"
          onClick={() =>
            update({
              permissions: [
                ...(draft.permissions ?? []),
                { scope: 'network', required: true, reason: '' },
              ],
            })
          }
          type="button"
        >
          <Plus size={16} />
          添加权限
        </button>
      </fieldset>

      <fieldset>
        <legend>Keychain 密钥引用</legend>
        {(draft.secretReferences ?? []).map((secret, index) => (
          <div
            className="descriptor-array-row descriptor-array-row--compact"
            key={`secret-${index}`}
          >
            <label>
              <span>引用名</span>
              <input
                onChange={(event) => {
                  const secretReferences = [...(draft.secretReferences ?? [])]
                  secretReferences[index] = { ...secret, name: event.target.value.toUpperCase() }
                  update({ secretReferences })
                }}
                pattern="[A-Z][A-Z0-9_]{1,79}"
                required
                value={secret.name}
              />
            </label>
            <label>
              <span>用途</span>
              <input
                onChange={(event) => {
                  const secretReferences = [...(draft.secretReferences ?? [])]
                  secretReferences[index] = { ...secret, purpose: event.target.value }
                  update({ secretReferences })
                }}
                required
                value={secret.purpose}
              />
            </label>
            <label className="checkbox-row">
              <input
                checked={secret.required}
                onChange={(event) => {
                  const secretReferences = [...(draft.secretReferences ?? [])]
                  secretReferences[index] = { ...secret, required: event.target.checked }
                  update({ secretReferences })
                }}
                type="checkbox"
              />
              <span>必需</span>
            </label>
            <button
              aria-label={`移除密钥引用 ${secret.name}`}
              className="icon-button"
              onClick={() =>
                update({
                  secretReferences: (draft.secretReferences ?? []).filter(
                    (_, item) => item !== index,
                  ),
                })
              }
              type="button"
            >
              <Trash size={16} />
            </button>
          </div>
        ))}
        <button
          className="button button--quiet"
          onClick={() =>
            update({
              secretReferences: [
                ...(draft.secretReferences ?? []),
                { name: 'API_KEY', purpose: '', required: true },
              ],
            })
          }
          type="button"
        >
          <Plus size={16} />
          添加密钥引用
        </button>
        <p>只保存引用名与用途，密钥原文仍只能进入 macOS Keychain。</p>
      </fieldset>

      <div className="descriptor-form__actions">
        <button className="button button--primary" disabled={pending} type="submit">
          {pending ? '正在保存…' : '保存 Descriptor'}
        </button>
        <button
          className="button button--secondary"
          disabled={pending}
          onClick={onCancel}
          type="button"
        >
          取消
        </button>
      </div>
    </form>
  )
}

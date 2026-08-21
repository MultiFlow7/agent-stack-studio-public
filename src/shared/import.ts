import { z } from 'zod'

export const scanEvidenceSchema = z.object({
  kind: z.enum(['manifest', 'convention', 'dependency']),
  path: z.string().min(1),
  detail: z.string().min(1),
})

export const importScanSchema = z.object({
  scanId: z.uuid(),
  sourcePath: z.string().min(1),
  suggestedName: z.string().min(1).max(80),
  projectType: z.enum(['node', 'python', 'agent-config', 'unknown']),
  evidence: z.array(scanEvidenceSchema),
  warnings: z.array(z.string()),
})

export const importScanResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cancelled') }),
  z.object({ status: z.literal('scanned'), scan: importScanSchema }),
])

export const confirmImportInputSchema = z.object({ scanId: z.uuid() })

export type ImportScan = z.infer<typeof importScanSchema>
export type ImportScanResult = z.infer<typeof importScanResultSchema>
export type ScanEvidence = z.infer<typeof scanEvidenceSchema>

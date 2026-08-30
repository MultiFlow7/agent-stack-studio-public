import { ipcMain } from 'electron'
import { emptyDoctorInputSchema, studioDoctorReportSchema } from '../../shared/doctor'
import { ipcChannels } from '../../shared/ipc'
import type { StudioDoctorService } from '../doctor/studio-doctor-service'
import { createValidatedHandler } from './validated-handler'

export function registerDoctorIpc(doctor: StudioDoctorService): () => void {
  ipcMain.handle(
    ipcChannels.doctorRun,
    createValidatedHandler({
      input: emptyDoctorInputSchema,
      output: studioDoctorReportSchema,
      handle: () => doctor.run(),
    }),
  )
  return () => ipcMain.removeHandler(ipcChannels.doctorRun)
}

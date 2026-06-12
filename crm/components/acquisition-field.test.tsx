// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const mockGet = vi.fn()
const mockSave = vi.fn()

vi.mock('@/app/(protected)/clients/acquisition-actions', () => ({
  getClientAcquisition: (...a: unknown[]) => mockGet(...a),
  saveAcquisitionAnswer: (...a: unknown[]) => mockSave(...a),
}))

import { AcquisitionField } from './acquisition-field'

afterEach(cleanup)

describe('AcquisitionField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows assigned source name', async () => {
    mockGet.mockResolvedValue({ sourceId: 's1', sourceName: 'Instagram', rawAnswer: 'инста' })
    render(<AcquisitionField clientId="c1" />)
    await waitFor(() => expect(screen.getByText(/Instagram/)).toBeInTheDocument())
  })

  it('shows pending state when raw answer awaits review', async () => {
    mockGet.mockResolvedValue({ sourceId: null, sourceName: null, rawAnswer: 'не помню' })
    render(<AcquisitionField clientId="c1" />)
    await waitFor(() => expect(screen.getByText(/На разборе/)).toBeInTheDocument())
  })

  it('saves an answer and reloads', async () => {
    mockGet.mockResolvedValueOnce({ sourceId: null, sourceName: null, rawAnswer: null })
    mockGet.mockResolvedValueOnce({ sourceId: 's1', sourceName: 'Instagram', rawAnswer: 'в инсте видела' })
    mockSave.mockResolvedValue({ success: true, matched: true, alreadySet: false })

    render(<AcquisitionField clientId="c1" />)
    await waitFor(() => expect(screen.getByPlaceholderText(/Откуда вы о нас узнали/)).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText(/Откуда вы о нас узнали/), { target: { value: 'в инсте видела' } })
    fireEvent.click(screen.getByRole('button', { name: 'Записать' }))

    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('c1', 'в инсте видела'))
    await waitFor(() => expect(screen.getByText(/Instagram/)).toBeInTheDocument())
  })
})

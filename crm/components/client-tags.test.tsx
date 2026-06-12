// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const mockGetClientTags = vi.fn()
const mockGetAllTags = vi.fn()
const mockAddTag = vi.fn()
const mockRemoveTag = vi.fn()

vi.mock('@/app/(protected)/clients/tag-actions', () => ({
  getClientTags: (...a: unknown[]) => mockGetClientTags(...a),
  getAllTags: (...a: unknown[]) => mockGetAllTags(...a),
  addTagToClient: (...a: unknown[]) => mockAddTag(...a),
  removeTagFromClient: (...a: unknown[]) => mockRemoveTag(...a),
}))

import { ClientTags } from './client-tags'

afterEach(cleanup)

describe('ClientTags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetClientTags.mockResolvedValue([{ id: 't1', name: 'VIP' }])
    mockGetAllTags.mockResolvedValue([
      { id: 't1', name: 'VIP' },
      { id: 't2', name: 'юрлицо' },
    ])
  })

  it('renders client tags as chips', async () => {
    render(<ClientTags clientId="c1" />)
    await waitFor(() => expect(screen.getByText('VIP')).toBeInTheDocument())
  })

  it('adds an existing tag from the picker', async () => {
    mockAddTag.mockResolvedValue({ success: true, tagId: 't2' })
    render(<ClientTags clientId="c1" />)
    await waitFor(() => expect(screen.getByText('VIP')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '+ тег' }))
    fireEvent.click(screen.getByRole('button', { name: 'юрлицо' }))

    await waitFor(() => expect(mockAddTag).toHaveBeenCalledWith('c1', { tagId: 't2' }))
  })

  it('creates a new tag from the input', async () => {
    mockAddTag.mockResolvedValue({ success: true, tagId: 't3' })
    render(<ClientTags clientId="c1" />)
    await waitFor(() => expect(screen.getByText('VIP')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '+ тег' }))
    fireEvent.change(screen.getByPlaceholderText('Новый тег...'), { target: { value: 'проблемный' } })
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }))

    await waitFor(() => expect(mockAddTag).toHaveBeenCalledWith('c1', { name: 'проблемный' }))
  })

  it('removes a tag', async () => {
    mockRemoveTag.mockResolvedValue({ success: true })
    render(<ClientTags clientId="c1" />)
    await waitFor(() => expect(screen.getByText('VIP')).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('Убрать тег VIP'))
    await waitFor(() => expect(mockRemoveTag).toHaveBeenCalledWith('c1', 't1'))
  })
})

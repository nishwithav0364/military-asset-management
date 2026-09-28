import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AssetCommand from './AssetCommand'

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('axios', () => ({
  default: {
    create: () => ({ interceptors: { request: { use: vi.fn() } }, get, post }),
    isAxiosError: () => false,
  },
}))

const admin = { id: 1, name: 'System Administrator', email: 'admin@assetcommand.demo', role: 'ADMIN' as const, baseId: null, baseName: null }
const commander = { id: 2, name: 'Fort Liberty Commander', email: 'commander@assetcommand.demo', role: 'BASE_COMMANDER' as const, baseId: 1, baseName: 'Fort Liberty' }
const logistics = { id: 3, name: 'Logistics Officer', email: 'logistics@assetcommand.demo', role: 'LOGISTICS_OFFICER' as const, baseId: null, baseName: null }
const dashboard = {
  openingBalance: 494, closingBalance: 490, netMovement: 8, purchases: 8, transferIn: 3, transferOut: 3, assigned: 12, expended: 0,
  byEquipment: [{ id: 1, name: 'Utility Vehicle', category: 'Vehicles', unit: 'vehicles', balance: 45 }],
}
const bases = [{ id: 1, name: 'Fort Liberty', code: 'FLB' }, { id: 2, name: 'Camp Pendleton', code: 'CPB' }]
const equipment = [{ id: 1, name: 'Utility Vehicle', category: 'Vehicles', unit: 'vehicles' }, { id: 3, name: 'Field Radio', category: 'Communications', unit: 'radios' }]

function configureApi(user: typeof admin | typeof commander | typeof logistics) {
  get.mockImplementation((url: string) => Promise.resolve({ data:
    url === '/auth/me' ? user : url === '/bases' ? bases : url === '/equipment' ? equipment : url === '/dashboard' ? dashboard : [],
  }))
  post.mockImplementation((url: string) => Promise.resolve({ data: url === '/auth/login' ? { token: 'test-token', user } : { id: 2 } }))
}

describe('Asset Command UI', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    localStorage.clear()
    get.mockReset()
    post.mockReset()
  })

  it('signs in and displays dashboard metrics and movement details', async () => {
    configureApi(admin)
    const user = userEvent.setup()
    render(<AssetCommand />)

    await user.click(screen.getByRole('button', { name: /Administrator.*Full system access/ }))
    expect(await screen.findByRole('heading', { name: 'Operational overview' })).toBeInTheDocument()
    expect(screen.getByText('494')).toBeInTheDocument()
    expect(screen.getByText('490')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /NET MOVEMENT/ }))
    const dialog = screen.getByRole('dialog', { name: 'Net movement' })
    expect(within(dialog).getByText('Purchases')).toBeInTheDocument()
    expect(within(dialog).getByText('Transfer in')).toBeInTheDocument()
    expect(within(dialog).getByText('Transfer out')).toBeInTheDocument()
  })

  it('limits logistics navigation to purchases and transfers', async () => {
    configureApi(logistics)
    const user = userEvent.setup()
    render(<AssetCommand />)

    await user.click(screen.getByRole('button', { name: /Logistics officer.*Purchases and transfers/ }))
    expect(await screen.findByRole('heading', { name: 'Purchases' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Transfers' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assignments' })).not.toBeInTheDocument()
  })

  it('submits a purchase from the operational form', async () => {
    configureApi(admin)
    const user = userEvent.setup()
    render(<AssetCommand />)

    await user.click(screen.getByRole('button', { name: /Administrator.*Full system access/ }))
    await screen.findByRole('heading', { name: 'Operational overview' })
    await user.click(screen.getByRole('button', { name: 'Purchases' }))
    await screen.findByRole('heading', { name: 'Purchase history' })
    await user.click(screen.getByRole('button', { name: 'Record purchase' }))

    const dialog = screen.getByRole('dialog', { name: 'Record a purchase' })
    await user.selectOptions(within(dialog).getByLabelText('Receiving base'), '1')
    await user.selectOptions(within(dialog).getByLabelText('Equipment type'), '3')
    await user.type(within(dialog).getByLabelText('Quantity'), '4')
    await user.type(within(dialog).getByLabelText('Supplier'), 'Test Supplier')
    await user.click(within(dialog).getByRole('button', { name: /Confirm transaction/ }))

    await waitFor(() => expect(post).toHaveBeenCalledWith('/purchases', { baseId: 1, equipmentTypeId: 3, quantity: 4, supplier: 'Test Supplier' }))
  })
})
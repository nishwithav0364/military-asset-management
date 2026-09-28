import { startTransition, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import axios from 'axios'
import {
  Activity, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Boxes, Building2, Check, ChevronDown,
  CircleUserRound, ClipboardList, Clock3, Command, FileClock, LogOut, Menu, Plus, Radio,
  ShieldCheck, Truck, Users, X,
} from 'lucide-react'
import './AssetCommand.css'

type Role = 'ADMIN' | 'BASE_COMMANDER' | 'LOGISTICS_OFFICER'
type User = { id: number; name: string; email: string; role: Role; baseId: number | null; baseName: string | null }
type Base = { id: number; name: string; code: string }
type Equipment = { id: number; name: string; category: string; unit: string }
type Page = 'dashboard' | 'purchases' | 'transfers' | 'assignments' | 'audit'
type Dialog = Page | 'return' | 'expense' | null
type Dashboard = { openingBalance: number; closingBalance: number; netMovement: number; purchases: number; transferIn: number; transferOut: number; assigned: number; expended: number; byEquipment: (Equipment & { balance: number })[] }
type Purchase = { id: number; quantity: number; supplier: string; date: string; base: string; equipment: string; recorded_by: string }
type Transfer = { id: number; reference: string; quantity: number; date: string; from_base: string; to_base: string; equipment: string; recorded_by: string }
type Assignment = { id: number; personnel: string; quantity: number; returnedQuantity: number; expendedQuantity: number; activeQuantity: number; date: string; base: string; equipment: string }
type AuditEntry = { id: number; action: string; entity: string; entityId: number; details: string; date: string; actor: string }

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api' })
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('asset-command-token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

const demos = [
  { label: 'Administrator', email: 'admin@assetcommand.demo', password: 'Admin123!', detail: 'Full system access' },
  { label: 'Base commander', email: 'commander@assetcommand.demo', password: 'Commander123!', detail: 'Fort Liberty' },
  { label: 'Logistics officer', email: 'logistics@assetcommand.demo', password: 'Logistics123!', detail: 'Purchases and transfers' },
]
const titles: Record<Page, string> = { dashboard: 'Operational overview', purchases: 'Purchases', transfers: 'Base transfers', assignments: 'Assignments & expenditure', audit: 'Audit trail' }

function displayDate(date: string) {
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function AssetCommand() {
  const [token, setToken] = useState(() => localStorage.getItem('asset-command-token'))
  const [user, setUser] = useState<User | null>(null)
  const [page, setPage] = useState<Page>('dashboard')
  const [bases, setBases] = useState<Base[]>([])
  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [filters, setFilters] = useState({ baseId: '', equipmentId: '', from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) })
  const [dialog, setDialog] = useState<Dialog>(null)
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null)
  const [loginEmail, setLoginEmail] = useState(demos[0].email)
  const [loginPassword, setLoginPassword] = useState(demos[0].password)
  const [loginError, setLoginError] = useState('')
  const [requestError, setRequestError] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showMovement, setShowMovement] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [revision, setRevision] = useState(0)

  const pages = useMemo<Page[]>(() => user?.role === 'LOGISTICS_OFFICER' ? ['purchases', 'transfers'] : user?.role === 'BASE_COMMANDER' ? ['dashboard', 'purchases', 'transfers', 'assignments'] : ['dashboard', 'purchases', 'transfers', 'assignments', 'audit'], [user])

  useEffect(() => {
    if (!token) return
    let active = true
    Promise.all([api.get<User>('/auth/me'), api.get<Base[]>('/bases'), api.get<Equipment[]>('/equipment')])
      .then(([me, baseResult, equipmentResult]) => {
        if (!active) return
        setUser(me.data); setBases(baseResult.data); setEquipment(equipmentResult.data)
        if (me.data.role === 'LOGISTICS_OFFICER') setPage('purchases')
      })
      .catch(() => signOut())
    return () => { active = false }
  }, [token])

  useEffect(() => {
    if (!token || !user || !pages.includes(page)) return
    let active = true
    startTransition(() => { setLoading(true); setRequestError('') })
    const params = { ...filters, baseId: filters.baseId || undefined, equipmentId: filters.equipmentId || undefined }
    const load = async () => {
      try {
        if (page === 'dashboard') setDashboard((await api.get<Dashboard>('/dashboard', { params })).data)
        else if (page === 'purchases') setPurchases((await api.get<Purchase[]>('/purchases', { params })).data)
        else if (page === 'transfers') setTransfers((await api.get<Transfer[]>('/transfers', { params })).data)
        else if (page === 'assignments') setAssignments((await api.get<Assignment[]>('/assignments', { params })).data)
        else setAuditEntries((await api.get<AuditEntry[]>('/audit')).data)
      } catch (error) {
        if (active) setRequestError(axios.isAxiosError(error) ? error.response?.data?.error ?? 'Could not load this view' : 'Could not load this view')
      } finally { if (active) setLoading(false) }
    }
    void load()
    return () => { active = false }
  }, [token, user, page, filters, revision, pages])

  function signOut() {
    localStorage.removeItem('asset-command-token'); setToken(null); setUser(null); setDashboard(null)
  }

  async function signIn(email = loginEmail, password = loginPassword) {
    setLoginError(''); setLoading(true)
    try {
      const result = await api.post<{ token: string; user: User }>('/auth/login', { email, password })
      localStorage.setItem('asset-command-token', result.data.token); setUser(result.data.user); setToken(result.data.token)
      setPage(result.data.user.role === 'LOGISTICS_OFFICER' ? 'purchases' : 'dashboard')
    } catch (error) {
      setLoginError(axios.isAxiosError(error) ? error.response?.data?.error ?? 'Sign-in failed' : 'Sign-in failed')
    } finally { setLoading(false) }
  }

  async function submitOperation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const quantity = Number(form.get('quantity'))
    const equipmentTypeId = Number(form.get('equipmentTypeId'))
    let payload: Record<string, string | number> = { quantity }
    if (dialog === 'purchases') payload = { ...payload, baseId: Number(form.get('baseId')), equipmentTypeId, supplier: String(form.get('supplier')) }
    if (dialog === 'transfers') payload = { ...payload, fromBaseId: Number(form.get('fromBaseId')), toBaseId: Number(form.get('toBaseId')), equipmentTypeId }
    if (dialog === 'assignments') payload = { ...payload, baseId: Number(form.get('baseId')), equipmentTypeId, personnel: String(form.get('personnel')) }
    setSaving(true); setRequestError('')
    try {
      if (dialog === 'return' || dialog === 'expense') await api.post(`/assignments/${selectedAssignment?.id}/${dialog}`, payload)
      else await api.post(`/${dialog}`, payload)
      setDialog(null); setSelectedAssignment(null); setRevision((value) => value + 1)
    } catch (error) {
      setRequestError(axios.isAxiosError(error) ? error.response?.data?.error ?? 'Could not save this transaction' : 'Could not save this transaction')
    } finally { setSaving(false) }
  }

  function startAssignmentAction(action: 'return' | 'expense', assignment: Assignment) {
    setSelectedAssignment(assignment); setDialog(action)
  }

  if (!token) return <LoginView email={loginEmail} password={loginPassword} setEmail={setLoginEmail} setPassword={setLoginPassword} error={loginError} loading={loading} signIn={signIn} />
  if (!user) return <div className="boot-screen"><div className="boot-mark"><Command /></div><span>Securing your workspace</span></div>

  const allNav: { id: Page; label: string; icon: typeof Activity; group: string }[] = [
    { id: 'dashboard', label: 'Overview', icon: Activity, group: 'COMMAND' }, { id: 'purchases', label: 'Purchases', icon: Boxes, group: 'SUPPLY' },
    { id: 'transfers', label: 'Transfers', icon: ArrowLeftRight, group: 'SUPPLY' }, { id: 'assignments', label: 'Assignments', icon: Users, group: 'ACCOUNTABILITY' }, { id: 'audit', label: 'Audit trail', icon: FileClock, group: 'ACCOUNTABILITY' },
  ]
  const nav = allNav.filter((item) => pages.includes(item.id))
  const groups = [...new Set(nav.map((item) => item.group))]

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
      <Brand />
      <div className="base-switcher"><span className="base-icon"><Building2 size={17} /></span><span><small>OPERATING BASE</small><strong>{user.baseName ?? 'All installations'}</strong></span><ChevronDown size={14} /></div>
      <nav className="side-nav" aria-label="Main navigation">{groups.map((group) => <div className="nav-group" key={group}><span className="nav-heading">{group}</span>{nav.filter((item) => item.group === group).map((item) => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${page === item.id ? 'nav-active' : ''}`} onClick={() => { setPage(item.id); setMobileNavOpen(false) }}><Icon size={17} /><span>{item.label}</span>{item.id === 'audit' && <span className="nav-admin">ADM</span>}</button> })}</div>)}</nav>
      <div className="sidebar-bottom"><div className="system-status"><span className="status-dot" /><span>All systems operational</span><span className="status-version">v1.0</span></div><div className="user-card"><div className="avatar">{initials(user.name)}</div><div className="user-meta"><strong>{user.name}</strong><small>{user.role.replaceAll('_', ' ')}</small></div><button className="icon-button signout" aria-label="Sign out" title="Sign out" onClick={signOut}><LogOut size={16} /></button></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen((open) => !open)}><Menu size={19} /></button><div className="breadcrumb"><span>ASSET COMMAND</span><span className="crumb-slash">/</span><strong>{titles[page]}</strong></div><div className="topbar-right"><span className="live-indicator"><span className="status-dot" /> LIVE LEDGER</span><span className="topbar-date">{new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span><div className="avatar avatar-small">{initials(user.name)}</div></div></header>
      <div className="page-content">
        <div className="page-heading"><div><p className="eyebrow">{page === 'dashboard' ? 'FIELD OPERATIONS / RESOURCE READINESS' : `${page.toUpperCase()} / OPERATIONAL RECORDS`}</p><h1>{titles[page]}</h1><p className="page-subtitle">{page === 'dashboard' ? 'A live picture of equipment across your area of responsibility.' : page === 'purchases' ? 'Procurement history and newly received equipment.' : page === 'transfers' ? 'Movement between installations, recorded end to end.' : page === 'assignments' ? 'Issued equipment, returns, and documented expenditure.' : 'Immutable record of system transactions.'}</p></div>{['purchases', 'transfers', 'assignments'].includes(page) && <button className="button button-primary" onClick={() => setDialog(page as Dialog)}><Plus size={16} />{page === 'purchases' ? 'Record purchase' : page === 'transfers' ? 'New transfer' : 'Assign assets'}</button>}</div>
        {page !== 'audit' && <FilterBar filters={filters} setFilters={setFilters} bases={bases} equipment={equipment} baseLocked={user.role === 'BASE_COMMANDER'} />}
        {requestError && <div className="error-banner"><span>{requestError}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setRequestError('')}><X size={16} /></button></div>}
        {page === 'dashboard' && <DashboardView data={dashboard} loading={loading} onMovement={() => setShowMovement(true)} />}
        {page === 'purchases' && <PurchasesView rows={purchases} loading={loading} />}
        {page === 'transfers' && <TransfersView rows={transfers} loading={loading} />}
        {page === 'assignments' && <AssignmentsView rows={assignments} loading={loading} onAction={startAssignmentAction} />}
        {page === 'audit' && <AuditView rows={auditEntries} loading={loading} />}
        <footer className="page-footer"><span><ShieldCheck size={14} /> ACCESS CONTROL ACTIVE</span><span>Operational data updates when transactions are committed</span></footer>
      </div>
    </main>
    {dialog && <OperationDialog dialog={dialog} bases={bases} equipment={equipment} user={user} assignment={selectedAssignment} saving={saving} onClose={() => { setDialog(null); setSelectedAssignment(null) }} onSubmit={submitOperation} />}
    {showMovement && dashboard && <MovementDialog data={dashboard} onClose={() => setShowMovement(false)} />}
    {mobileNavOpen && <button aria-label="Close navigation" className="nav-scrim" onClick={() => setMobileNavOpen(false)} />}
  </div>
}

function initials(name: string) { return name.split(' ').map((part) => part[0]).slice(0, 2).join('') }

function Brand() { return <div className="brand-lockup"><span className="brand-mark"><Command size={20} /></span><span>ASSET<span className="brand-light">COMMAND</span></span></div> }

function LoginView({ email, password, setEmail, setPassword, error, loading, signIn }: { email: string; password: string; setEmail: (value: string) => void; setPassword: (value: string) => void; error: string; loading: boolean; signIn: (email?: string, password?: string) => void }) {
  return <main className="login-shell"><section className="login-aside"><Brand /><div className="login-message"><span className="eyebrow">LOGISTICS INTELLIGENCE / 01</span><h1>Every asset.<br />Accounted for.</h1><p>A clear operational picture across bases, from acquisition to assignment.</p></div><div className="login-aside-foot"><ShieldCheck size={16} /> Role-controlled operational access</div></section><section className="login-main"><form className="login-card" onSubmit={(event) => { event.preventDefault(); signIn() }}><div className="login-icon"><Command size={22} /></div><p className="eyebrow">SECURE ACCESS</p><h2>Sign in to your workspace</h2><p className="login-intro">Use a demo role to explore the asset ledger.</p><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <p className="form-error">{error}</p>}<button className="button button-primary login-submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}<ArrowUpRight size={16} /></button><div className="demo-access"><div className="section-label">DEMO ACCESS</div>{demos.map((demo) => <button type="button" key={demo.email} className="demo-account" onClick={() => { setEmail(demo.email); setPassword(demo.password); signIn(demo.email, demo.password) }}><span><strong>{demo.label}</strong><small>{demo.detail}</small></span><ArrowUpRight size={15} /></button>)}</div></form><p className="login-footnote">Demonstration environment · Synthetic operational data</p></section></main>
}

function FilterBar({ filters, setFilters, bases, equipment, baseLocked }: { filters: { baseId: string; equipmentId: string; from: string; to: string }; setFilters: (value: { baseId: string; equipmentId: string; from: string; to: string }) => void; bases: Base[]; equipment: Equipment[]; baseLocked: boolean }) {
  return <div className="filter-bar"><div className="filter-title"><span className="filter-glyph"><Activity size={15} /></span><span>VIEW FILTERS</span></div><label className="filter-control"><span>BASE</span><select value={filters.baseId} onChange={(event) => setFilters({ ...filters, baseId: event.target.value })} disabled={baseLocked}><option value="">All bases</option>{bases.map((base) => <option key={base.id} value={base.id}>{base.name}</option>)}</select></label><label className="filter-control"><span>EQUIPMENT</span><select value={filters.equipmentId} onChange={(event) => setFilters({ ...filters, equipmentId: event.target.value })}><option value="">All equipment</option>{equipment.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="filter-control filter-date"><span>FROM</span><input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label><label className="filter-control filter-date"><span>TO</span><input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label><button className="clear-filters" onClick={() => setFilters({ ...filters, baseId: '', equipmentId: '', from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) })}>Reset</button></div>
}

function Metric({ label, value, note, icon, tone, onClick }: { label: string; value: number; note: string; icon: ReactNode; tone: string; onClick?: () => void }) {
  return <article className={`metric-card metric-${tone} ${onClick ? 'metric-clickable' : ''}`} onClick={onClick} onKeyDown={(event) => { if (onClick && (event.key === 'Enter' || event.key === ' ')) onClick() }} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}><div className="metric-top"><span className="metric-label">{label}</span><span className="metric-icon">{icon}</span></div><strong className="metric-value">{value.toLocaleString()}</strong><div className="metric-foot"><span>{note}</span>{onClick && <ArrowUpRight size={14} />}</div></article>
}

function DashboardView({ data, loading, onMovement }: { data: Dashboard | null; loading: boolean; onMovement: () => void }) {
  if (loading && !data) return <LoadingState />
  if (!data) return <EmptyState title="No dashboard data" detail="The dashboard could not be loaded from the service." />
  const max = Math.max(...data.byEquipment.map((item) => item.balance), 1)
  const stockIcons = [<Truck key="vehicle" size={18} />, <ShieldCheck key="weapon" size={18} />, <Radio key="radio" size={18} />]
  return <><section className="metrics-grid"><Metric label="OPENING BALANCE" value={data.openingBalance} note="At start of selected period" icon={<Boxes size={17} />} tone="ink" /><Metric label="CLOSING BALANCE" value={data.closingBalance} note="Available at period end" icon={<Check size={17} />} tone="green" /><Metric label="NET MOVEMENT" value={data.netMovement} note="Purchases + inbound − outbound" icon={<ArrowLeftRight size={17} />} tone="lime" onClick={onMovement} /><Metric label="ASSIGNED" value={data.assigned} note="Currently issued to personnel" icon={<Users size={17} />} tone="blue" /><Metric label="EXPENDED" value={data.expended} note="Recorded in selected period" icon={<Activity size={17} />} tone="orange" /></section><section className="dashboard-lower"><article className="panel stock-panel"><div className="panel-header"><div><p className="eyebrow">INVENTORY POSITION</p><h2>By equipment type</h2></div><span className="panel-tag"><span className="status-dot" /> BALANCE</span></div><div className="stock-list">{data.byEquipment.map((item, index) => <div className="stock-row" key={item.id}><div className={`stock-icon stock-icon-${index % 3}`}>{stockIcons[index % 3]}</div><div className="stock-info"><div className="stock-title"><strong>{item.name}</strong><span>{item.category}</span></div><div className="stock-track"><span style={{ width: `${Math.max(3, item.balance / max * 100)}%` }} /></div></div><div className="stock-quantity"><strong>{item.balance.toLocaleString()}</strong><small>{item.unit}</small></div></div>)}</div><div className="panel-footer"><span>Current on-hand inventory</span><span>{data.byEquipment.length} equipment classes</span></div></article><article className="panel movement-panel"><div className="panel-header"><div><p className="eyebrow">PERIOD ACTIVITY</p><h2>Movement summary</h2></div><span className="movement-period"><Clock3 size={13} /> Selected dates</span></div><div className="movement-list"><MovementLine icon={<ArrowDownLeft size={16} />} label="Purchases received" count={data.purchases} tone="green" /><MovementLine icon={<ArrowDownLeft size={16} />} label="Transfers received" count={data.transferIn} tone="blue" /><MovementLine icon={<ArrowUpRight size={16} />} label="Transfers dispatched" count={data.transferOut} tone="orange" /></div><div className="net-callout"><span>NET MOVEMENT</span><strong>{data.netMovement > 0 ? '+' : ''}{data.netMovement.toLocaleString()}</strong><span>units</span></div><button className="text-action" onClick={onMovement}>View movement details <ArrowUpRight size={14} /></button></article></section></>
}

function MovementLine({ icon, label, count, tone }: { icon: ReactNode; label: string; count: number; tone: string }) { return <div className="movement-line"><span className={`movement-icon movement-${tone}`}>{icon}</span><span>{label}</span><strong>{count.toLocaleString()}</strong></div> }

function PurchasesView({ rows, loading }: { rows: Purchase[]; loading: boolean }) {
  return <DataPanel title="Purchase history" eyebrow="PROCUREMENT REGISTER" description="Recorded acquisitions by base and equipment type" loading={loading} count={rows.length} empty="No purchases match these filters."><table><thead><tr><th>REFERENCE</th><th>EQUIPMENT</th><th>DESTINATION</th><th>SUPPLIER</th><th>RECORDED BY</th><th>DATE</th><th className="numeric">QTY</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><span className="table-ref">PUR-{String(row.id).padStart(4, '0')}</span></td><td><strong>{row.equipment}</strong></td><td>{row.base}</td><td>{row.supplier}</td><td>{row.recorded_by}</td><td>{displayDate(row.date)}</td><td className="numeric"><span className="quantity-pill">+{row.quantity}</span></td></tr>)}</tbody></table></DataPanel>
}
function TransfersView({ rows, loading }: { rows: Transfer[]; loading: boolean }) {
  return <DataPanel title="Transfer register" eyebrow="INTER-BASE MOVEMENT" description="Every dispatch and receipt, paired by a shared reference" loading={loading} count={rows.length} empty="No transfers match these filters."><table><thead><tr><th>REFERENCE</th><th>EQUIPMENT</th><th>FROM</th><th></th><th>TO</th><th>RECORDED BY</th><th>DATE</th><th className="numeric">QTY</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><span className="table-ref">{row.reference}</span></td><td><strong>{row.equipment}</strong></td><td>{row.from_base}</td><td><ArrowLeftRight className="inline-transfer" size={15} /></td><td>{row.to_base}</td><td>{row.recorded_by}</td><td>{displayDate(row.date)}</td><td className="numeric"><span className="quantity-pill neutral">{row.quantity}</span></td></tr>)}</tbody></table></DataPanel>
}
function AssignmentsView({ rows, loading, onAction }: { rows: Assignment[]; loading: boolean; onAction: (action: 'return' | 'expense', row: Assignment) => void }) {
  return <DataPanel title="Assignment register" eyebrow="PERSONNEL ACCOUNTABILITY" description="Issued equipment and disposition status" loading={loading} count={rows.length} empty="No assignments have been recorded."><table><thead><tr><th>PERSONNEL / UNIT</th><th>EQUIPMENT</th><th>BASE</th><th>ASSIGNED</th><th>RETURNED</th><th>EXPENDED</th><th>ACTIVE</th><th>ACTIONS</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.personnel}</strong><small className="cell-sub">ASN-{String(row.id).padStart(4, '0')}</small></td><td>{row.equipment}</td><td>{row.base}</td><td>{row.quantity}</td><td>{row.returnedQuantity}</td><td>{row.expendedQuantity}</td><td><span className={row.activeQuantity > 0 ? 'active-badge' : 'closed-badge'}>{row.activeQuantity} active</span></td><td><div className="row-actions"><button className="mini-action" disabled={!row.activeQuantity} onClick={() => onAction('return', row)}>Return</button><button className="mini-action mini-action-expense" disabled={!row.activeQuantity} onClick={() => onAction('expense', row)}>Expense</button></div></td></tr>)}</tbody></table></DataPanel>
}
function AuditView({ rows, loading }: { rows: AuditEntry[]; loading: boolean }) {
  return <DataPanel title="Audit history" eyebrow="IMMUTABLE TRANSACTION RECORD" description="Recent actions attributed to authenticated operators" loading={loading} count={rows.length} empty="No transactions have been recorded yet."><table><thead><tr><th>ACTIVITY</th><th>ENTITY</th><th>REFERENCE</th><th>OPERATOR</th><th>DETAILS</th><th>TIMESTAMP</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><span className="audit-action"><span className="status-dot" />{row.action.replaceAll('_', ' ')}</span></td><td>{row.entity}</td><td><span className="table-ref">#{row.entityId}</span></td><td>{row.actor}</td><td className="audit-detail">{row.details}</td><td>{new Date(row.date).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</td></tr>)}</tbody></table></DataPanel>
}
function DataPanel({ title, eyebrow, description, loading, count, empty, children }: { title: string; eyebrow: string; description: string; loading: boolean; count: number; empty: string; children: ReactNode }) {
  return <section className="panel data-panel"><div className="panel-header data-panel-header"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p className="panel-description">{description}</p></div><span className="record-count">{count} RECORDS</span></div>{loading ? <LoadingState /> : count === 0 ? <EmptyState title="Nothing to show" detail={empty} /> : <div className="table-scroll">{children}</div>}</section>
}
function LoadingState() { return <div className="loading-state"><span className="loading-spinner" />Loading operational data</div> }
function EmptyState({ title, detail }: { title: string; detail: string }) { return <div className="empty-state"><div className="empty-icon"><ClipboardList size={20} /></div><strong>{title}</strong><span>{detail}</span></div> }

function OperationDialog({ dialog, bases, equipment, user, assignment, saving, onClose, onSubmit }: { dialog: Dialog; bases: Base[]; equipment: Equipment[]; user: User; assignment: Assignment | null; saving: boolean; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const isAction = dialog === 'return' || dialog === 'expense'
  const heading = dialog === 'purchases' ? 'Record a purchase' : dialog === 'transfers' ? 'Create a base transfer' : dialog === 'assignments' ? 'Assign equipment' : dialog === 'return' ? 'Record returned assets' : 'Record expenditure'
  const usableBases = user.role === 'BASE_COMMANDER' ? bases.filter((base) => base.id === user.baseId) : bases
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="operation-modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header className="modal-header"><div><p className="eyebrow">NEW TRANSACTION</p><h2 id="dialog-title">{heading}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></header><form onSubmit={onSubmit}>
    {dialog === 'purchases' && <><label>Receiving base<select name="baseId" defaultValue={usableBases[0]?.id} required>{usableBases.map((base) => <option value={base.id} key={base.id}>{base.name}</option>)}</select></label><EquipmentSelect equipment={equipment} /><div className="form-row"><label>Quantity<input name="quantity" type="number" min="1" required /></label><label>Supplier<input name="supplier" minLength={2} placeholder="Supplier name" required /></label></div></>}
    {dialog === 'transfers' && <><label>From base<select name="fromBaseId" defaultValue={usableBases[0]?.id} required>{usableBases.map((base) => <option value={base.id} key={base.id}>{base.name}</option>)}</select></label><label>To base<select name="toBaseId" defaultValue={bases.find((base) => base.id !== usableBases[0]?.id)?.id} required>{bases.filter((base) => user.role !== 'BASE_COMMANDER' || base.id !== user.baseId).map((base) => <option value={base.id} key={base.id}>{base.name}</option>)}</select></label><EquipmentSelect equipment={equipment} /><label>Quantity<input name="quantity" type="number" min="1" required /></label></>}
    {dialog === 'assignments' && <><label>Base<select name="baseId" defaultValue={usableBases[0]?.id} required>{usableBases.map((base) => <option value={base.id} key={base.id}>{base.name}</option>)}</select></label><EquipmentSelect equipment={equipment} /><label>Personnel or unit<input name="personnel" placeholder="e.g. 1st Platoon" required /></label><label>Quantity<input name="quantity" type="number" min="1" required /></label></>}
    {isAction && <><div className="action-context"><CircleUserRound size={19} /><span><strong>{assignment?.personnel}</strong><small>{assignment?.equipment} · {assignment?.activeQuantity} currently assigned</small></span></div><label>Quantity<input name="quantity" type="number" min="1" max={assignment?.activeQuantity} required /></label></>}
    <div className="modal-note"><ShieldCheck size={15} />This transaction is recorded in the audit trail.</div><div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Confirm transaction'}<ArrowUpRight size={15} /></button></div>
  </form></section></div>
}
function EquipmentSelect({ equipment }: { equipment: Equipment[] }) { return <label>Equipment type<select name="equipmentTypeId" required>{equipment.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label> }
function MovementDialog({ data, onClose }: { data: Dashboard; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="operation-modal movement-modal" role="dialog" aria-modal="true" aria-labelledby="movement-title"><header className="modal-header"><div><p className="eyebrow">DETAILED BREAKDOWN</p><h2 id="movement-title">Net movement</h2></div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></header><p className="movement-equation">Purchases + transfers in − transfers out</p><div className="movement-detail-list"><MovementLine icon={<Boxes size={16} />} label="Purchases" count={data.purchases} tone="green" /><MovementLine icon={<ArrowDownLeft size={16} />} label="Transfer in" count={data.transferIn} tone="blue" /><MovementLine icon={<ArrowUpRight size={16} />} label="Transfer out" count={-data.transferOut} tone="orange" /></div><div className="movement-total"><span>NET MOVEMENT</span><strong>{data.netMovement > 0 ? '+' : ''}{data.netMovement.toLocaleString()}</strong></div><button className="button button-primary movement-done" onClick={onClose}>Done <Check size={16} /></button></section></div>
}
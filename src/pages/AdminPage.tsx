import { useMemo } from 'react'
import { AppLayout } from '../components/AppLayout'
import { AccountsTable } from '../components/AccountsTable'
import { useAuth } from '../context/AuthContext'

export function AdminPage() {
  const { accountsData, addUser, editUser, changeUserRole, removeUser } = useAuth()

  const adminStats = useMemo(() => {
    const users = accountsData?.users ?? []
    const roles = accountsData?.roles ?? []
    const admins = users.filter((user) => user.roleId === 1).length

    return {
      totalUsers: users.length,
      totalRoles: roles.length,
      admins,
    }
  }, [accountsData])

  if (!accountsData) {
    return null
  }

  return (
    <AppLayout
      title="Административная панель управления пользователями"
      description="Раздел доступен только администраторам. Здесь можно создавать учётные записи, назначать роли и управлять доступом к приложению."
    >
      <section className="metrics-grid admin-metrics-grid">
        <article className="metric-card">
          <span>Всего пользователей</span>
          <strong>{adminStats.totalUsers}</strong>
        </article>
        <article className="metric-card">
          <span>Ролей в системе</span>
          <strong>{adminStats.totalRoles}</strong>
        </article>
        <article className="metric-card accent-card">
          <span>Пользователей с ролью admin</span>
          <strong>{adminStats.admins}</strong>
        </article>
      </section>

      <section className="admin-grid">
        <article className="admin-card admin-users-card">
          <div className="card-header">
            <div>
              <h2>Управление учётными записями</h2>
              <p>
                Изменения сохраняются в локальном хранилище браузера и синхронизируются с
                JSON-структурой аккаунтов приложения.
              </p>
            </div>
          </div>

          <div className="admin-card-body">
            <AccountsTable
              users={accountsData.users}
              roles={accountsData.roles}
              onRoleChange={changeUserRole}
              onCreate={addUser}
              onUpdate={editUser}
              onDelete={removeUser}
            />
          </div>
        </article>
      </section>
    </AppLayout>
  )
}

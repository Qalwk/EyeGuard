import { useEffect, useState } from 'react'
import { PhpMyAdminRolesPanel, PhpMyAdminUsersPanel } from '../components/phpmyadmin/PhpMyAdminPanels'
import { useAuth } from '../context/AuthContext'
import './DatabasePage.css'

type DatabaseTable = 'users' | 'roles'

const DATABASE_NAME = 'eyeguard_db'

const TABLE_TABS: Record<DatabaseTable, string[]> = {
  users: ['Browse', 'Structure', 'SQL', 'Search', 'Insert', 'Export'],
  roles: ['Browse', 'Structure', 'SQL', 'Search', 'Export'],
}

export function DatabasePage() {
  const { isReady, accountsData, addUser, editUser, changeUserRole, removeUser } = useAuth()
  const [activeTable, setActiveTable] = useState<DatabaseTable>('users')

  useEffect(() => {
    document.body.classList.add('phpmyadmin-mode')

    return () => {
      document.body.classList.remove('phpmyadmin-mode')
    }
  }, [])

  if (!isReady) {
    return (
      <div className="phpmyadmin-page">
        <div className="phpmyadmin-loading">Загрузка данных сервера MySQL...</div>
      </div>
    )
  }

  if (!accountsData) {
    return null
  }

  return (
    <div className="phpmyadmin-page">
      <header className="phpmyadmin-topbar">
        <div className="phpmyadmin-brand">
          <span className="phpmyadmin-logo">DataBase Online</span>
          <div className="phpmyadmin-server-info">
            <div>
              Server: <strong>127.0.0.1</strong> via TCP/IP
            </div>
            <div>
              Server version: <strong>8.0.36-MySQL Community Server</strong>
            </div>
          </div>
        </div>
        <div className="phpmyadmin-status">Logged in as: root@localhost</div>
      </header>

      <div className="phpmyadmin-layout">
        <aside className="phpmyadmin-sidebar">
          <p className="phpmyadmin-sidebar-title">Recent</p>
          <ul className="phpmyadmin-tree">
            <li className="phpmyadmin-tree-item">
              <button type="button" className="phpmyadmin-tree-button">
                {DATABASE_NAME}
              </button>
              <ul className="phpmyadmin-tree-nested">
                <li>
                  <button
                    type="button"
                    className={`phpmyadmin-tree-link${activeTable === 'roles' ? ' active' : ''}`}
                    onClick={() => setActiveTable('roles')}
                  >
                    roles
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className={`phpmyadmin-tree-link${activeTable === 'users' ? ' active' : ''}`}
                    onClick={() => setActiveTable('users')}
                  >
                    users
                  </button>
                </li>
              </ul>
            </li>
          </ul>
        </aside>

        <main className="phpmyadmin-main">
          <div className="phpmyadmin-breadcrumbs">
            <span>Server: 127.0.0.1</span>
            {' » '}
            <span>Database: {DATABASE_NAME}</span>
            {' » '}
            <span>Table: {activeTable}</span>
          </div>

          <ul className="phpmyadmin-tabs">
            {TABLE_TABS[activeTable].map((tab, index) => (
              <li key={tab} className={`phpmyadmin-tab${index === 0 ? ' active' : ''}`}>
                {tab}
              </li>
            ))}
          </ul>

          <section className="phpmyadmin-panel">
            {activeTable === 'users' ? (
              <PhpMyAdminUsersPanel
                users={accountsData.users}
                roles={accountsData.roles}
                onRoleChange={changeUserRole}
                onCreate={addUser}
                onUpdate={editUser}
                onDelete={removeUser}
              />
            ) : (
              <PhpMyAdminRolesPanel roles={accountsData.roles} />
            )}
          </section>
        </main>
      </div>
    </div>
  )
}

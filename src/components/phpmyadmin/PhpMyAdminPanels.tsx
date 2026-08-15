import { useMemo, useState } from 'react'
import type { UserAccount, UserRole } from '../../types/user'
import {
  hasUserAccountErrors,
  validateUserAccountForm,
  type UserAccountFormErrors,
} from '../../lib/formValidation'

export type UserAccountFormValues = {
  email: string
  login: string
  name: string
  password: string
  roleId: number
}

type PhpMyAdminUsersPanelProps = {
  users: UserAccount[]
  roles: UserRole[]
  onRoleChange: (userId: number, roleId: number) => void
  onCreate: (form: UserAccountFormValues) => string | null
  onUpdate: (userId: number, form: UserAccountFormValues) => string | null
  onDelete: (userId: number) => string | null
}

const emptyForm: UserAccountFormValues = {
  email: '',
  login: '',
  name: '',
  password: '',
  roleId: 2,
}

export function PhpMyAdminUsersPanel({
  users,
  roles,
  onRoleChange,
  onCreate,
  onUpdate,
  onDelete,
}: PhpMyAdminUsersPanelProps) {
  const [editorMode, setEditorMode] = useState<'create' | 'edit' | null>(null)
  const [editingUserId, setEditingUserId] = useState<number | null>(null)
  const [form, setForm] = useState<UserAccountFormValues>(emptyForm)
  const [formErrors, setFormErrors] = useState<UserAccountFormErrors>({})
  const [formError, setFormError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')

  const roleNameById = useMemo(() => {
    return new Map(roles.map((role) => [role.id, role.name]))
  }, [roles])

  const openCreateForm = () => {
    setEditorMode('create')
    setEditingUserId(null)
    setForm({ ...emptyForm, roleId: roles[1]?.id ?? 2 })
    setFormErrors({})
    setFormError('')
    setStatusMessage('')
  }

  const openEditForm = (user: UserAccount) => {
    setEditorMode('edit')
    setEditingUserId(user.id)
    setForm({
      email: user.email,
      login: user.login,
      name: user.name,
      password: user.password,
      roleId: user.roleId,
    })
    setFormErrors({})
    setFormError('')
    setStatusMessage('')
  }

  const closeEditor = () => {
    setEditorMode(null)
    setEditingUserId(null)
    setForm(emptyForm)
    setFormErrors({})
    setFormError('')
  }

  const handleFieldChange = (field: keyof UserAccountFormValues, value: string | number) => {
    setForm((currentForm) => ({ ...currentForm, [field]: value }))
    setFormError('')

    if (formErrors[field]) {
      setFormErrors((currentErrors: UserAccountFormErrors) => {
        const nextErrors = { ...currentErrors }
        delete nextErrors[field]
        return nextErrors
      })
    }
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nextErrors = validateUserAccountForm(form, { requirePassword: editorMode === 'create' })

    if (hasUserAccountErrors(nextErrors)) {
      setFormErrors(nextErrors)
      setFormError('Проверьте введённые значения.')
      return
    }

    const submitError =
      editorMode === 'create'
        ? onCreate(form)
        : editingUserId !== null
          ? onUpdate(editingUserId, form)
          : 'Запись не выбрана.'

    if (submitError) {
      setFormError(submitError)
      return
    }

    setStatusMessage(
      editorMode === 'create'
        ? 'Новая строка успешно добавлена в таблицу `users`.'
        : 'Строка успешно обновлена.',
    )
    closeEditor()
  }

  const handleDelete = (user: UserAccount) => {
    const confirmed = window.confirm(`Удалить строку id=${user.id} из таблицы users?`)

    if (!confirmed) {
      return
    }

    const deleteError = onDelete(user.id)

    if (deleteError) {
      window.alert(deleteError)
      return
    }

    setStatusMessage(`Строка id=${user.id} удалена из таблицы \`users\`.`)
  }

  const renderFieldError = (field: keyof UserAccountFormValues) => {
    const message = formErrors[field]

    if (!message) {
      return null
    }

    return <span className="phpmyadmin-field-error">{message}</span>
  }

  return (
    <>
      <div className="phpmyadmin-message">
        Showing rows 0 - {Math.max(users.length - 1, 0)} ({users.length} total) · Query took 0.0004 sec
      </div>

      <div className="phpmyadmin-sql-box">{`SELECT * FROM \`users\``}</div>

      {statusMessage ? <div className="phpmyadmin-message">{statusMessage}</div> : null}

      <div className="phpmyadmin-toolbar">
        <button type="button" className="phpmyadmin-button phpmyadmin-button-primary" onClick={openCreateForm}>
          Insert
        </button>
        {editorMode ? (
          <button type="button" className="phpmyadmin-button" onClick={closeEditor}>
            Cancel
          </button>
        ) : null}
      </div>

      {editorMode ? (
        <form className="phpmyadmin-form-panel" onSubmit={handleSubmit} noValidate>
          <h3>{editorMode === 'create' ? 'Insert row into table users' : 'Edit row in table users'}</h3>
          <div className="phpmyadmin-form-grid">
            <label className="phpmyadmin-field">
              <span>email</span>
              <input
                className="phpmyadmin-input"
                type="email"
                value={form.email}
                onChange={(event) => handleFieldChange('email', event.target.value)}
              />
              {renderFieldError('email')}
            </label>
            <label className="phpmyadmin-field">
              <span>login</span>
              <input
                className="phpmyadmin-input"
                type="text"
                value={form.login}
                onChange={(event) => handleFieldChange('login', event.target.value)}
              />
              {renderFieldError('login')}
            </label>
            <label className="phpmyadmin-field">
              <span>name</span>
              <input
                className="phpmyadmin-input"
                type="text"
                value={form.name}
                onChange={(event) => handleFieldChange('name', event.target.value)}
              />
              {renderFieldError('name')}
            </label>
            <label className="phpmyadmin-field">
              <span>password</span>
              <input
                className="phpmyadmin-input"
                type="text"
                value={form.password}
                onChange={(event) => handleFieldChange('password', event.target.value)}
              />
              {renderFieldError('password')}
            </label>
            <label className="phpmyadmin-field">
              <span>role_id</span>
              <select
                className="phpmyadmin-select"
                value={form.roleId}
                onChange={(event) => handleFieldChange('roleId', Number(event.target.value))}
              >
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.id} — {role.name}
                  </option>
                ))}
              </select>
              {renderFieldError('roleId')}
            </label>
          </div>
          {formError ? <p className="phpmyadmin-form-error">{formError}</p> : null}
          <div className="phpmyadmin-toolbar">
            <button type="submit" className="phpmyadmin-button phpmyadmin-button-primary">
              Go
            </button>
          </div>
        </form>
      ) : null}

      <div className="phpmyadmin-table-wrap">
        <table className="phpmyadmin-table">
          <thead>
            <tr>
              <th></th>
              <th>id</th>
              <th>email</th>
              <th>login</th>
              <th>name</th>
              <th>password</th>
              <th>role_id</th>
              <th>created_at</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td className="actions-cell">
                  <button
                    type="button"
                    className="phpmyadmin-link-button"
                    onClick={() => openEditForm(user)}
                  >
                    Edit
                  </button>
                  {' · '}
                  <button
                    type="button"
                    className="phpmyadmin-link-button"
                    onClick={() => handleDelete(user)}
                  >
                    Delete
                  </button>
                </td>
                <td>{user.id}</td>
                <td>{user.email}</td>
                <td>{user.login}</td>
                <td>{user.name}</td>
                <td>{user.password}</td>
                <td>
                  <select
                    className="phpmyadmin-select"
                    value={user.roleId}
                    onChange={(event) => onRoleChange(user.id, Number(event.target.value))}
                  >
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.id}
                      </option>
                    ))}
                  </select>
                  <span> ({roleNameById.get(user.roleId) ?? 'unknown'})</span>
                </td>
                <td>{user.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="phpmyadmin-footer-note">
        Query results operations: Browse | Edit | Copy | Delete | Export
      </p>
    </>
  )
}

type PhpMyAdminRolesPanelProps = {
  roles: UserRole[]
}

export function PhpMyAdminRolesPanel({ roles }: PhpMyAdminRolesPanelProps) {
  return (
    <>
      <div className="phpmyadmin-message">
        Showing rows 0 - {Math.max(roles.length - 1, 0)} ({roles.length} total) · Query took 0.0002 sec
      </div>

      <div className="phpmyadmin-sql-box">{`SELECT * FROM \`roles\``}</div>

      <div className="phpmyadmin-table-wrap">
        <table className="phpmyadmin-table">
          <thead>
            <tr>
              <th>id</th>
              <th>name</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id}>
                <td>{role.id}</td>
                <td>{role.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

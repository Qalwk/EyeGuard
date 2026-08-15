import { useState } from 'react'
import type { UserAccount, UserRole } from '../types/user'
import {
  hasUserAccountErrors,
  validateUserAccountForm,
  type UserAccountFormErrors,
} from '../lib/formValidation'

export type UserAccountFormValues = {
  email: string
  login: string
  name: string
  password: string
  roleId: number
}

type AccountsTableProps = {
  users: UserAccount[]
  roles: UserRole[]
  onRoleChange: (userId: number, roleId: number) => void
  onCreate: (form: UserAccountFormValues) => string | null
  onUpdate: (userId: number, form: UserAccountFormValues) => string | null
  onDelete: (userId: number) => string | null
  showPasswordColumn?: boolean
}

const emptyForm: UserAccountFormValues = {
  email: '',
  login: '',
  name: '',
  password: '',
  roleId: 2,
}

export function AccountsTable({
  users,
  roles,
  onRoleChange,
  onCreate,
  onUpdate,
  onDelete,
  showPasswordColumn = true,
}: AccountsTableProps) {
  const [editorMode, setEditorMode] = useState<'create' | 'edit' | null>(null)
  const [editingUserId, setEditingUserId] = useState<number | null>(null)
  const [form, setForm] = useState<UserAccountFormValues>(emptyForm)
  const [formErrors, setFormErrors] = useState<UserAccountFormErrors>({})
  const [formError, setFormError] = useState('')

  const openCreateForm = () => {
    setEditorMode('create')
    setEditingUserId(null)
    setForm({ ...emptyForm, roleId: roles[1]?.id ?? 2 })
    setFormErrors({})
    setFormError('')
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
      setFormErrors((currentErrors) => {
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
      setFormError('Исправьте ошибки в форме перед сохранением.')
      return
    }

    const submitError =
      editorMode === 'create'
        ? onCreate(form)
        : editingUserId !== null
          ? onUpdate(editingUserId, form)
          : 'Не выбран пользователь для редактирования.'

    if (submitError) {
      setFormError(submitError)
      return
    }

    closeEditor()
  }

  const handleDelete = (user: UserAccount) => {
    const confirmed = window.confirm(`Удалить учётную запись «${user.login}»?`)

    if (!confirmed) {
      return
    }

    const deleteError = onDelete(user.id)

    if (deleteError) {
      window.alert(deleteError)
    }
  }

  const renderFieldError = (field: keyof UserAccountFormValues) => {
    const message = formErrors[field]

    if (!message) {
      return null
    }

    return (
      <span className="field-error" role="alert">
        {message}
      </span>
    )
  }

  return (
    <>
      <div className="admin-toolbar">
        <button type="button" className="primary-button" onClick={openCreateForm}>
          Добавить аккаунт
        </button>
        {editorMode ? (
          <button type="button" className="secondary-button" onClick={closeEditor}>
            Закрыть форму
          </button>
        ) : null}
      </div>

      {editorMode ? (
        <form className="account-editor" onSubmit={handleSubmit} noValidate>
          <h3>{editorMode === 'create' ? 'Новая учётная запись' : 'Редактирование учётной записи'}</h3>
          <div className="account-editor-grid">
            <label className={`auth-field${formErrors.email ? ' auth-field-invalid' : ''}`}>
              <span>Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(event) => handleFieldChange('email', event.target.value)}
              />
              {renderFieldError('email')}
            </label>
            <label className={`auth-field${formErrors.login ? ' auth-field-invalid' : ''}`}>
              <span>Логин</span>
              <input
                type="text"
                value={form.login}
                onChange={(event) => handleFieldChange('login', event.target.value)}
              />
              {renderFieldError('login')}
            </label>
            <label className={`auth-field${formErrors.name ? ' auth-field-invalid' : ''}`}>
              <span>Имя</span>
              <input
                type="text"
                value={form.name}
                onChange={(event) => handleFieldChange('name', event.target.value)}
              />
              {renderFieldError('name')}
            </label>
            <label className={`auth-field${formErrors.password ? ' auth-field-invalid' : ''}`}>
              <span>Пароль</span>
              <input
                type="text"
                value={form.password}
                onChange={(event) => handleFieldChange('password', event.target.value)}
              />
              {renderFieldError('password')}
            </label>
            <label className={`auth-field${formErrors.roleId ? ' auth-field-invalid' : ''}`}>
              <span>Роль</span>
              <select
                className="table-select"
                value={form.roleId}
                onChange={(event) => handleFieldChange('roleId', Number(event.target.value))}
              >
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
              {renderFieldError('roleId')}
            </label>
          </div>
          {formError ? (
            <p className="form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="admin-toolbar">
            <button type="submit" className="primary-button">
              {editorMode === 'create' ? 'Создать' : 'Сохранить'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="table-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Email</th>
              <th>Логин</th>
              <th>Имя</th>
              {showPasswordColumn ? <th>password</th> : null}
              <th>role_id</th>
              <th>created_at</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.id}</td>
                <td>{user.email}</td>
                <td>{user.login}</td>
                <td>{user.name}</td>
                {showPasswordColumn ? <td className="hash-cell">{user.password}</td> : null}
                <td>
                  <select
                    className="table-select"
                    value={user.roleId}
                    onChange={(event) => onRoleChange(user.id, Number(event.target.value))}
                  >
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{user.createdAt}</td>
                <td className="table-actions">
                  <button type="button" className="secondary-button table-action-button" onClick={() => openEditForm(user)}>
                    Изменить
                  </button>
                  <button
                    type="button"
                    className="secondary-button table-action-button table-action-danger"
                    onClick={() => handleDelete(user)}
                  >
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

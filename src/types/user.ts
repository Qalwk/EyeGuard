export type UserRole = {
  id: number
  name: string
}

export type UserAccount = {
  id: number
  email: string
  login: string
  name: string
  password: string
  roleId: number
  createdAt: string
}

export type AccountsData = {
  roles: UserRole[]
  users: UserAccount[]
}

export type UserAccountFormValues = {
  email: string
  login: string
  name: string
  password: string
  roleId: number
}

export type AuthSession = {
  userId: number
}

import { useMemo, useState } from 'react'
import { AuthContext } from './auth-context'

const STORAGE_KEY = 'gpt-clone-profile'
function readSavedProfile() {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readSavedProfile)
  const value = useMemo(() => ({
    user,
    signIn(profile) {
      const safeProfile = {
        _id: profile?._id,
        email: profile?.email,
        fullName: profile?.fullName,
      }
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(safeProfile))
      setUser(safeProfile)
    },
    signOut() {
      sessionStorage.removeItem(STORAGE_KEY)
      setUser(null)
    },
  }), [user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

